/**
 * The celebration catalogue.
 *
 * One authored list of every day the IECE home screen celebrates: national
 * days, South Indian regional days, school days, awareness days, the major
 * festivals of every community IECE works with, and IECE's own anniversary.
 *
 * ── Shape ────────────────────────────────────────────────────────────────
 *   key        stable id. Used by the backend override/mute mechanism and by
 *              the admin preview deep-link, so it must never be renamed.
 *   name       what the day is called.
 *   wish       the headline. Written as a wish, not a label — "Happy
 *              Independence Day", not "Independence Day".
 *   subtitle   supporting line. A string, or a fn(date) for anything that
 *              counts — see "Counting" below.
 *   person     who the day is about, in full, shown small under the subtitle.
 *   when       one of three date rules, all resolved by `resolve.js`:
 *                { type: 'fixed',      month, day }
 *                { type: 'nthWeekday', month, weekday, nth }
 *                { type: 'table',      dates: { 2026: 'YYYY-MM-DD', … } }
 *              `month` is 0-indexed to match the Date API; `weekday` is
 *              0=Sunday, matching `Date#getDay`.
 *   scene      which engine draws it — see `scenes/index.js`.
 *   palette    the artwork colours, in draw order (flag bands run top→bottom).
 *   field      the colour the composition is dominated by; defaults to the
 *              last palette entry. Drives text contrast.
 *   accent     highlight colour for chips and hairlines; defaults to palette[0].
 *   ink        optional 'light' | 'dark' override. Omit it and `palette.js`
 *              solves contrast itself, which is right almost every time.
 *   emblem     Ionicons glyph shown with the wish.
 *   particles  which body the scene's engine flies/falls/rises.
 *   priority   ordering when a day carries several occasions — higher first.
 *   tags       for grouping and filtering in the admin list.
 *
 * ── Recurrence ───────────────────────────────────────────────────────────
 * A `fixed` rule carries no year, so it recurs forever: Independence Day is
 * 15 August in 2026 and in 2126. Same for `nthWeekday` (Mother's Day is always
 * the second Sunday of May) and `easter` (computed exactly, every year). Only
 * the genuinely moving festivals in `lunar.js` carry a dated table, because
 * only those actually move.
 *
 * ── Counting ─────────────────────────────────────────────────────────────
 * Every anniversary counts itself. `anniversaryOf(1947, 'Independence Day')`
 * renders "79th Independence Day" in 2026 and "80th" in 2027 with nobody
 * touching anything — the year comes from the date being rendered, not from
 * the clock, so the admin preview counts correctly for future years too.
 *
 * ── Adding a day ─────────────────────────────────────────────────────────
 * Append an entry. Nothing else needs to change: the resolver, the admin year
 * listing, the push notification and the scene registry all read from here.
 * If it's a moving festival, put the dates in `lunar.js` instead.
 * Then re-run `npm run sync:occasions` in `backend/`.
 */

import { ordinal } from './dates';
import { LUNAR_OCCASIONS, VERIFIED_THROUGH } from './lunar';
import { FOUNDED_ON, yearsSinceFounding } from '../utils/org';

export { VERIFIED_THROUGH };

/**
 * "79th Independence Day", "157th birth anniversary", "10th year of Excellence".
 *
 * Takes the year the thing started and returns a subtitle function. Clamped at
 * 1 so a date before the origin year can't render "0th" or a negative.
 */
const anniversaryOf = (fromYear, label) => (date) =>
  `${ordinal(Math.max(1, date.getFullYear() - fromYear))} ${label}`;

/* Shared palettes, so the tricolour is defined once and can never drift
   between Republic Day and Independence Day. */
export const TRICOLOUR = ['#FF9933', '#FFFFFF', '#138808'];
const NAVY = '#0B1F3A';
const IECE_RED = '#E23744';

/* ------------------------------------------------------------------ *
 * National days — fixed dates                                         *
 * ------------------------------------------------------------------ */
