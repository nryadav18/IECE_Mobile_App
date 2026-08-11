const PDFDocument = require('pdfkit');
const { ROLE_LABELS } = require('../roleLabels');
const {
  PAGE, M, CONTENT_W, BODY_TOP, BODY_BOTTOM,
  C, F, STATE_STYLE,
  getLogoBuffer, drawHeader, drawFooter,
  sectionTitle, paragraph, statTiles, scoreGauge, progressBar,
  pill, ellipsize, hexWithAlpha,
} = require('./layout');
const {
  periodLabel, formatDay, formatDayKey, formatMinutes, formatDuration,
} = require('./period');
const { ACTIVITY_TARGET, FIELDWORK_TARGET, gradeFor } = require('./score');

// ---------------------------------------------------------------------------
// The report document.
//
// Built entirely in memory and returned as a Buffer — nothing is written to
// disk and nothing is uploaded to Cloudinary. The buffer goes straight into the
// email as a base64 attachment and is garbage-collected the moment the send
// completes, which is exactly what was asked for: the report exists only in the
// recipient's inbox.
// ---------------------------------------------------------------------------

const roleLabel = (role) => ROLE_LABELS[role] || role;

/**
 * A thin stateful wrapper: tracks the cursor, adds pages with the right chrome,
 * and knows how to draw a table that survives a page break. pdf composition
 * code below never touches doc.y directly.
 */
