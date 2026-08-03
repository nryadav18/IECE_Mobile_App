/**
 * Facts about IECE itself (as opposed to anything in the database).
 */

// IECE began on 21 June 2017. Month is 0-indexed to match the Date API.
export const FOUNDED_ON = { year: 2017, month: 5, day: 21 };

export const FOUNDED_LABEL = '21 June 2017';

/**
 * Completed years since the founding date.
 *
 * Counts *completed* years, so the figure rolls over on the anniversary
 * itself and not on 1 January: it reads 9 from 21 June 2026 until 20 June
 * 2027, then becomes 10 on 21 June 2027.
 *
 * Callers should re-evaluate this when the screen regains focus rather than
 * once at module load, so an app left running across the anniversary still
 * shows the new number.
 */
export function yearsSinceFounding(now = new Date()) {
  const anniversaryPassed =
    now.getMonth() > FOUNDED_ON.month ||
    (now.getMonth() === FOUNDED_ON.month && now.getDate() >= FOUNDED_ON.day);

  const years = now.getFullYear() - FOUNDED_ON.year - (anniversaryPassed ? 0 : 1);
  return Math.max(years, 0);
}