const NATIONAL = [
  {
    key: 'new-year',
    name: "New Year's Day",
    wish: 'Happy New Year',
    subtitle: (d) => `Here's to ${d.getFullYear()}`,
    when: { type: 'fixed', month: 0, day: 1 },
    scene: 'confetti',
    palette: ['#FFD166', '#EF476F', '#118AB2', '#1B1B2F'],
    field: '#1B1B2F',
    emblem: 'sparkles-outline',
    particles: 'confetti',
    priority: 92,
    tags: ['national', 'festival'],
  },
  {
    key: 'youth-day',
    name: 'National Youth Day',
    wish: 'Happy National Youth Day',
    subtitle: anniversaryOf(1863, 'birth anniversary'),
    person: 'Swami Vivekananda',
    when: { type: 'fixed', month: 0, day: 12 },
    scene: 'emblem',
    palette: ['#FF9933', '#FFB84D', '#6B3E00'],
    emblem: 'flame-outline',
    priority: 62,
    tags: ['national'],
  },
  {
    key: 'republic-day',
    name: 'Republic Day',
    wish: 'Happy Republic Day',
    subtitle: anniversaryOf(1950, 'Republic Day'),
    when: { type: 'fixed', month: 0, day: 26 },
    scene: 'republic', // flagship
    palette: TRICOLOUR,
    field: NAVY,
    accent: '#000080',
    ink: 'light',
    emblem: 'shield-checkmark-outline',
    particles: 'planes',
    priority: 100,
    tags: ['national'],
  },
  {
    key: 'science-day',
    name: 'National Science Day',
    wish: 'Happy National Science Day',
    subtitle: 'Curiosity is the first lesson',
    person: 'Sir Chandrasekhara Venkata Raman',
    when: { type: 'fixed', month: 1, day: 28 },
    scene: 'emblem',
    palette: ['#3A86FF', '#8338EC', '#0A1128'],
    emblem: 'flask-outline',
    priority: 48,
    tags: ['awareness', 'school'],
  },
  {
    key: 'ambedkar-jayanti',
    name: 'Ambedkar Jayanti',
    wish: 'Ambedkar Jayanti',
    subtitle: anniversaryOf(1891, 'birth anniversary'),
    person: 'Dr. Bhimrao Ramji Ambedkar',
    when: { type: 'fixed', month: 3, day: 14 },
    scene: 'emblem',
    palette: ['#2E5EAA', '#4A90D9', '#0D1B33'],
    emblem: 'book-outline',
    priority: 74,
    tags: ['national'],
  },
  {
    key: 'labour-day',
    name: 'May Day',
    wish: 'Happy May Day',
    subtitle: 'To everyone who builds and teaches',
    when: { type: 'fixed', month: 4, day: 1 },
    scene: 'emblem',
    palette: ['#D62828', '#F77F00', '#2B0A0A'],
    emblem: 'hammer-outline',
    priority: 52,
    tags: ['national', 'awareness'],
  },
  {
    key: 'kargil-diwas',
    name: 'Kargil Vijay Diwas',
    wish: 'Kargil Vijay Diwas',
    subtitle: anniversaryOf(1999, 'anniversary of the victory'),
    when: { type: 'fixed', month: 6, day: 26 },
    scene: 'emblem',
    palette: ['#4A5D23', '#8A9A5B', '#1A1F14'],
    emblem: 'shield-checkmark-outline',
    priority: 66,
    tags: ['national'],
  },
  {
    key: 'independence-day',
    name: 'Independence Day',
    wish: 'Happy Independence Day',
    subtitle: anniversaryOf(1947, 'Independence Day'),
    when: { type: 'fixed', month: 7, day: 15 },
    scene: 'independence', // flagship
    palette: TRICOLOUR,
    field: '#138808',
    accent: '#000080',
    emblem: 'flag-outline',
    particles: 'planes',
    priority: 100,
    tags: ['national'],
  },
  {
    key: 'sports-day',
    name: 'National Sports Day',
    wish: 'Happy National Sports Day',
    subtitle: anniversaryOf(1905, 'birth anniversary'),
    person: 'Major Dhyan Chand',
    when: { type: 'fixed', month: 7, day: 29 },
    scene: 'confetti',
    palette: ['#F4A261', '#2A9D8F', '#1D3557'],
    emblem: 'basketball-outline',
    particles: 'confetti',
    priority: 46,
    tags: ['awareness', 'school'],
  },
  {
    key: 'hindi-diwas',
    name: 'Hindi Diwas',
    wish: 'Hindi Diwas Ki Shubhkamnayein',
    subtitle: 'हिंदी दिवस की शुभकामनाएँ',
    when: { type: 'fixed', month: 8, day: 14 },
    scene: 'emblem',
    palette: ['#FF9933', '#FFFFFF', '#7A3E00'],
    emblem: 'language-outline',
    priority: 44,
    tags: ['national'],
  },
  {
    key: 'gandhi-jayanti',
    name: 'Gandhi Jayanti',
    wish: 'Gandhi Jayanti',
    subtitle: anniversaryOf(1869, 'birth anniversary'),
    person: 'Mohandas Karamchand Gandhi',
    when: { type: 'fixed', month: 9, day: 2 },
    scene: 'emblem',
    palette: ['#F8F4E3', '#E9E2C8', '#5C5341'],
    field: '#F8F4E3',
    accent: '#7A6A3F',
    emblem: 'glasses-outline',
    priority: 78,
    tags: ['national'],
  },
  {
    key: 'unity-day',
    name: 'National Unity Day',
    wish: 'National Unity Day',
    subtitle: anniversaryOf(1875, 'birth anniversary'),
    person: 'Sardar Vallabhbhai Patel',
    when: { type: 'fixed', month: 9, day: 31 },
    scene: 'flag',
    palette: TRICOLOUR,
    field: '#138808',
    emblem: 'people-outline',
    particles: 'birds',
    priority: 56,
    tags: ['national'],
  },
  {
    key: 'constitution-day',
    name: 'Constitution Day',
    wish: 'Constitution Day',
    subtitle: anniversaryOf(1949, 'anniversary of its adoption'),
    person: 'We, the People of India',
    when: { type: 'fixed', month: 10, day: 26 },
    scene: 'emblem',
    palette: ['#2E5EAA', '#C9A227', '#0D1B33'],
    emblem: 'document-text-outline',
    priority: 54,
    tags: ['national'],
  },
  {
    key: 'christmas',
    name: 'Christmas',
    wish: 'Merry Christmas',
    subtitle: 'Peace and goodwill',
    when: { type: 'fixed', month: 11, day: 25 },
    scene: 'lights',
    palette: ['#C1121F', '#2D6A4F', '#FFD166', '#0B1F16'],
    field: '#0B1F16',
    accent: '#FFD166',
    emblem: 'gift-outline',
    particles: 'lanterns',
    priority: 90,
    tags: ['festival'],
  },
  {
    key: 'new-years-eve',
    name: "New Year's Eve",
    wish: 'Happy New Year’s Eve',
    subtitle: (d) => `Goodbye ${d.getFullYear()}, hello ${d.getFullYear() + 1}`,
    when: { type: 'fixed', month: 11, day: 31 },
    scene: 'confetti',
    palette: ['#FFD166', '#8338EC', '#10002B'],
    field: '#10002B',
    emblem: 'sparkles-outline',
    particles: 'confetti',
    priority: 42,
    tags: ['festival'],
  },
];