class ReportDoc {
  constructor({ title, subtitle, footerNote }) {
    this.doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      autoFirstPage: false,  // so every page, including the first, gets chrome
      bufferPages: true,     // so footers can be stamped once the total is known
      info: { Title: title, Author: 'IECE', Creator: 'IECE Dashboard' },
    });
    this.title = title;
    this.subtitle = subtitle;
    this.footerNote = footerNote;
    // Opened once, drawn on every page: PDFKit embeds the PNG a single time and
    // each header just references it. Passing the raw buffer to doc.image()
    // instead would re-embed the file on every page.
    const buf = getLogoBuffer();
    this.logo = buf ? this.doc.openImage(buf) : null;
    this.y = BODY_TOP;
    this.chunks = [];
    this.doc.on('data', (c) => this.chunks.push(c));
    this.done = new Promise((resolve) => this.doc.on('end', () => resolve(Buffer.concat(this.chunks))));
  }

  newPage(variant = 'page') {
    this.doc.addPage({ size: 'A4', margin: 0 });
    drawHeader(this.doc, {
      title: this.title,
      subtitle: this.subtitle,
      logo: this.logo,
      variant,
    });
    this.y = BODY_TOP;
    return this.y;
  }

  /** Make sure `height` points are free below the cursor, else start a page. */
  ensure(height) {
    if (this.y + height > BODY_BOTTOM) this.newPage();
    return this.y;
  }

  gap(n = 12) {
    this.y += n;
    return this.y;
  }

  section(text, sub) {
    this.ensure(sub ? 62 : 44);
    this.y = sectionTitle(this.doc, this.y, text, sub);
    return this.y;
  }

  para(text, opts) {
    this.ensure(30);
    this.y = paragraph(this.doc, this.y, text, opts);
    return this.y;
  }

  tiles(list, opts = {}) {
    const columns = opts.columns || 3;
    const height = opts.height || 56;
    const rows = Math.ceil(list.length / columns);
    this.ensure(rows * (height + 10));
    this.y = statTiles(this.doc, this.y, list, { columns, height });
    return this.y;
  }

  /**
   * A table. Columns are { label, key, width (fraction of the content width),
   * align, wrap, color }. A row that would cross the bottom margin moves to the
   * next page and the column header is redrawn there, so a long activity list
   * never turns into an orphaned block of unlabelled cells.
   */
  table({ columns, rows, emptyText = 'Nothing recorded this month.', zebra = true }) {
    const doc = this.doc;
    const widths = columns.map((c) => c.width * CONTENT_W);

    if (!rows.length) {
      this.ensure(30);
      doc.font(F.oblique).fontSize(8.5).fillColor(C.faint);
      doc.text(emptyText, M, this.y, { width: CONTENT_W });
      this.y = doc.y + 10;
      return this.y;
    }

    const drawHead = () => {
      this.ensure(24);
      const hy = this.y;
      doc.rect(M, hy, CONTENT_W, 18).fill(C.brandSoft);
      let x = M;
      columns.forEach((col, i) => {
        doc.font(F.bold).fontSize(7.5).fillColor(C.brandDark);
        // Clipped, never wrapped: a two-line header in a narrow numeric column
        // ("PRESEN / T") pushes the label out of its own row and misaligns the
        // whole table. lineBreak:false alone does not reliably prevent it once
        // characterSpacing is in play, so measure and truncate explicitly.
        // No characterSpacing here on purpose: ellipsize measures the plain
        // string, so any extra tracking would make the real text wider than the
        // width it was fitted to and wrap anyway.
        const label = ellipsize(doc, String(col.label).toUpperCase(), widths[i] - 12, F.bold, 7.5);
        doc.text(label, x + 6, hy + 5.5, {
          width: widths[i] - 12, align: col.align || 'left', lineBreak: false,
        });
        x += widths[i];
      });
      this.y = hy + 18;
    };

    drawHead();

    rows.forEach((row, rIdx) => {
      // Measure first: a wrapping cell decides the row's height.
      let rowH = 17;
      columns.forEach((col, i) => {
        if (!col.wrap) return;
        doc.font(F.regular).fontSize(8);
        const h = doc.heightOfString(String(row[col.key] ?? ''), { width: widths[i] - 12 }) + 9;
        if (h > rowH) rowH = h;
      });

      if (this.y + rowH > BODY_BOTTOM) {
        this.newPage();
        drawHead();
      }

      const ry = this.y;
      if (zebra && rIdx % 2 === 1) doc.rect(M, ry, CONTENT_W, rowH).fill(C.soft);

      let x = M;
      columns.forEach((col, i) => {
        const raw = row[col.key];
        const value = raw === null || raw === undefined ? '—' : String(raw);
        const color = (typeof col.color === 'function' ? col.color(row) : col.color) || C.body;
        const font = col.bold ? F.bold : F.regular;

        if (col.pill && raw) {
          pill(doc, x + 6, ry + 3.5, value, color);
        } else {
          doc.font(font).fontSize(8).fillColor(color);
          const text = col.wrap ? value : ellipsize(doc, value, widths[i] - 12, font, 8);
          doc.text(text, x + 6, ry + 5, {
            width: widths[i] - 12, align: col.align || 'left', lineBreak: !!col.wrap,
          });
        }
        x += widths[i];
      });

      doc.moveTo(M, ry + rowH).lineTo(M + CONTENT_W, ry + rowH).lineWidth(0.4).stroke(C.line);
      this.y = ry + rowH;
    });

    this.y += 10;
    return this.y;
  }

  /** Stamp footers on every buffered page, then close the stream. */
  async finish() {
    const range = this.doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      this.doc.switchToPage(range.start + i);
      drawFooter(this.doc, {
        pageNumber: i + 1,
        pageCount: range.count,
        note: this.footerNote,
      });
    }
    this.doc.end();
    return this.done;
  }
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** The identity card: who this is about, and their headline score. */
function personHeader(rd, m, { compact = false } = {}) {
  const doc = rd.doc;
  const h = compact ? 74 : 104;
  rd.ensure(h + 8);
  const y = rd.y;

  doc.roundedRect(M, y, CONTENT_W, h, 9).fill(C.soft);
  doc.roundedRect(M, y, CONTENT_W, h, 9).lineWidth(0.6).stroke(C.line);

  doc.font(F.bold).fontSize(compact ? 14 : 18).fillColor(C.ink);
  doc.text(ellipsize(doc, m.user.name, CONTENT_W - 190, F.bold, compact ? 14 : 18), M + 18, y + (compact ? 13 : 18), { lineBreak: false });

  const roleY = y + (compact ? 32 : 43);
  const pw = pill(doc, M + 18, roleY, roleLabel(m.user.role), C.brand, { size: 8 });

  const teamText = m.user.teamName
    || (m.user.teamNames.length ? m.user.teamNames.join(', ') : null);
  if (teamText) {
    doc.font(F.regular).fontSize(8.5).fillColor(C.muted);
    doc.text(ellipsize(doc, teamText, CONTENT_W - 210 - pw, F.regular, 8.5), M + 18 + pw + 8, roleY + 3, { lineBreak: false });
  }

  const schoolText = m.user.isAnonymous
    ? 'Anonymous location — works across sites, not tied to one campus'
    : (m.user.schools.length ? m.user.schools.map((s) => s.name).join(' · ') : 'No school assigned');
  doc.font(F.regular).fontSize(8).fillColor(C.faint);
  doc.text(ellipsize(doc, schoolText, CONTENT_W - 190, F.regular, 8), M + 18, y + (compact ? 51 : 66), { lineBreak: false });

  if (!compact) {
    doc.font(F.regular).fontSize(8).fillColor(C.faint);
    doc.text(m.user.email, M + 18, y + 80, { width: CONTENT_W - 190, lineBreak: false });
  }

  // Score on the right.
  const perf = m.performance;
  const gx = M + CONTENT_W - (compact ? 74 : 96);
  if (compact) {
    doc.font(F.bold).fontSize(20).fillColor(perf.grade.color);
    doc.text(String(perf.score), gx - 20, y + 18, { width: 60, align: 'right', lineBreak: false });
    doc.font(F.regular).fontSize(7.5).fillColor(C.faint);
    doc.text('/ 100', gx + 42, y + 27, { width: 30, lineBreak: false });
    pill(doc, gx - 20, y + 44, `${perf.grade.grade} · ${perf.grade.label}`, perf.grade.color, { size: 7.5 });
  } else {
    scoreGauge(doc, gx, y + h / 2, 36, perf);
    const label = `${perf.grade.grade} · ${perf.grade.label}`;
    doc.font(F.bold).fontSize(8);
    const w = doc.widthOfString(label) + 12;
    pill(doc, gx - w / 2, y + h - 16, label, perf.grade.color, { size: 8 });
  }

  rd.y = y + h + 16;
  return rd.y;
}

/** How the score was arrived at — one bar per applicable dimension. */
function scoreBreakdown(rd, m) {
  const perf = m.performance;
  rd.section(
    'How this score was calculated',
    'Only the dimensions this login can actually act on are scored; their weights are '
    + 'rebalanced to total 100 so people in different roles remain comparable.',
  );

  perf.dimensions.forEach((d) => {
    rd.ensure(34);
    rd.y = progressBar(rd.doc, rd.y, {
      label: `${d.label}  (${d.weight.toFixed(0)}%)`,
      value: d.points,
      max: d.weight,
      caption: d.basis,
      color: perf.grade.color,
      labelWidth: 180,
    });
  });

  rd.ensure(26);
  rd.doc.moveTo(M, rd.y).lineTo(M + CONTENT_W, rd.y).lineWidth(0.6).stroke(C.line);
  rd.y += 8;
  rd.doc.font(F.bold).fontSize(9.5).fillColor(C.ink);
  rd.doc.text('Total', M, rd.y, { width: 200, lineBreak: false });
  rd.doc.font(F.bold).fontSize(9.5).fillColor(perf.grade.color);
  rd.doc.text(`${perf.score} / 100  ·  ${perf.grade.grade} ${perf.grade.label}`, M + CONTENT_W - 220, rd.y, {
    width: 220, align: 'right', lineBreak: false,
  });
  rd.y += 20;
  return rd.y;
}

