/**
 * Moving festivals — the dated table.
 *
 * Most of India's festivals are lunisolar or lunar and have no fixed Gregorian
 * date, so they cannot be computed the way Independence Day can. They are
 * transcribed here, year by year.
 *
 * ── Source and accuracy ──────────────────────────────────────────────────
 * Dates below are transcribed from qppstudio.net's global holidays and
 * observances tables (2026–2035), which are internally consistent: the
 * intervals between related festivals come out exactly as the Hindu calendar
 * requires (Ugadi → Rama Navami is 7–8 days in every year here; Janmashtami →
 * Ganesh Chaturthi is 11). That cross-check is the reason this source was
 * used rather than assembled from many.
 *
 * Two caveats that are inherent to the problem, not to the source:
 *
 *   · **±1 day is normal.** A tithi that spans two sunrises is observed on
 *     different days in different regions, and several festivals have a
 *     "dahan"/eve date and a "playing" date (Holi is the obvious one — this
 *     table carries the Phagwa/Purnima date, and much of North India plays
 *     Rangwali Holi the following day).
 *   · **Islamic dates depend on moon sighting** and are announced locally, so
 *     Eid al-Fitr, Eid al-Adha, Muharram and Milad-un-Nabi can land a day
 *     either side of the tabulated date.
 *
 * This is exactly why the backend override exists (`/api/occasions`): a wrong
 * or locally-different date can be corrected by an admin in a minute, without
 * shipping a new build. Treat that as the correction mechanism, not as a
 * fallback.
 *
 * ── Coverage ─────────────────────────────────────────────────────────────
 * `VERIFIED_THROUGH` is the last year the bulk of this table covers, and
 * `resolve.js` logs a single dev-only warning once the app runs past it, so
 * this cannot quietly stop working years from now. Individual entries carry
 * their own `verifiedThrough` where it differs.
 *
 * FIVE ENTRIES STILL NEED DATES (see `needsDates` below): Dussehra, Krishna
 * Janmashtami and Raksha Bandhan have 2026 only; Buddha Purnima and Vishu have
 * none. They are listed deliberately rather than omitted — the admin
 * Celebrations tab surfaces them as "dates needed" so they can be filled in
 * through the override API.
 *
 * Good Friday and Easter are NOT in this table: they are computed exactly,
 * forever, by the Computus algorithm in `resolve.js`.
 */

/** The last year the main table covers. */
export const VERIFIED_THROUGH = 2035;