/* ------------------------------------------------------------------ *
 * School days — the ones IECE's own work is about                     *
 * ------------------------------------------------------------------ */
const SCHOOL = [
  {
    key: 'teachers-day',
    name: "Teachers' Day",
    wish: 'Happy Teachers’ Day',
    subtitle: anniversaryOf(1888, 'birth anniversary'),
    person: 'Dr. Sarvepalli Radhakrishnan',
    when: { type: 'fixed', month: 8, day: 5 },
    scene: 'emblem',
    palette: ['#7B2CBF', '#C77DFF', '#2C0735'],
    accent: '#FFD166',
    emblem: 'school-outline',
    priority: 86,
    tags: ['school'],
  },
  {
    key: 'childrens-day',
    name: "Children's Day",
    wish: 'Happy Children’s Day',
    subtitle: anniversaryOf(1889, 'birth anniversary'),
    person: 'Pandit Jawaharlal Nehru',
    when: { type: 'fixed', month: 10, day: 14 },
    scene: 'sky',
    palette: ['#4CC9F0', '#F72585', '#FFD166', '#023047'],
    field: '#4CC9F0',
    emblem: 'happy-outline',
    particles: 'balloons',
    priority: 86,
    tags: ['school'],
  },
  {
    key: 'students-day',
    name: "World Students' Day",
    wish: 'World Students’ Day',
    subtitle: anniversaryOf(1931, 'birth anniversary'),
    person: 'Dr. A.P.J. Abdul Kalam',
    when: { type: 'fixed', month: 9, day: 15 },
    scene: 'emblem',
    palette: ['#3A0CA3', '#4361EE', '#06001F'],
    accent: '#FFD166',
    emblem: 'rocket-outline',
    priority: 80,
    tags: ['school'],
  },
];

/* ------------------------------------------------------------------ *
 * IECE itself — the most important day in this catalogue              *
 * ------------------------------------------------------------------ */