/** The month as a colour-coded calendar, plus its legend. */
function attendanceCalendar(rd, m) {
  const doc = rd.doc;
  const cells = m.calendar;
  if (!cells.length) return rd.y;

  const cellW = CONTENT_W / 7;
  const cellH = 34;
  const firstWeekday = cells[0].weekday;
  const rowCount = Math.ceil((firstWeekday + cells.length) / 7);

  rd.ensure(18 + rowCount * cellH + 46);
  let y = rd.y;

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  dayNames.forEach((d, i) => {
    doc.font(F.bold).fontSize(7).fillColor(C.faint);
    doc.text(d.toUpperCase(), M + i * cellW, y, { width: cellW, align: 'center', lineBreak: false, characterSpacing: 0.4 });
  });
  y += 13;

  cells.forEach((cell, idx) => {
    const pos = firstWeekday + idx;
    const col = pos % 7;
    const row = Math.floor(pos / 7);
    const x = M + col * cellW;
    const cy = y + row * cellH;
    const style = STATE_STYLE[cell.state] || STATE_STYLE.absent;

    // A pale wash keeps the grid readable at a glance; the dot carries the
    // exact state so the two never rely on colour discrimination alone.
    doc.roundedRect(x + 2, cy + 2, cellW - 4, cellH - 4, 5).fill(hexWithAlpha(style.color, 0.12));
    doc.roundedRect(x + 2, cy + 2, cellW - 4, cellH - 4, 5).lineWidth(0.5).stroke(hexWithAlpha(style.color, 0.35));

    doc.font(F.bold).fontSize(9).fillColor(cell.state === 'sunday' ? C.faint : C.ink);
    doc.text(String(cell.day), x + 2, cy + 7, { width: cellW - 4, align: 'center', lineBreak: false });

    doc.circle(x + cellW / 2, cy + cellH - 8, 2.6).fill(style.color);
  });

  y += rowCount * cellH + 12;

  // Legend — only the states that actually occurred, so it stays short.
  const used = [...new Set(cells.map((c) => c.state))];
  if (m.attendance.substituteDutyDays > 0) used.push('__duty');
  let lx = M;
  let ly = y;
  used.forEach((state) => {
    const style = state === '__duty'
      ? { color: C.substituted, label: 'Also covered another post' }
      : STATE_STYLE[state];
    if (!style) return;
    doc.font(F.regular).fontSize(7.5);
    const w = doc.widthOfString(style.label) + 20;
    if (lx + w > M + CONTENT_W) { lx = M; ly += 14; }
    doc.circle(lx + 4, ly + 4, 3.2).fill(style.color);
    doc.fillColor(C.muted).text(style.label, lx + 12, ly + 1, { width: w, lineBreak: false });
    lx += w;
  });

  rd.y = ly + 20;
  return rd.y;
}

function attendanceSection(rd, m, { compact = false } = {}) {
  const a = m.attendance;
  rd.section(
    'Attendance',
    compact ? null
      : `Working days exclude Sundays and any day a school this person is assigned to was `
        + `closed on an approved holiday. Days actually worked are always counted, even on a Sunday or a holiday.`,
  );

  // Only appears on an early re-run; the monthly cron always reports a month
  // that has ended, so this banner is normally absent.
  if (a.isPartialMonth) {
    rd.ensure(34);
    rd.doc.roundedRect(M, rd.y, CONTENT_W, 26, 6).fill(hexWithAlpha(C.partial, 0.13));
    rd.doc.font(F.bold).fontSize(8.5).fillColor('#92400E');
    rd.doc.text(
      `Interim report — this month is not over. ${a.upcomingDays} day(s) have not happened yet and are excluded from every figure below.`,
      M + 12, rd.y + 9, { width: CONTENT_W - 24, lineBreak: false },
    );
    rd.y += 36;
  }

  rd.tiles([
    { label: 'Working days', value: a.workingDays, hint: `${a.totalDays} days in the month`, color: C.brand },
    { label: 'Present', value: a.presentDays, hint: 'Checked in and out', color: C.present },
    { label: 'Half days', value: a.partialDays, hint: 'No check-out recorded', color: C.partial },
    { label: 'Absent', value: a.absentDays, hint: 'Unexplained working days', color: C.absent },
    { label: 'On leave', value: a.leaveDays, hint: 'Approved personal leave', color: C.leave },
    { label: 'School holidays', value: a.holidayDays, hint: 'A school was closed', color: C.holiday },
    { label: 'On school visit', value: a.visitDays, hint: 'On duty, off campus', color: C.visit },
    { label: 'Covered by a substitute', value: a.substitutedDays, hint: 'Someone held their post', color: C.substituted },
    {
      label: 'Attendance rate',
      value: `${a.rate.toFixed(1)}%`,
      hint: `of ${a.expectedDays} expected day(s)`,
      color: a.rate >= 90 ? C.present : a.rate >= 75 ? C.partial : C.absent,
    },
  ], { columns: 3 });

  attendanceCalendar(rd, m);

  if (a.extraDaysWorked > 0) {
    rd.ensure(30);
    rd.doc.roundedRect(M, rd.y, CONTENT_W, 24, 6).fill(hexWithAlpha(C.present, 0.1));
    rd.doc.font(F.bold).fontSize(8.5).fillColor(C.present);
    rd.doc.text(
      `Worked ${a.extraDaysWorked} day(s) outside the normal week — on a Sunday or a school holiday.`,
      M + 12, rd.y + 8, { width: CONTENT_W - 24, lineBreak: false },
    );
    rd.y += 34;
  }

  return rd.y;
}

