const User = require('../models/User');

// ---------------------------------------------------------------------------
// LOOKING UP AN ACCOUNT BY EMAIL, THE WAY PEOPLE ACTUALLY TYPE IT.
//
// `User.findOne({ email })` is an exact, case-sensitive, untrimmed match. Every
// one of those three properties is a way for a person with entirely correct
// credentials to be told "Invalid credentials":
//
//   CASE      A phone keyboard capitalises the first letter of a field by
//             default. Somebody registered as `priya@gmail.com` who types
//             `Priya@gmail.com` does not exist as far as the old lookup was
//             concerned.
//   SPACES    Autofill and copy-paste routinely add a trailing space.
//   REALITY   This database already contains two accounts whose addresses
//             differ only in capitalisation, so the case-sensitive unique index
//             let both be created.
//
// HOW THIS RESOLVES THAT LAST ONE
//
// The exact match is tried FIRST. That keeps the common path on the indexed
// unique lookup, and it means each of those two accounts is still reachable by
// typing its own address exactly. Only a third spelling — one that matches
// neither exactly — falls through to the case-insensitive search, and if that
// finds more than one account it REFUSES rather than picking one.
//
// Guessing there would be the worst possible outcome: the person would be
// silently signed into somebody else's account, and nothing would look wrong.
// ---------------------------------------------------------------------------

/** Escape a user-supplied string for safe use inside a RegExp. */
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {string} email      as typed
 * @param {string} [select]   extra fields, e.g. '+password'
 * @returns {Promise<{user: object|null, ambiguous: boolean, matches: number}>}
 */
async function findUserByEmail(email, select) {
  const typed = String(email || '').trim();
  if (!typed) return { user: null, ambiguous: false, matches: 0 };

  // 1. Exact — the fast, indexed path that almost every login takes.
  const exact = await (select ? User.findOne({ email: typed }).select(select) : User.findOne({ email: typed }));
  if (exact) return { user: exact, ambiguous: false, matches: 1 };

  // 2. Case-insensitive. A collection scan, but only reached when the exact
  //    lookup already failed — which is the case that was previously a dead end.
  //    Limited to 2 because all we need to know is "one, or more than one".
  const q = User.find({ email: { $regex: `^${escapeRegex(typed)}$`, $options: 'i' } }).limit(2);
  const matches = await (select ? q.select(select) : q);

  if (matches.length === 1) return { user: matches[0], ambiguous: false, matches: 1 };
  if (matches.length > 1) return { user: null, ambiguous: true, matches: matches.length };
  return { user: null, ambiguous: false, matches: 0 };
}

module.exports = { findUserByEmail };