const COMPANY = [
  {
    key: 'iece-anniversary',
    name: 'IECE Anniversary',
    wish: 'Happy Anniversary, IECE',
    // Reuses the single source of truth for the founding date rather than
    // hard-coding 2017 a second time. `yearsSinceFounding` counts *completed*
    // years, so this reads "9th year of Excellence" from 21 June 2026.
    subtitle: (d) => `${ordinal(Math.max(1, yearsSinceFounding(d)))} year of Excellence`,
    person: 'Since 21 June 2017',
    when: { type: 'fixed', month: FOUNDED_ON.month, day: FOUNDED_ON.day },
    scene: 'anniversary', // flagship
    palette: [IECE_RED, '#FF7A85', '#FFD166', '#2B0208'],
    field: '#2B0208',
    accent: '#FFD166',
    ink: 'light',
    emblem: 'ribbon-outline',
    particles: 'confetti',
    priority: 96,
    tags: ['company'],
  },
];

/* ------------------------------------------------------------------ *
 * South Indian state days                                             *
 * ------------------------------------------------------------------ */
const REGIONAL = [
  {
    key: 'telangana-formation',
    name: 'Telangana Formation Day',
    wish: 'Happy Telangana Formation Day',
    subtitle: anniversaryOf(2014, 'Formation Day'),
    person: 'తెలంగాణ ఆవిర్భావ దినోత్సవం',
    when: { type: 'fixed', month: 5, day: 2 },
    scene: 'flag',
    palette: ['#E23744', '#FFC145', '#2B0208'],
    emblem: 'flag-outline',
    particles: 'birds',
    priority: 64,
    tags: ['regional'],
  },
  {
    key: 'ap-formation',
    name: 'Andhra Pradesh Formation Day',
    wish: 'Happy Andhra Pradesh Formation Day',
    subtitle: anniversaryOf(1956, 'Formation Day'),
    person: 'ఆంధ్రప్రదేశ్ అవతరణ దినోత్సవం',
    when: { type: 'fixed', month: 10, day: 1 },
    scene: 'flag',
    palette: ['#118AB2', '#06D6A0', '#03252E'],
    emblem: 'flag-outline',
    particles: 'birds',
    priority: 60,
    tags: ['regional'],
  },
  {
    key: 'kannada-rajyotsava',
    name: 'Kannada Rajyotsava',
    wish: 'Happy Kannada Rajyotsava',
    subtitle: anniversaryOf(1956, 'Rajyotsava'),
    person: 'ಕನ್ನಡ ರಾಜ್ಯೋತ್ಸವ ಶುಭಾಶಯಗಳು',
    when: { type: 'fixed', month: 10, day: 1 },
    scene: 'flag',
    palette: ['#FFD700', '#DC143C', '#2B0208'],
    field: '#DC143C',
    emblem: 'flag-outline',
    particles: 'birds',
    priority: 62,
    tags: ['regional'],
  },
  {
    key: 'kerala-piravi',
    name: 'Kerala Piravi',
    wish: 'Happy Kerala Piravi',
    subtitle: anniversaryOf(1956, 'Kerala Piravi'),
    person: 'കേരള പിറവി ആശംസകൾ',
    when: { type: 'fixed', month: 10, day: 1 },
    scene: 'floral',
    palette: ['#FFD166', '#06D6A0', '#04352A'],
    emblem: 'leaf-outline',
    particles: 'petals',
    priority: 61,
    tags: ['regional'],
  },
  {
    key: 'tamil-puthandu',
    name: 'Puthandu',
    wish: 'Iniya Puthandu Nalvazhthukkal',
    subtitle: 'The Tamil New Year',
    person: 'இனிய புத்தாண்டு நல்வாழ்த்துக்கள்',
    when: { type: 'fixed', month: 3, day: 14 },
    scene: 'floral',
    palette: ['#FFB703', '#FB8500', '#3D1F00'],
    emblem: 'sunny-outline',
    particles: 'petals',
    priority: 82,
    tags: ['regional', 'festival'],
  },
];

/* ------------------------------------------------------------------ *
 * Awareness days — fixed                                              *
 * ------------------------------------------------------------------ */