export const LUNAR_OCCASIONS = [
  /* ---------------- Harvest / solar new year ---------------- */
  {
    key: 'sankranti-pongal',
    name: 'Makar Sankranti · Pongal',
    wish: 'Happy Makar Sankranti & Pongal',
    subtitle: 'The harvest, the sun, and the kites',
    when: {
      type: 'table',
      dates: {
        2026: '2026-01-14', 2027: '2027-01-15', 2028: '2028-01-15',
        2029: '2029-01-14', 2030: '2030-01-14', 2031: '2031-01-15',
        2032: '2032-01-15', 2033: '2033-01-14', 2034: '2034-01-14',
        2035: '2035-01-14',
      },
    },
    scene: 'sky',
    palette: ['#FFB703', '#FB8500', '#219EBC', '#023047'],
    field: '#219EBC',
    emblem: 'sunny-outline',
    particles: 'kites',
    priority: 90,
    tags: ['festival', 'regional'],
  },

  /* ---------------- Spring ---------------- */
  {
    key: 'maha-shivaratri',
    name: 'Maha Shivaratri',
    wish: 'Har Har Mahadev',
    subtitle: 'The great night of Shiva',
    when: {
      type: 'table',
      dates: {
        2026: '2026-02-15', 2027: '2027-03-06', 2028: '2028-02-23',
        2029: '2029-02-11', 2030: '2030-03-02', 2031: '2031-02-20',
        2032: '2032-03-10', 2033: '2033-02-27', 2034: '2034-02-17',
        2035: '2035-03-08',
      },
    },
    scene: 'lights',
    palette: ['#C9A227', '#4361EE', '#0B1026'],
    field: '#0B1026',
    emblem: 'moon-outline',
    particles: 'embers',
    priority: 74,
    tags: ['festival'],
  },
  {
    key: 'holi',
    name: 'Holi',
    wish: 'Happy Holi',
    subtitle: 'The festival of colours',
    when: {
      type: 'table',
      dates: {
        2026: '2026-03-03', 2027: '2027-03-22', 2028: '2028-03-11',
        2029: '2029-03-01', 2030: '2030-03-20', 2031: '2031-03-09',
        2032: '2032-03-27', 2033: '2033-03-16', 2034: '2034-03-05',
        2035: '2035-03-24',
      },
    },
    scene: 'confetti',
    palette: ['#FF006E', '#FFBE0B', '#3A86FF', '#8338EC', '#1A0B2E'],
    field: '#1A0B2E',
    emblem: 'color-palette-outline',
    particles: 'colour',
    priority: 90,
    tags: ['festival'],
  },
  {
    key: 'ugadi',
    name: 'Ugadi · Gudi Padwa',
    wish: 'Ugadi Subhakankshalu',
    subtitle: 'The Telugu & Kannada New Year',
    person: 'ఉగాది శుభాకాంక్షలు · ಯುಗಾದಿ ಶುಭಾಶಯಗಳು',
    when: {
      type: 'table',
      dates: {
        2026: '2026-03-20', 2027: '2027-04-08', 2028: '2028-03-27',
        2029: '2029-04-15', 2030: '2030-04-04', 2031: '2031-03-24',
        2032: '2032-04-11', 2033: '2033-03-31', 2034: '2034-03-21',
        2035: '2035-04-09',
      },
    },
    scene: 'floral',
    palette: ['#FFD166', '#06D6A0', '#F77F00', '#123524'],
    field: '#123524',
    emblem: 'leaf-outline',
    particles: 'leaves',
    priority: 92,
    tags: ['festival', 'regional'],
  },
  {
    key: 'rama-navami',
    name: 'Sri Rama Navami',
    wish: 'Sri Rama Navami Subhakankshalu',
    subtitle: 'The birth of Lord Rama',
    person: 'శ్రీ రామ నవమి',
    when: {
      type: 'table',
      dates: {
        2026: '2026-03-27', 2027: '2027-04-15', 2028: '2028-04-04',
        2029: '2029-04-23', 2030: '2030-04-12', 2031: '2031-04-01',
        2032: '2032-04-19', 2033: '2033-04-08', 2034: '2034-03-28',
        2035: '2035-04-16',
      },
    },
    scene: 'emblem',
    palette: ['#FF9E00', '#FFD166', '#3D2200'],
    emblem: 'sunny-outline',
    priority: 72,
    tags: ['festival'],
  },

  /* ---------------- Christian — computed, not tabulated ---------------- */
  {
    key: 'good-friday',
    name: 'Good Friday',
    wish: 'Good Friday',
    subtitle: 'A day of reflection',
    // Computus, offset two days before Easter Sunday. Exact forever.
    when: { type: 'easter', offset: -2 },
    scene: 'emblem',
    palette: ['#6C757D', '#ADB5BD', '#212529'],
    emblem: 'flower-outline',
    priority: 68,
    tags: ['festival'],
  },
  {
    key: 'easter',
    name: 'Easter Sunday',
    wish: 'Happy Easter',
    subtitle: 'New beginnings',
    when: { type: 'easter', offset: 0 },
    scene: 'floral',
    palette: ['#FFD6E0', '#A0E7E5', '#FFFFFF', '#4A3B52'],
    field: '#FFD6E0',
    emblem: 'flower-outline',
    particles: 'petals',
    priority: 70,
    tags: ['festival'],
  },

  /* ---------------- Islamic ---------------- */
  {
    key: 'eid-al-fitr',
    name: 'Eid al-Fitr',
    wish: 'Eid Mubarak',
    subtitle: 'Eid al-Fitr',
    when: {
      type: 'table',
      dates: {
        2026: '2026-03-20', 2027: '2027-03-09', 2028: '2028-02-26',
        2029: '2029-02-14', 2030: '2030-02-04', 2031: '2031-01-24',
        2032: '2032-01-14',
        // 2033 carries TWO Eid al-Fitrs — one in early January and one in
        // December. Only the December date is verified; the January one is
        // not in the table and should be added via the override API.
        2033: '2033-12-23', 2034: '2034-12-12', 2035: '2035-12-01',
      },
    },
    scene: 'lights',
    palette: ['#06D6A0', '#FFD166', '#04241C'],
    field: '#04241C',
    emblem: 'moon-outline',
    particles: 'lanterns',
    priority: 90,
    tags: ['festival'],
  },
  {
    key: 'eid-al-adha',
    name: 'Eid al-Adha',
    wish: 'Eid Mubarak',
    subtitle: 'Bakrid · Eid al-Adha',
    when: {
      type: 'table',
      dates: {
        2026: '2026-05-27', 2027: '2027-05-16', 2028: '2028-05-05',
        2029: '2029-04-24', 2030: '2030-04-13', 2031: '2031-04-02',
        2032: '2032-03-22', 2033: '2033-03-11', 2034: '2034-03-01',
        2035: '2035-02-18',
      },
    },
    scene: 'lights',
    palette: ['#118AB2', '#FFD166', '#03202B'],
    field: '#03202B',
    emblem: 'moon-outline',
    particles: 'lanterns',
    priority: 88,
    tags: ['festival'],
  },
  {
    key: 'muharram',
    name: 'Islamic New Year',
    wish: 'Muharram',
    subtitle: 'Islamic New Year',
    when: {
      type: 'table',
      dates: {
        2026: '2026-06-16', 2027: '2027-06-06', 2028: '2028-05-25',
        2029: '2029-05-14', 2030: '2030-05-03', 2031: '2031-04-23',
        2032: '2032-04-11', 2033: '2033-04-01', 2034: '2034-03-21',
        2035: '2035-03-11',
      },
    },
    scene: 'emblem',
    palette: ['#2D3142', '#4F5D75', '#0E1116'],
    emblem: 'moon-outline',
    priority: 60,
    tags: ['festival'],
  },
  {
    key: 'milad-un-nabi',
    name: 'Milad-un-Nabi',
    wish: 'Milad-un-Nabi Mubarak',
    subtitle: 'Eid-e-Milad',
    when: {
      type: 'table',
      dates: {
        2026: '2026-08-25', 2027: '2027-08-14', 2028: '2028-08-03',
        2029: '2029-07-24', 2030: '2030-07-13', 2031: '2031-07-02',
        2032: '2032-06-20', 2033: '2033-06-09', 2034: '2034-05-30',
        2035: '2035-05-20',
      },
    },
    scene: 'lights',
    palette: ['#06D6A0', '#FFFFFF', '#04241C'],
    field: '#04241C',
    emblem: 'moon-outline',
    particles: 'lanterns',
    priority: 66,
    tags: ['festival'],
  },

  /* ---------------- Monsoon / late summer ---------------- */
  {
    key: 'onam',
    name: 'Onam',
    wish: 'Happy Onam',
    subtitle: 'The harvest festival of Kerala',
    person: 'ഓണാശംസകൾ',
    when: {
      type: 'table',
      dates: {
        2026: '2026-08-26', 2027: '2027-09-12', 2028: '2028-09-01',
        2029: '2029-08-22', 2030: '2030-09-09', 2031: '2031-08-30',
        2032: '2032-09-16', 2033: '2033-09-07', 2034: '2034-08-28',
        2035: '2035-09-14',
      },
    },
    scene: 'floral',
    palette: ['#FFD166', '#EF476F', '#06D6A0', '#FFFFFF', '#123524'],
    field: '#123524',
    emblem: 'flower-outline',
    particles: 'petals',
    priority: 90,
    tags: ['festival', 'regional'],
  },
  {
    key: 'ganesh-chaturthi',
    name: 'Ganesh Chaturthi',
    wish: 'Ganesh Chaturthi Subhakankshalu',
    subtitle: 'Ganeshotsav',
    person: 'వినాయక చవితి',
    when: {
      type: 'table',
      dates: {
        2026: '2026-09-15', 2027: '2027-09-04', 2028: '2028-08-23',
        2029: '2029-09-12', 2030: '2030-09-01', 2031: '2031-09-20',
        2032: '2032-09-09', 2033: '2033-08-29', 2034: '2034-09-16',
        2035: '2035-09-05',
      },
    },
    scene: 'floral',
    palette: ['#F77F00', '#FFD166', '#D62828', '#2B0A0A'],
    field: '#2B0A0A',
    emblem: 'flower-outline',
    particles: 'petals',
    priority: 90,
    tags: ['festival', 'regional'],
  },

  /* ---------------- Autumn / winter ---------------- */
  {
    key: 'diwali',
    name: 'Diwali · Deepavali',
    wish: 'Happy Diwali',
    subtitle: 'The festival of lights',
    when: {
      type: 'table',
      dates: {
        2026: '2026-11-08', 2027: '2027-10-29', 2028: '2028-10-17',
        2029: '2029-11-05', 2030: '2030-10-26', 2031: '2031-11-14',
        2032: '2032-11-02', 2033: '2033-10-22', 2034: '2034-11-10',
        2035: '2035-10-30',
      },
    },
    scene: 'diwali', // flagship
    palette: ['#FFB300', '#FF6F00', '#8E24AA', '#12002B'],
    field: '#12002B',
    accent: '#FFD166',
    emblem: 'flame-outline',
    particles: 'diyas',
    priority: 98,
    tags: ['festival'],
  },
  {
    key: 'guru-nanak-jayanti',
    name: 'Guru Nanak Jayanti',
    wish: 'Guru Nanak Jayanti',
    subtitle: 'Gurpurab',
    person: 'Guru Nanak Dev Ji',
    when: {
      type: 'table',
      dates: {
        2026: '2026-11-24', 2027: '2027-11-14', 2028: '2028-12-02',
        2029: '2029-11-21', 2030: '2030-11-10', 2031: '2031-11-28',
        2032: '2032-11-17', 2033: '2033-11-06', 2034: '2034-11-26',
        2035: '2035-11-15',
      },
    },
    scene: 'lights',
    palette: ['#FF9E00', '#FFD166', '#2B1B00'],
    field: '#2B1B00',
    emblem: 'book-outline',
    particles: 'lanterns',
    priority: 64,
    tags: ['festival'],
  },

  /* ------------------------------------------------------------------ *
   * DATES STILL NEEDED                                                  *
   *                                                                     *
   * These are real, major occasions that belong in the catalogue, but a *
   * reliable ten-year table could not be sourced for them. They resolve *
   * correctly for the years they do have and are simply absent for the  *
   * rest — the admin Celebrations tab flags them so they can be filled  *
   * in through the override API.                                        *
   * ------------------------------------------------------------------ */
  {
    key: 'raksha-bandhan',
    name: 'Raksha Bandhan',
    wish: 'Happy Raksha Bandhan',
    subtitle: 'A thread, and a promise',
    when: { type: 'table', dates: { 2026: '2026-08-28' } },
    verifiedThrough: 2026,
    needsDates: true,
    scene: 'floral',
    palette: ['#EF476F', '#FFD166', '#3D0715'],
    emblem: 'ribbon-outline',
    particles: 'petals',
    priority: 76,
    tags: ['festival'],
  },
  {
    key: 'janmashtami',
    name: 'Krishna Janmashtami',
    wish: 'Happy Janmashtami',
    subtitle: 'The birth of Lord Krishna',
    person: 'కృష్ణ జన్మాష్టమి',
    when: { type: 'table', dates: { 2026: '2026-09-04' } },
    verifiedThrough: 2026,
    needsDates: true,
    scene: 'lights',
    palette: ['#3A86FF', '#FFD166', '#0A1230'],
    field: '#0A1230',
    emblem: 'musical-notes-outline',
    particles: 'embers',
    priority: 80,
    tags: ['festival'],
  },
  {
    key: 'dussehra',
    name: 'Dussehra · Vijayadashami',
    wish: 'Happy Dussehra',
    subtitle: 'Good over evil',
    when: { type: 'table', dates: { 2026: '2026-10-20' } },
    verifiedThrough: 2026,
    needsDates: true,
    scene: 'lights',
    palette: ['#D62828', '#F77F00', '#FFD166', '#2B0A0A'],
    field: '#2B0A0A',
    emblem: 'bonfire-outline',
    particles: 'embers',
    priority: 92,
    tags: ['festival'],
  },
  {
    key: 'buddha-purnima',
    name: 'Buddha Purnima',
    wish: 'Buddha Purnima',
    subtitle: 'Vesak',
    when: { type: 'table', dates: {} },
    verifiedThrough: null,
    needsDates: true,
    scene: 'lights',
    palette: ['#FFD166', '#F8F4E3', '#3D2E14'],
    field: '#3D2E14',
    emblem: 'leaf-outline',
    particles: 'lanterns',
    priority: 62,
    tags: ['festival'],
  },
  {
    key: 'vishu',
    name: 'Vishu',
    wish: 'Vishu Ashamsakal',
    subtitle: 'The Malayalam New Year',
    person: 'വിഷു ആശംസകൾ',
    when: { type: 'table', dates: {} },
    verifiedThrough: null,
    needsDates: true,
    scene: 'floral',
    palette: ['#FFD166', '#06D6A0', '#04352A'],
    emblem: 'sunny-outline',
    particles: 'petals',
    priority: 82,
    tags: ['festival', 'regional'],
  },
];
