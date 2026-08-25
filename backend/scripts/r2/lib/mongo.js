const dns = require('dns');
const mongoose = require('mongoose');
const { mongoUri } = require('./env');

// ---------------------------------------------------------------------------
// THE SRV LOOKUP HAS TO BE FORCED ONTO A PUBLIC RESOLVER.
//
// MONGO_URI is a `mongodb+srv://` address, which means connecting starts with a
// DNS SRV query. Plenty of home and office resolvers — and some ISP ones —
// simply refuse SRV records, and the failure surfaces as:
//
//   querySrv ECONNREFUSED _mongodb._tcp.<cluster>.mongodb.net
//
// which reads like the database is down when it is nothing of the sort. This is
// a known condition on this project: server.js does exactly the same thing at
// the top of the file, for exactly this reason. Every script that talks to Mongo
// goes through here so none of them has to rediscover it.
// ---------------------------------------------------------------------------

let dnsForced = false;

function forcePublicDns() {
  if (dnsForced) return;
  try {
    dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
    dnsForced = true;
  } catch {
    // If the resolver cannot be changed, the connection below will fail with a
    // clear message of its own. Nothing is gained by failing here first.
  }
}

/**
 * Connect, with a failure message that says what to do about it.
 *
 * A raw driver timeout against Atlas is almost always one of three things, and
 * guessing which one costs more time than the connection did.
 */
async function connect() {
  forcePublicDns();
  try {
    await mongoose.connect(mongoUri(), { serverSelectionTimeoutMS: 20000 });
  } catch (error) {
    const msg = String(error?.message || error);

    if (/querySrv|ENOTFOUND|EAI_AGAIN/i.test(msg)) {
      throw new Error(
        `Could not resolve the MongoDB cluster address.\n\n  ${msg}\n\n`
        + '  This is a DNS problem, not a database problem. The script already forces\n'
        + '  Google and Cloudflare resolvers; if it still fails, a VPN or corporate\n'
        + '  network is likely blocking SRV lookups. Try a different network, or run\n'
        + '  this script on the server instead.'
      );
    }

    if (/timed out|ETIMEDOUT|ServerSelection/i.test(msg)) {
      throw new Error(
        `Could not reach the MongoDB cluster.\n\n  ${msg}\n\n`
        + '  Most often this is the Atlas IP allowlist. Open Atlas → Network Access and\n'
        + '  confirm this machine\'s current IP is listed — a home connection can be given\n'
        + '  a new address at any time, so an entry that worked last week may not now.'
      );
    }

    if (/authentication failed|bad auth/i.test(msg)) {
      throw new Error(
        `MongoDB rejected the credentials in MONGO_URI.\n\n  ${msg}\n\n`
        + '  Check the username and password in backend/.env — a password containing\n'
        + '  @ : / or ? must be percent-encoded inside the connection string.'
      );
    }

    throw error;
  }

  return mongoose.connection;
}

async function disconnect() {
  try {
    await mongoose.disconnect();
  } catch {
    // Closing a connection that is already closed is not worth reporting.
  }
}

module.exports = { connect, disconnect };
