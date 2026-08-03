/**
 * Dotted version comparison, without pulling in a semver dependency.
 *
 * App versions here are plain `major.minor.patch` strings from app.json
 * ("4.0.0"). This compares them numerically segment by segment, so "4.10.0"
 * correctly beats "4.9.0" — which a string comparison gets exactly backwards,
 * and which is the classic way an update prompt ends up either never firing or
 * firing forever.
 *
 * Missing segments count as 0, so "4.1" === "4.1.0". Anything non-numeric in a
 * segment (a "-beta" suffix, say) is stripped rather than throwing; a build
 * that reports a weird version should be treated as *some* version, not crash
 * the launch check.
 *
 * @returns -1 if a < b, 0 if equal, 1 if a > b
 */
function compareVersions(a, b) {
  const parse = (v) =>
    String(v ?? '')
      .split('.')
      .map((seg) => parseInt(String(seg).replace(/[^0-9].*$/, ''), 10) || 0);

  const av = parse(a);
  const bv = parse(b);
  const len = Math.max(av.length, bv.length);

  for (let i = 0; i < len; i++) {
    const x = av[i] || 0;
    const y = bv[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Is `current` behind `target`? */
const isOlderThan = (current, target) =>
  !!target && compareVersions(current, target) < 0;

module.exports = { compareVersions, isOlderThan };