const AWARENESS = [
  {
    key: 'womens-day',
    name: "International Women's Day",
    wish: 'Happy Women’s Day',
    subtitle: 'To every woman who teaches, leads and builds',
    when: { type: 'fixed', month: 2, day: 8 },
    scene: 'floral',
    palette: ['#C9184A', '#FF758F', '#FFB3C1', '#3D0715'],
    field: '#C9184A',
    emblem: 'woman-outline',
    particles: 'petals',
    priority: 76,
    tags: ['awareness'],
  },
  {
    key: 'health-day',
    name: 'World Health Day',
    wish: 'World Health Day',
    subtitle: 'Look after yourself out there',
    when: { type: 'fixed', month: 3, day: 7 },
    scene: 'emblem',
    palette: ['#06D6A0', '#118AB2', '#02231C'],
    emblem: 'medkit-outline',
    priority: 40,
    tags: ['awareness'],
  },
  {
    key: 'earth-day',
    name: 'Earth Day',
    wish: 'Happy Earth Day',
    subtitle: 'One planet, one classroom',
    when: { type: 'fixed', month: 3, day: 22 },
    scene: 'floral',
    palette: ['#2D6A4F', '#95D5B2', '#081C15'],
    emblem: 'earth-outline',
    particles: 'leaves',
    priority: 42,
    tags: ['awareness'],
  },
  {
    key: 'environment-day',
    name: 'World Environment Day',
    wish: 'World Environment Day',
    subtitle: 'Plant something today',
    when: { type: 'fixed', month: 5, day: 5 },
    scene: 'floral',
    palette: ['#40916C', '#B7E4C7', '#081C15'],
    emblem: 'leaf-outline',
    particles: 'leaves',
    priority: 44,
    tags: ['awareness'],
  },
  {
    key: 'yoga-day',
    name: 'International Yoga Day',
    wish: 'Happy Yoga Day',
    subtitle: anniversaryOf(2014, 'International Yoga Day'),
    when: { type: 'fixed', month: 5, day: 21 },
    scene: 'emblem',
    palette: ['#FF9E00', '#FFD166', '#3D2200'],
    emblem: 'body-outline',
    priority: 58,
    tags: ['awareness'],
  },
];

/* ------------------------------------------------------------------ *
 * Rule-based days — the ones that move but are still computable       *
 * ------------------------------------------------------------------ */
const RULE_BASED = [
  {
    key: 'mothers-day',
    name: "Mother's Day",
    wish: 'Happy Mother’s Day',
    subtitle: 'The first teacher anyone ever has',
    when: { type: 'nthWeekday', month: 4, weekday: 0, nth: 2 },
    scene: 'floral',
    palette: ['#FF8FA3', '#FFCCD5', '#4A0D1C'],
    field: '#FF8FA3',
    emblem: 'heart-outline',
    particles: 'petals',
    priority: 72,
    tags: ['awareness'],
  },
  {
    key: 'fathers-day',
    name: "Father's Day",
    wish: 'Happy Father’s Day',
    subtitle: 'To the ones who show up, every day',
    when: { type: 'nthWeekday', month: 5, weekday: 0, nth: 3 },
    scene: 'emblem',
    palette: ['#1D3557', '#457B9D', '#0A1626'],
    accent: '#A8DADC',
    emblem: 'man-outline',
    priority: 70,
    tags: ['awareness'],
  },
  {
    key: 'friendship-day',
    name: 'Friendship Day',
    wish: 'Happy Friendship Day',
    subtitle: 'To every colleague who has your back',
    when: { type: 'nthWeekday', month: 7, weekday: 0, nth: 1 },
    scene: 'confetti',
    palette: ['#FFD166', '#06D6A0', '#EF476F', '#1B2432'],
    field: '#1B2432',
    emblem: 'people-outline',
    particles: 'confetti',
    priority: 40,
    tags: ['awareness'],
  },
];

/**
 * The full catalogue.
 *
 * Order within the array is the tiebreak when two occasions share a priority,
 * so a day is always resolved the same way — no incidental ordering from
 * object iteration.
 */
export const OCCASIONS = [
  ...NATIONAL,
  ...SCHOOL,
  ...COMPANY,
  ...REGIONAL,
  ...AWARENESS,
  ...RULE_BASED,
  ...LUNAR_OCCASIONS,
];

/** Every tag in use, in display order. Drives the admin filter chips. */
export const TAG_ORDER = ['national', 'festival', 'school', 'company', 'regional', 'awareness'];

export const TAG_LABEL = {
  national: 'National',
  festival: 'Festival',
  school: 'School',
  company: 'IECE',
  regional: 'Regional',
  awareness: 'Awareness',
};
