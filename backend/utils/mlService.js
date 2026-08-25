const axios = require('axios');

// ---------------------------------------------------------------------------
// TALKING TO THE FACE-RECOGNITION SERVICE.
//
// Four routes called this service, each with its own copy of the same four
// lines, and each with the same three problems:
//
//   NO TIMEOUT. axios waits forever by default. If the ML process hangs — and a
//   model that has run out of memory hangs rather than crashes — the request
//   sits open until the socket eventually dies, holding a Node handler and a
//   50 MB upload in memory the whole time. To the person on the phone it is a
//   spinner that never stops.
//
//   NO RETRY. A 502 is usually the gateway finding no worker for a moment:
//   the service restarting, a worker recycling after an OOM, or a cold start
//   after idle. The next request a second later succeeds. Without a retry, a
//   member of staff standing in front of a school gate is simply told their
//   attendance failed.
//
//   THE ERROR WAS UNREADABLE. The old code read `error.response.data.detail`,
//   which exists only when the ML service itself answers in JSON. A 502 comes
//   from the gateway as HTML, so `detail` was undefined and every caller fell
//   through to "Error communicating with ML service" — the same message for a
//   dead service, a timeout, a bad video and a network blip. Nothing in that
//   message tells the user whether to try again or the operator where to look.
//
// There was also a quieter bug: ML_SERVICE_API is configured with a trailing
// slash (`http://.../ml/`), and every call appended `/extract`, producing
// `http://.../ml//extract`. Some gateways normalise a double slash; some route
// it somewhere else entirely. It is now impossible to build that URL by hand.
// ---------------------------------------------------------------------------

/** Base URL with any trailing slashes removed, so joining can never double up. */
function baseUrl() {
  const raw = (process.env.ML_SERVICE_API || '').trim();
  if (!raw) throw new MlServiceError('ML_SERVICE_API is not configured on the server.', { code: 'not_configured', retryable: false });
  return raw.replace(/\/+$/, '');
}

// Face inference on a short video is genuinely slow — several seconds on a
// warm service, considerably longer on a cold one. This is a ceiling on
// pathological hangs, not a performance target.
const TIMEOUT_MS = Number(process.env.ML_SERVICE_TIMEOUT_MS || 90000);

// Two retries, three attempts total. Enough to ride out a worker restart;
// few enough that a genuinely dead service fails while the user is still
// looking at the screen rather than three minutes later.
const MAX_ATTEMPTS = Number(process.env.ML_SERVICE_ATTEMPTS || 3);

class MlServiceError extends Error {
  constructor(message, { code, retryable, status, detail } = {}) {
    super(message);
    this.name = 'MlServiceError';
    this.code = code || 'ml_error';
    this.retryable = !!retryable;
    this.status = status || null;
    this.detail = detail || null;
  }
}

/**
 * Is this failure worth trying again?
 *
 * The distinction that matters: a 4xx is the ML service ANSWERING — "no face
 * in this video", "no blink detected" — and repeating the request will produce
 * the same answer while making the person wait three times as long. A 5xx, a
 * timeout or a dropped connection is the service failing to answer at all,
 * which is frequently momentary.
 */
function classify(error) {
  const status = error.response?.status;

  if (status) {
    if (status >= 500) {
      return {
        retryable: true,
        code: status === 502 || status === 503 ? 'service_unavailable' : 'service_error',
        message: 'The face-recognition service is temporarily unavailable. Please try again in a moment.',
      };
    }
    // The service answered. Its own message is the useful one.
    const detail = error.response?.data?.detail
      || error.response?.data?.message
      || (typeof error.response?.data === 'string' ? error.response.data.slice(0, 200) : null);
    return {
      retryable: false,
      code: 'rejected',
      message: detail || `The face-recognition service rejected the request (HTTP ${status}).`,
    };
  }

  // No response at all.
  if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '')) {
    return {
      retryable: true,
      code: 'timeout',
      message: 'The face-recognition service did not respond in time. Please try again.',
    };
  }
  if (['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'ENOTFOUND'].includes(error.code)
    || /socket hang up/i.test(error.message || '')) {
    return {
      retryable: true,
      code: 'unreachable',
      message: 'Could not reach the face-recognition service. Please try again in a moment.',
    };
  }

  return { retryable: false, code: 'ml_error', message: 'Face recognition could not be completed. Please try again.' };
}

/**
 * POST a multipart form to one ML endpoint, with timeout and retry.
 *
 * `buildForm` is a FUNCTION, not a FormData. This is not a style choice: a
 * `form-data` instance is a readable stream, and a stream can only be consumed
 * once. Retrying with the same object sends an empty body — the request
 * "succeeds" in reaching the service and is rejected as having no file, which
 * looks exactly like a bad video. Every attempt therefore builds its own.
 *
 * @param {string} endpoint  e.g. 'extract-v2' (no leading slash needed)
 * @param {() => FormData} buildForm
 * @returns {Promise<object>} the parsed response body
 * @throws {MlServiceError}
 */
async function callMlService(endpoint, buildForm, { timeout = TIMEOUT_MS, attempts = MAX_ATTEMPTS } = {}) {
  const url = `${baseUrl()}/${String(endpoint).replace(/^\/+/, '')}`;
  let last;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const form = buildForm();
    const started = Date.now();
    try {
      const response = await axios.post(url, form, {
        headers: form.getHeaders(),
        timeout,
        // A face video is tens of megabytes. axios' defaults have historically
        // capped request and response bodies; being explicit means an upload is
        // never truncated by a limit nobody set on purpose.
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      if (attempt > 1) {
        console.log(`[ml] ${endpoint} succeeded on attempt ${attempt} after ${Date.now() - started}ms`);
      }
      return response.data;
    } catch (error) {
      const { retryable, code, message } = classify(error);
      last = new MlServiceError(message, {
        code,
        retryable,
        status: error.response?.status || null,
        detail: error.message,
      });

      console.error(
        `[ml] ${endpoint} attempt ${attempt}/${attempts} failed after ${Date.now() - started}ms `
        + `— ${code}${error.response?.status ? ` (HTTP ${error.response.status})` : ''}: ${error.message}`
      );

      if (!retryable || attempt === attempts) break;

      // Short, increasing pause. A restarting worker is usually back within a
      // second or two, and the person is waiting.
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }

  throw last;
}

/**
 * Is the service answering at all? Used by the health script and safe to call
 * from anywhere — it never throws.
 */
async function ping() {
  try {
    const res = await axios.get(baseUrl(), { timeout: 10000, validateStatus: () => true });
    return { reachable: true, status: res.status, base: baseUrl() };
  } catch (error) {
    return { reachable: false, status: null, base: (process.env.ML_SERVICE_API || '').trim(), error: error.message };
  }
}

module.exports = { callMlService, MlServiceError, ping, baseUrl, TIMEOUT_MS, MAX_ATTEMPTS };