function substitutionSection(rd, m) {
  const s = m.substitution;
  if (s.coveredDays === 0 && s.dutyDays === 0) return rd.y;

  rd.section('Substitution');
  rd.tiles([
    { label: 'Days covered by a substitute', value: s.coveredDays, hint: 'They were away; someone held their post', color: C.substituted },
    { label: 'Days worked as a substitute', value: s.dutyDays, hint: 'Extra duty covering another post', color: C.present },
  ], { columns: 2, height: 52 });

  rd.table({
    columns: [
      { label: 'Direction', key: 'direction', width: 0.3 },
      { label: 'From', key: 'from', width: 0.19 },
      { label: 'To', key: 'to', width: 0.19 },
      { label: 'Days', key: 'days', width: 0.09, align: 'right' },
      { label: 'Reason', key: 'reason', width: 0.23, wrap: true },
    ],
    rows: s.detail.map((d) => ({
      direction: d.role === 'covered' ? 'Covered by a substitute' : 'Worked as the substitute',
      from: formatDay(d.from),
      to: formatDay(d.to),
      days: d.days,
      reason: d.reason || '—',
    })),
  });
  return rd.y;
}

function activitiesSection(rd, m) {
  const a = m.activities;
  rd.section(
    'Activities',
    `Counted by when the activity was uploaded. Approved work counts in full towards the score, `
    + `work still awaiting a decision counts half, and rejected work counts nothing. `
    + `A full month is ${ACTIVITY_TARGET} activities.`,
  );

  rd.tiles([
    { label: 'Uploaded', value: a.uploaded, hint: 'Published by this person', color: C.brand },
    { label: 'Approved', value: a.approved, hint: 'Passed review', color: C.present },
    { label: 'Awaiting review', value: a.pending, hint: 'With their approver', color: C.partial },
    { label: 'Rejected', value: a.rejected, hint: 'Sent back', color: C.absent },
    { label: 'As tagged organiser', value: a.asOrganizer, hint: "On colleagues' activities", color: C.substituted },
    { label: 'Star activities', value: a.starred, hint: 'Highlighted by a head', color: '#CA8A04' },
  ], { columns: 3 });

  const statusColor = (row) => (
    row.status === 'approved' ? C.present : row.status === 'rejected' ? C.absent : C.partial
  );

  rd.table({
    columns: [
      { label: 'Date', key: 'date', width: 0.14 },
      { label: 'Activity', key: 'name', width: 0.36, wrap: true },
      { label: 'School', key: 'school', width: 0.24 },
      { label: 'Role', key: 'role', width: 0.14 },
      { label: 'Status', key: 'status', width: 0.12, pill: true, color: statusColor },
    ],
    rows: a.list.map((x) => ({
      date: formatDay(x.date),
      name: `${x.isStarred ? '* ' : ''}${x.name}`,
      school: x.schoolName,
      role: x.asOrganizer ? 'Organiser' : 'Uploaded',
      status: x.status.charAt(0).toUpperCase() + x.status.slice(1),
    })),
    emptyText: 'No activities were uploaded or organised this month.',
  });
  return rd.y;
}

function fieldWorkSection(rd, m, { applicable }) {
  if (!applicable && m.schoolVisits.completed === 0 && m.visitReports.filed === 0) return rd.y;

  rd.section(
    'School visits & visit reports',
    `Inspection duty raised through the app and the reports filed afterwards. `
    + `A full month is ${FIELDWORK_TARGET} visits and reports combined.`,
  );

  rd.tiles([
    { label: 'School visits', value: m.schoolVisits.completed, hint: `${m.schoolVisits.days} day(s) on visit`, color: C.visit },
    { label: 'Visit reports filed', value: m.visitReports.filed, hint: `${m.visitReports.approved} approved`, color: C.brand },
    { label: 'Reports about them', value: m.visitReports.received, hint: 'Filed by an inspector', color: C.muted },
  ], { columns: 3, height: 52 });

  if (m.schoolVisits.detail.length) {
    rd.table({
      columns: [
        { label: 'School', key: 'school', width: 0.3 },
        { label: 'From', key: 'from', width: 0.16 },
        { label: 'To', key: 'to', width: 0.16 },
        { label: 'Days', key: 'days', width: 0.08, align: 'right' },
        { label: 'Purpose', key: 'purpose', width: 0.3, wrap: true },
      ],
      rows: m.schoolVisits.detail.map((v) => ({
        school: v.schoolName,
        from: formatDay(v.from),
        to: formatDay(v.to),
        days: v.days,
        purpose: v.purpose || '—',
      })),
      emptyText: 'No school visits this month.',
    });
  }

  if (m.visitReports.detail.length) {
    rd.ensure(24);
    rd.doc.font(F.bold).fontSize(9).fillColor(C.ink);
    rd.doc.text('Visit reports filed', M, rd.y, { lineBreak: false });
    rd.y += 15;
    rd.table({
      columns: [
        { label: 'Inspected on', key: 'date', width: 0.2 },
        { label: 'School', key: 'school', width: 0.34 },
        { label: 'Person met', key: 'personMet', width: 0.28 },
        { label: 'Status', key: 'status', width: 0.18, pill: true, color: (r) => (r.status === 'Approved' ? C.present : r.status === 'Rejected' ? C.absent : C.partial) },
      ],
      rows: m.visitReports.detail.map((r) => ({
        date: formatDay(r.date),
        school: r.schoolName,
        personMet: r.personMet,
        status: r.status.charAt(0).toUpperCase() + r.status.slice(1),
      })),
    });
  }
  return rd.y;
}

