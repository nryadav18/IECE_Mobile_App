#!/usr/bin/env node
/**
 * Is the face-recognition service healthy, and if not, HOW is it unhealthy?
 *
 *   npm run ml:health              a quick look
 *   npm run ml:health -- --load=10 fire 10 real requests and measure
 *
 * Written because "sometimes 502, sometimes 'Error communicating with ML
 * service'" is two symptoms of possibly four different causes, and guessing
 * between them from the app is impossible:
 *
 *   the process is down            every request fails, instantly
 *   the process restarts under load  most succeed, some 502, no pattern in time
 *   inference is slower than the gateway's patience  fails at a suspiciously
 *                                   round number of seconds, every time
 *   the machine is out of memory   fine when idle, fails when two people check
 *                                   in at once
 *
 * The load test tells those apart, because it is the only one that reproduces
 * the condition. It sends a real generated video to /extract-v2 — the same
 * endpoint facial registration uses.
 */

require('dotenv').config();
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { execFileSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const FormData = require('form-data');

const { callMlService, ping, baseUrl, TIMEOUT_MS, MAX_ATTEMPTS } = require('../utils/mlService');

const args = process.argv.slice(2);
const LOAD = (() => {
  const a = args.find((x) => x.startsWith('--load='));
  return a ? Math.max(1, Number(a.split('=')[1])) : 0;
})();

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

/** A short synthetic clip. Not a real face — the point is to exercise the
 *  transport and the service's own error handling, not to pass recognition. */
function makeClip() {
  const out = path.join(os.tmpdir(), `ml-health-${crypto.randomBytes(4).toString('hex')}.mp4`);
  execFileSync(ffmpegPath, [
    '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=640x480:rate=15',
    '-pix_fmt', 'yuv420p', out,
  ], { stdio: 'ignore' });
  return out;
}

async function main() {
  console.log('\n  ML SERVICE HEALTH\n');

  const raw = (process.env.ML_SERVICE_API || '').trim();
  console.log(`  configured   ${raw || '(not set)'}`);
  if (!raw) {
    console.error('\n  ML_SERVICE_API is not set in backend/.env\n');
    process.exit(1);
  }
  console.log(`  normalised   ${baseUrl()}`);
  if (raw !== baseUrl()) {
    console.log('               ^ the trailing slash is stripped now. The old code did not,');
    console.log('                 so every call went to "…/ml//extract" with a double slash.');
  }
  if (/^http:\/\//i.test(raw)) {
    console.log('  transport    PLAIN HTTP — face videos cross the network unencrypted.');
  }
  console.log(`  timeout      ${TIMEOUT_MS}ms      attempts  ${MAX_ATTEMPTS}\n`);

  const p = await ping();
  console.log(`  reachable    ${p.reachable ? `yes (HTTP ${p.status})` : `NO — ${p.error}`}`);
  if (!p.reachable) {
    console.log('\n  The service is not answering at all. On the box, check:');
    console.log('    systemctl status <ml-service>     (or: docker ps / pm2 list)');
    console.log('    journalctl -u <ml-service> -n 100 --no-pager');
    console.log('    ss -lntp | grep <port>            is anything listening?\n');
    process.exit(1);
  }

  if (!LOAD) {
    console.log('\n  Add --load=10 to send real requests and measure latency and failures.');
    console.log('  That is what distinguishes a crash from a timeout from memory pressure.\n');
    process.exit(0);
  }

  console.log(`\n  Sending ${LOAD} real request(s) to /extract-v2…\n`);
  const clip = makeClip();
  const buffer = fs.readFileSync(clip);
  const results = [];

  for (let i = 1; i <= LOAD; i += 1) {
    const started = Date.now();
    try {
      await callMlService('extract-v2', () => {
        const fd = new FormData();
        fd.append('file', buffer, { filename: 'video.mp4', contentType: 'video/mp4' });
        return fd;
      }, { attempts: 1 });          // no retry here — we are measuring raw behaviour
      results.push({ ok: true, ms: Date.now() - started });
      console.log(`  ${padL(i, 3)}  OK        ${padL(Date.now() - started, 6)}ms`);
    } catch (error) {
      results.push({ ok: false, ms: Date.now() - started, code: error.code, status: error.status });
      console.log(`  ${padL(i, 3)}  ${pad(error.code, 20)} ${padL(Date.now() - started, 6)}ms  ${error.status ? `HTTP ${error.status}` : ''}`);
    }
  }
  fs.unlinkSync(clip);

  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const line = '  ' + '─'.repeat(70);

  console.log(`\n${line}`);
  console.log(`  succeeded ${ok.length}/${results.length}`);
  console.log(`  latency   min ${times[0]}ms   median ${times[Math.floor(times.length / 2)]}ms   max ${times[times.length - 1]}ms`);

  if (bad.length) {
    const byCode = {};
    bad.forEach((b) => { byCode[b.status ? `${b.code} (HTTP ${b.status})` : b.code] = (byCode[b.status ? `${b.code} (HTTP ${b.status})` : b.code] || 0) + 1; });
    console.log('  failures :', JSON.stringify(byCode));

    console.log('\n  READING THIS\n');
    if (bad.some((b) => b.status === 502 || b.status === 503)) {
      console.log('  502/503 means the gateway had no worker to hand the request to. Usually');
      console.log('  the ML process died and is restarting. On the box:');
      console.log('    journalctl -u <ml-service> -n 200 --no-pager | grep -iE "killed|oom|memory|traceback"');
      console.log('    dmesg -T | grep -i "out of memory"     <- the kernel killing it for RAM');
    }
    if (bad.some((b) => b.code === 'timeout')) {
      console.log('  Timeouts at a consistent duration point at a gateway limit, not at the');
      console.log('  model. Check nginx proxy_read_timeout / proxy_send_timeout against the');
      console.log('  median latency above.');
    }
    if (ok.length && bad.length && LOAD > 3) {
      console.log('  A mix of success and failure under sequential load usually means the');
      console.log('  service cannot hold its model in memory alongside whatever else runs on');
      console.log('  that machine. Check free -m while this script runs.');
    }
  } else {
    console.log('\n  No failures in this run. If users still see them, the trigger is load:');
    console.log('  try a higher --load, or run this while several people check in.');
  }
  console.log(line + '\n');
  process.exit(bad.length ? 1 : 0);
}

main().catch((error) => {
  console.error(`\n  Health check failed to run:\n\n  ${error.message}\n`);
  process.exit(1);
});
