// Single source of truth for the IECE EGM Visit / Sparked Visit report.
// Both the entry form (VisitReportForm) and the read-only view (VisitReportDetail)
// are generated from this config so labels/sections never drift.

export const RATING_OPTIONS = ['Excellent', 'Good', 'Average', 'Needs to Improve'];
export const VISIT_TYPE_OPTIONS = ['EGM Visit', 'Sparked Visit'];

// field types: 'text' | 'textarea' | 'rating' | 'radio' | 'date' | 'time'
// `prefill` marks fields auto-filled from context (still editable & mandatory).
export const REPORT_SECTIONS = [
  {
    title: 'Visit Details',
    icon: 'clipboard-outline',
    fields: [
      { key: 'schoolName', label: 'Name of the School', type: 'text', prefill: true },
      { key: 'schoolAuthority', label: 'Name & Designation of the School Authority', type: 'text' },
      { key: 'egmName', label: "EGM's Name", type: 'text', prefill: true },
      { key: 'egmDesignation', label: 'Designation', type: 'text' },
      { key: 'dateOfVisit', label: 'Date of Visit', type: 'date' },
      { key: 'visitNo', label: 'Visit No', type: 'text' },
      { key: 'entryTime', label: 'Entry Time', type: 'time' },
      { key: 'exitTime', label: 'Exit Time', type: 'time' },
      { key: 'trainersName', label: 'Trainers Name', type: 'text', prefill: true },
      { key: 'typeOfVisit', label: 'Type of Visit', type: 'radio', options: VISIT_TYPE_OPTIONS },
    ],
  },
  {
    title: 'Assembly Activities',
    icon: 'people-outline',
    fields: [
      { key: 'ongoingActivities', label: 'On Going Activities', type: 'textarea' },
      { key: 'upcomingActivities', label: 'Up Coming Activities', type: 'textarea' },
      { key: 'presentationRating', label: 'Presentation of Activities', type: 'rating' },
      { key: 'participatedInAssembly', label: 'Did you Participate in the Assembly Activity?', type: 'text' },
    ],
  },
  {
    title: 'Campus Activities',
    icon: 'business-outline',
    fields: [
      { key: 'campusMorning', label: 'Morning', type: 'textarea' },
      { key: 'campusAfternoon', label: 'Afternoon', type: 'textarea' },
      { key: 'campusEvening', label: 'Evening', type: 'textarea' },
      { key: 'campusRating', label: 'Rating', type: 'rating' },
      { key: 'campusRemarks', label: 'Observations / Remarks', type: 'textarea' },
    ],
  },
  {
    title: 'Faculty Dress Code',
    icon: 'shirt-outline',
    fields: [
      { key: 'dressCodeRating', label: 'Rating', type: 'rating' },
      { key: 'dressCodeRemarks', label: 'Observations / Remarks', type: 'textarea' },
    ],
  },
  {
    title: 'Faculty Punctuality',
    icon: 'time-outline',
    fields: [
      { key: 'punctualityRating', label: 'Rating', type: 'rating' },
      { key: 'punctualityRemarks', label: 'Observations / Remarks', type: 'textarea' },
    ],
  },
  {
    title: 'Student Manners & Etiquette / Full Sentence Words',
    icon: 'chatbubbles-outline',
    fields: [
      { key: 'studentMannersRemarks', label: 'Observations / Remarks', type: 'textarea' },
    ],
  },
  {
    title: 'Status of IECE Communication Corner',
    icon: 'megaphone-outline',
    fields: [
      { key: 'communicationCornerRemarks', label: 'Observations / Remarks', type: 'textarea' },
    ],
  },
  {
    title: 'General Assessment',
    icon: 'list-outline',
    fields: [
      { key: 'generalPoint1', label: 'Assessment Point 1', type: 'text' },
      { key: 'generalPoint2', label: 'Assessment Point 2', type: 'text' },
      { key: 'generalPoint3', label: 'Assessment Point 3', type: 'text' },
      { key: 'generalPoint4', label: 'Assessment Point 4', type: 'text' },
      { key: 'generalPoint5', label: 'Assessment Point 5', type: 'text' },
      { key: 'generalRating', label: 'General Assessment Rating', type: 'rating' },
      { key: 'generalRemarks', label: 'Observations / Remarks', type: 'textarea' },
    ],
  },
  {
    title: 'Payment Related',
    icon: 'card-outline',
    fields: [
      { key: 'paymentReminders', label: 'Is the school getting payment reminders regularly?', type: 'text' },
      { key: 'paidCurrentInstalment', label: 'Has the school paid the current instalment payment?', type: 'text' },
      { key: 'reasonForDelay', label: 'Reason for delayed payment?', type: 'text' },
      { key: 'nextPaymentDate', label: 'When is the school making the current instalment payment?', type: 'text' },
      { key: 'needsPaymentAssistance', label: 'Does the school need assistance in payment methods?', type: 'text' },
    ],
  },
  {
    title: 'Discussion with School Authorities',
    icon: 'people-circle-outline',
    fields: [
      { key: 'issuesAcademics', label: 'Issues Discussed — Academics', type: 'textarea' },
      { key: 'issuesAdministration', label: 'Issues Discussed — Administration', type: 'textarea' },
      { key: 'outcomeAcademics', label: 'Outcome of Discussion — Academics', type: 'textarea' },
      { key: 'outcomeAdministration', label: 'Outcome of Discussion — Administration', type: 'textarea' },
      { key: 'pendingIssues', label: 'Pending / Unresolved Issues', type: 'textarea' },
      { key: 'issuesRequiringHO', label: 'Issues Requiring HO Assistance', type: 'textarea' },
    ],
  },
  {
    title: 'School Authority Feedback',
    icon: 'document-text-outline',
    fields: [
      { key: 'authorityFeedback', label: 'Feedback', type: 'textarea' },
    ],
  },
];

export const ALL_FIELDS = REPORT_SECTIONS.flatMap(s => s.fields);
export const ALL_FIELD_KEYS = ALL_FIELDS.map(f => f.key);

// A blank form value map. `dateOfVisit` seeds to now; everything else empty.
export const buildInitialForm = (overrides = {}) => {
  const form = {};
  ALL_FIELDS.forEach(f => {
    form[f.key] = f.type === 'date' ? new Date().toISOString() : '';
  });
  return { ...form, ...overrides };
};

// Returns an array of {key,label} for every field left empty (all are mandatory).
export const findMissingFields = (form = {}) => {
  return ALL_FIELDS.filter(f => {
    const v = form[f.key];
    return v === undefined || v === null || String(v).trim() === '';
  }).map(f => ({ key: f.key, label: f.label }));
};