function leaveSection(rd, m) {
  if (m.leave.requests === 0) return rd.y;
  rd.section('Leave taken', 'Approved leave only. Leave is authorised time off and is removed from the days attendance is judged against — it is never counted as an absence.');
  rd.table({
    columns: [
      { label: 'From', key: 'from', width: 0.17 },
      { label: 'To', key: 'to', width: 0.17 },
      { label: 'Days', key: 'days', width: 0.09, align: 'right' },
      { label: 'Type', key: 'type', width: 0.15 },
      { label: 'Reason', key: 'reason', width: 0.42, wrap: true },
    ],
    rows: m.leave.detail.map((l) => ({
      from: formatDay(l.from),
      to: formatDay(l.to),
      days: l.days,
      type: l.isEmergency ? 'Emergency' : 'Personal',
      reason: l.reason,
    })),
  });
  return rd.y;
}

function holidaySection(rd, m) {
  if (!m.holidays.detail.length) return rd.y;
  rd.section('School holidays', 'Approved closures at the schools this person is assigned to. A day is treated as a holiday for them when any one of their schools was closed.');
  rd.table({
    columns: [
      { label: 'Date', key: 'date', width: 0.2 },
      { label: 'School', key: 'school', width: 0.4 },
      { label: 'Reason', key: 'reason', width: 0.4, wrap: true },
    ],
    rows: m.holidays.detail.map((h) => ({
      date: formatDayKey(h.date),
      school: h.schoolName,
      reason: h.reason || '—',
    })),
  });
  return rd.y;
}

function approvalsSection(rd, m) {
  if (m.approvals.total === 0) return rd.y;
  const hrs = m.approvals.avgTurnaroundHours;
  rd.section('Approvals actioned', 'Decisions this person took on requests from the people who report to them, and how quickly they took them.');

  rd.tiles([
    { label: 'Decisions taken', value: m.approvals.total, hint: 'Approved or rejected', color: C.brand },
    {
      label: 'Average turnaround',
      value: hrs === null ? '—' : (hrs < 48 ? `${hrs.toFixed(1)} h` : `${(hrs / 24).toFixed(1)} d`),
      hint: 'From raised to decided',
      color: hrs === null ? C.muted : hrs <= 24 ? C.present : hrs <= 72 ? C.partial : C.absent,
    },
    {
      label: 'Kinds handled',
      value: Object.keys(m.approvals.byType).length,
      hint: Object.keys(m.approvals.byType).map((k) => k.replace(/_/g, ' ')).join(', ') || '—',
      color: C.substituted,
    },
  ], { columns: 3, height: 52 });
  return rd.y;
}

function engagementSection(rd, m) {
  const p = m.punctuality;
  rd.section('Working hours & engagement');
  rd.tiles([
    { label: 'Average check-in', value: formatMinutes(p.avgCheckIn), hint: 'On-time cut-off 09:30', color: C.brand },
    { label: 'Average check-out', value: formatMinutes(p.avgCheckOut), hint: 'Across days closed', color: C.brand },
    { label: 'Total hours on duty', value: formatDuration(p.totalMinutes), hint: `${formatDuration(p.avgMinutesPerDay)} per day`, color: C.present },
    { label: 'On-time arrivals', value: `${p.onTimeDays}/${p.ratedDays}`, hint: `${p.lateDays} late`, color: p.lateDays === 0 ? C.present : C.partial },
    { label: 'Meetings posted', value: m.meetings.posted, hint: 'Shared in Meeting Corner', color: C.substituted },
    { label: 'Media uploaded', value: m.media.uploaded, hint: `${m.media.approved} approved`, color: C.leave },
  ], { columns: 3 });

  if (m.meetings.detail.length) {
    rd.table({
      columns: [
        { label: 'Date', key: 'date', width: 0.16 },
        { label: 'Agenda', key: 'agenda', width: 0.52, wrap: true },
        { label: 'Platform', key: 'platform', width: 0.18 },
        { label: 'Shared with', key: 'recipients', width: 0.14, align: 'right' },
      ],
      rows: m.meetings.detail.map((x) => ({
        date: formatDay(x.date),
        agenda: x.agenda,
        platform: x.platform.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        recipients: x.recipients,
      })),
    });
  }
  return rd.y;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const FOOTER_NOTE = 'IECE Dashboard · Confidential — for the named recipient and their reporting line only';

/** The full individual report: everything about one person, in order. */
function renderIndividual(rd, m, { fieldworkApplicable }) {
  personHeader(rd, m);
  scoreBreakdown(rd, m);
  attendanceSection(rd, m);
  substitutionSection(rd, m);
  leaveSection(rd, m);
  holidaySection(rd, m);
  activitiesSection(rd, m);
  fieldWorkSection(rd, m, { applicable: fieldworkApplicable });
  approvalsSection(rd, m);
  engagementSection(rd, m);
}

/** The one-page condensed form used for each member inside a manager bundle. */
function renderCompactPerson(rd, m) {
  rd.newPage();
  personHeader(rd, m, { compact: true });

  const a = m.attendance;
  rd.tiles([
    { label: 'Working days', value: a.workingDays, color: C.brand },
    { label: 'Present', value: a.presentDays, hint: `${a.partialDays} half day(s)`, color: C.present },
    { label: 'Absent', value: a.absentDays, color: C.absent },
    { label: 'Attendance', value: `${a.rate.toFixed(1)}%`, color: a.rate >= 90 ? C.present : a.rate >= 75 ? C.partial : C.absent },
    { label: 'Leave', value: a.leaveDays, color: C.leave },
    { label: 'Holidays', value: a.holidayDays, color: C.holiday },
    { label: 'Activities', value: m.activities.uploaded, hint: `${m.activities.approved} approved`, color: C.brand },
    { label: 'School visits', value: m.schoolVisits.completed, hint: `${m.visitReports.filed} report(s)`, color: C.visit },
    { label: 'Substitution', value: `${a.substitutedDays} / ${a.substituteDutyDays}`, hint: 'covered / covered for others', color: C.substituted },
  ], { columns: 3, height: 50 });

  attendanceCalendar(rd, m);

  if (m.activities.list.length) {
    rd.ensure(24);
    rd.doc.font(F.bold).fontSize(9).fillColor(C.ink);
    rd.doc.text('Activities this month', M, rd.y, { lineBreak: false });
    rd.y += 15;
    rd.table({
      columns: [
        { label: 'Date', key: 'date', width: 0.15 },
        { label: 'Activity', key: 'name', width: 0.43, wrap: true },
        { label: 'School', key: 'school', width: 0.27 },
        { label: 'Status', key: 'status', width: 0.15, pill: true, color: (r) => (r.status === 'Approved' ? C.present : r.status === 'Rejected' ? C.absent : C.partial) },
      ],
      rows: m.activities.list.slice(0, 10).map((x) => ({
        date: formatDay(x.date),
        name: x.name,
        school: x.schoolName,
        status: x.status.charAt(0).toUpperCase() + x.status.slice(1),
      })),
    });
    if (m.activities.list.length > 10) {
      rd.para(`+ ${m.activities.list.length - 10} more — see the full list in the app.`, { size: 7.5, color: C.faint });
    }
  }
}

/** A ranked table of people. Shared by the manager and admin bundles. */
function leaderboard(rd, list, { title, sub, showTeam = false } = {}) {
  rd.section(title, sub);
  // Widths are fractions of the content width and must total 1.00.
  const columns = [
    { label: '#', key: 'rank', width: 0.05, align: 'right' },
    { label: 'Name', key: 'name', width: showTeam ? 0.21 : 0.30, bold: true },
    { label: 'Role', key: 'role', width: showTeam ? 0.14 : 0.17 },
  ];
  if (showTeam) columns.push({ label: 'Team', key: 'team', width: 0.14 });
  // Short labels on the numeric columns: they have to survive being narrow, and
  // a clipped "PRESEN…" reads far worse than "Pres.".
  columns.push(
    { label: 'Pres.', key: 'present', width: 0.1, align: 'right' },
    { label: 'Abs.', key: 'absent', width: 0.07, align: 'right' },
    { label: 'Att %', key: 'rate', width: 0.08, align: 'right' },
    { label: 'Acts', key: 'acts', width: 0.07, align: 'right' },
    { label: 'Vis.', key: 'visits', width: 0.06, align: 'right' },
    { label: 'Score', key: 'score', width: showTeam ? 0.08 : 0.1, align: 'right', bold: true, color: (r) => r._color },
  );

  rd.table({
    columns,
    rows: list.map((m, i) => ({
      rank: i + 1,
      name: m.user.name,
      role: roleLabel(m.user.role),
      team: m.user.teamName || (m.user.teamNames.length ? `${m.user.teamNames.length} team(s)` : '—'),
      present: `${m.attendance.presentDays}/${m.attendance.workingDays}`,
      absent: m.attendance.absentDays,
      rate: `${m.attendance.rate.toFixed(0)}%`,
      acts: m.activities.uploaded,
      visits: m.schoolVisits.completed,
      score: m.performance.score,
      _color: m.performance.grade.color,
    })),
    emptyText: 'No staff in scope this month.',
  });
  return rd.y;
}

/**
 * An individual's report. When `team` is supplied the same document continues
 * with a team leaderboard and one condensed page per person under them, so a
 * manager receives a single file rather than a pile of attachments.
 *
 * @returns {Promise<Buffer>}
 */
async function buildIndividualPdf(m, { team = [], period } = {}) {
  const label = periodLabel(period || m.period);
  const rd = new ReportDoc({
    title: `Monthly Performance Report · ${label}`,
    subtitle: `${m.user.name} — ${roleLabel(m.user.role)}`,
    footerNote: FOOTER_NOTE,
  });

  rd.newPage('cover');
  renderIndividual(rd, m, { fieldworkApplicable: m.performance.dimensions.some((d) => d.key === 'fieldwork') });

  if (team.length) {
    rd.newPage();
    const ranked = [...team].sort((a, b) => b.performance.score - a.performance.score);
    leaderboard(rd, ranked, {
      title: 'My team this month',
      sub: `${team.length} person(s) reporting to you, ranked by overall score. A condensed report for each follows.`,
    });

    const avg = (fn) => (team.reduce((s, x) => s + fn(x), 0) / team.length);
    rd.tiles([
      { label: 'Team size', value: team.length, color: C.brand },
      { label: 'Average attendance', value: `${avg((x) => x.attendance.rate).toFixed(1)}%`, color: C.present },
      { label: 'Average score', value: avg((x) => x.performance.score).toFixed(0), color: C.brand },
      { label: 'Activities uploaded', value: team.reduce((s, x) => s + x.activities.uploaded, 0), color: C.brand },
      { label: 'Total absences', value: team.reduce((s, x) => s + x.attendance.absentDays, 0), color: C.absent },
      { label: 'School visits', value: team.reduce((s, x) => s + x.schoolVisits.completed, 0), color: C.visit },
    ], { columns: 3, height: 52 });

    const attention = ranked.filter((x) => x.performance.score < 60 || x.attendance.rate < 75);
    if (attention.length) {
      rd.section('Needs attention', 'Anyone below 60 overall or under 75% attendance.');
      rd.table({
        columns: [
          { label: 'Name', key: 'name', width: 0.3, bold: true },
          { label: 'Role', key: 'role', width: 0.22 },
          { label: 'Attendance', key: 'rate', width: 0.16, align: 'right' },
          { label: 'Absent', key: 'absent', width: 0.14, align: 'right' },
          { label: 'Score', key: 'score', width: 0.18, align: 'right', bold: true, color: (r) => r._color },
        ],
        rows: attention.map((x) => ({
          name: x.user.name,
          role: roleLabel(x.user.role),
          rate: `${x.attendance.rate.toFixed(0)}%`,
          absent: x.attendance.absentDays,
          score: x.performance.score,
          _color: x.performance.grade.color,
        })),
      });
    }

    ranked.forEach((member) => renderCompactPerson(rd, member));
  }

  return rd.finish();
}

/**
 * A report about ONE TEAM, requested on demand by the Admin.
 *
 * Deliberately the same document shape as the team half of a leader's monthly
 * bundle — overview, ranked table, attention list, then a page per member — so
 * an admin comparing what they pulled with what the leader received is reading
 * the same layout rather than two different ones.
 *
 * Unlike the leader's bundle there is no "my own performance" opening section:
 * the subject here is the team, not a person, and the leaders of that team
 * appear in the ranking alongside everyone else.
 *
 * @param {Array}  members - metrics bundles for everyone in the team
 * @param {object} opts    - { period, teamName }
 * @returns {Promise<Buffer>}
 */
async function buildTeamPdf(members, { period, teamName }) {
  const label = periodLabel(period);
  const rd = new ReportDoc({
    title: `Team Performance Report · ${label}`,
    subtitle: `${teamName} — ${members.length} member(s)`,
    footerNote: FOOTER_NOTE,
  });

  rd.newPage('cover');

  const n = members.length || 1;
  const sum = (fn) => members.reduce((s, x) => s + fn(x), 0);
  const avgRate = sum((x) => x.attendance.rate) / n;
  const avgScore = sum((x) => x.performance.score) / n;
  const partial = members.some((x) => x.attendance.isPartialMonth);

  rd.section(
    `${teamName} — ${label}`,
    'Every monitored member of this team. Figures are the same ones each person '
    + 'sees in their own report, so the totals below always reconcile with the individual pages.',
  );

  if (partial) {
    rd.ensure(34);
    rd.doc.roundedRect(M, rd.y, CONTENT_W, 26, 6).fill(hexWithAlpha(C.partial, 0.13));
    rd.doc.font(F.bold).fontSize(8.5).fillColor('#92400E');
    rd.doc.text(
      'Interim report — this month is not over. Days that have not happened yet are excluded from every figure.',
      M + 12, rd.y + 9, { width: CONTENT_W - 24, lineBreak: false },
    );
    rd.y += 36;
  }

  rd.tiles([
    { label: 'Team size', value: members.length, hint: 'Monitored staff', color: C.brand },
    { label: 'Average attendance', value: `${avgRate.toFixed(1)}%`, hint: `${sum((x) => x.attendance.absentDays)} absence(s)`, color: avgRate >= 90 ? C.present : C.partial },
    { label: 'Average score', value: avgScore.toFixed(0), hint: gradeFor(Math.round(avgScore)).label, color: C.brand },
    { label: 'Activities uploaded', value: sum((x) => x.activities.uploaded), hint: `${sum((x) => x.activities.approved)} approved`, color: C.brand },
    { label: 'School visits', value: sum((x) => x.schoolVisits.completed), hint: `${sum((x) => x.visitReports.filed)} report(s) filed`, color: C.visit },
    { label: 'Days on leave', value: sum((x) => x.attendance.leaveDays), hint: `${sum((x) => x.attendance.substitutedDays)} covered by a substitute`, color: C.leave },
  ], { columns: 3 });

  const ranked = [...members].sort((a, b) => b.performance.score - a.performance.score);
  leaderboard(rd, ranked, {
    title: 'Ranked by overall score',
    sub: 'A condensed report for each member follows.',
  });

  const attention = ranked.filter((x) => x.performance.score < 60 || x.attendance.rate < 75);
  if (attention.length) {
    rd.section('Needs attention', 'Anyone below 60 overall or under 75% attendance this month.');
    rd.table({
      columns: [
        { label: 'Name', key: 'name', width: 0.3, bold: true },
        { label: 'Role', key: 'role', width: 0.22 },
        { label: 'Attendance', key: 'rate', width: 0.16, align: 'right' },
        { label: 'Absent', key: 'absent', width: 0.14, align: 'right' },
        { label: 'Score', key: 'score', width: 0.18, align: 'right', bold: true, color: (r) => r._color },
      ],
      rows: attention.map((x) => ({
        name: x.user.name,
        role: roleLabel(x.user.role),
        rate: `${x.attendance.rate.toFixed(0)}%`,
        absent: x.attendance.absentDays,
        score: x.performance.score,
        _color: x.performance.grade.color,
      })),
    });
  }

  ranked.forEach((member) => renderCompactPerson(rd, member));

  return rd.finish();
}

/**
 * The organisation-wide report for the Admin and CEO: totals, a full ranked
 * leaderboard, the attention list, then a condensed page per person grouped by
 * team so a head's people stay together.
 *
 * @returns {Promise<Buffer>}
 */
async function buildOrgPdf(all, { period }) {
  const label = periodLabel(period);
  const rd = new ReportDoc({
    title: `IECE Monthly Performance · ${label}`,
    subtitle: `Organisation-wide report — ${all.length} staff member(s)`,
    footerNote: FOOTER_NOTE,
  });

  rd.newPage('cover');

  rd.section(
    `Organisation overview — ${label}`,
    'Every IECE staff member whose performance is monitored. School logins are not measured, '
    + 'and the Admin and CEO receive this report rather than appearing in it.',
  );

  const n = all.length || 1;
  const sum = (fn) => all.reduce((s, x) => s + fn(x), 0);
  const avgRate = sum((x) => x.attendance.rate) / n;
  const avgScore = sum((x) => x.performance.score) / n;

  rd.tiles([
    { label: 'Staff reported', value: all.length, color: C.brand },
    { label: 'Average attendance', value: `${avgRate.toFixed(1)}%`, color: avgRate >= 90 ? C.present : C.partial },
    { label: 'Average score', value: avgScore.toFixed(0), color: C.brand },
    { label: 'Activities uploaded', value: sum((x) => x.activities.uploaded), hint: `${sum((x) => x.activities.approved)} approved`, color: C.brand },
    { label: 'School visits', value: sum((x) => x.schoolVisits.completed), hint: `${sum((x) => x.visitReports.filed)} report(s) filed`, color: C.visit },
    { label: 'Total absences', value: sum((x) => x.attendance.absentDays), hint: `${sum((x) => x.attendance.leaveDays)} day(s) on leave`, color: C.absent },
  ], { columns: 3 });

  const ranked = [...all].sort((a, b) => b.performance.score - a.performance.score);

  rd.newPage();
  leaderboard(rd, ranked, {
    title: 'Full leaderboard',
    sub: 'Every monitored staff member, ranked by overall score.',
    showTeam: true,
  });

  const attention = ranked.filter((x) => x.performance.score < 60 || x.attendance.rate < 75);
  rd.newPage();
  rd.section('Needs attention', 'Anyone scoring below 60 overall or under 75% attendance this month.');
  rd.table({
    columns: [
      { label: 'Name', key: 'name', width: 0.22, bold: true },
      { label: 'Role', key: 'role', width: 0.17 },
      { label: 'Team', key: 'team', width: 0.15 },
      { label: 'Attendance', key: 'rate', width: 0.12, align: 'right' },
      { label: 'Absent', key: 'absent', width: 0.1, align: 'right' },
      { label: 'Activities', key: 'acts', width: 0.12, align: 'right' },
      { label: 'Score', key: 'score', width: 0.12, align: 'right', bold: true, color: (r) => r._color },
    ],
    rows: attention.map((x) => ({
      name: x.user.name,
      role: roleLabel(x.user.role),
      team: x.user.teamName || '—',
      rate: `${x.attendance.rate.toFixed(0)}%`,
      absent: x.attendance.absentDays,
      acts: x.activities.uploaded,
      score: x.performance.score,
      _color: x.performance.grade.color,
    })),
    emptyText: 'Nobody fell below the attention thresholds this month.',
  });

  // Group the detail pages by team so a head's people read as a block.
  const groups = new Map();
  all.forEach((m) => {
    const key = m.user.teamName || (m.user.teamNames.length ? m.user.teamNames.join(', ') : 'No team assigned');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  });

  [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([teamName, members]) => {
      rd.newPage();
      rd.section(teamName, `${members.length} person(s). A condensed report for each follows.`);
      const sorted = [...members].sort((a, b) => b.performance.score - a.performance.score);
      rd.table({
        columns: [
          { label: 'Name', key: 'name', width: 0.28, bold: true },
          { label: 'Role', key: 'role', width: 0.22 },
          { label: 'Present', key: 'present', width: 0.14, align: 'right' },
          { label: 'Att %', key: 'rate', width: 0.12, align: 'right' },
          { label: 'Activities', key: 'acts', width: 0.12, align: 'right' },
          { label: 'Score', key: 'score', width: 0.12, align: 'right', bold: true, color: (r) => r._color },
        ],
        rows: sorted.map((x) => ({
          name: x.user.name,
          role: roleLabel(x.user.role),
          present: `${x.attendance.presentDays}/${x.attendance.workingDays}`,
          rate: `${x.attendance.rate.toFixed(0)}%`,
          acts: x.activities.uploaded,
          score: x.performance.score,
          _color: x.performance.grade.color,
        })),
      });
      sorted.forEach((member) => renderCompactPerson(rd, member));
    });

  return rd.finish();
}

module.exports = { buildIndividualPdf, buildTeamPdf, buildOrgPdf, ReportDoc, roleLabel };
