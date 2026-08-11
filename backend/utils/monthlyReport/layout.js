const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// A tiny layout toolkit over PDFKit.
//
// PDFKit draws text and shapes; it has no concept of a header, a table, a card
// or a page break. Everything in this file exists so pdf.js can describe the
// report in terms of those things instead of juggling cursor arithmetic, and so
// that every page of every report is spaced, coloured and aligned identically.
//
// The one rule that makes it all work: helpers that draw a block return the Y
// coordinate immediately below what they drew. Callers thread that through
// rather than tracking `doc.y` by hand, because PDFKit's implicit cursor moves
// in surprising ways once you mix text, shapes and columns.
// ---------------------------------------------------------------------------

const PAGE = { w: 595.28, h: 841.89 };
const M = 44;                       // page margin
const CONTENT_W = PAGE.w - M * 2;
const HEADER_H = 58;
const FOOTER_H = 42;
const BODY_TOP = HEADER_H + 26;
const BODY_BOTTOM = PAGE.h - FOOTER_H - 10;

const C = {
  brand: '#0D9488',
  brandDark: '#0F766E',
  brandSoft: '#E6F4F2',
  ink: '#111827',
  body: '#374151',
  muted: '#6B7280',
  faint: '#9CA3AF',
  line: '#E5E7EB',
  soft: '#F9FAFB',
  white: '#FFFFFF',
  // Day states — deliberately the same colour language the app's own calendars
  // use, so a person reading the PDF recognises it instantly.
  present: '#16A34A',
  partial: '#F59E0B',
  absent: '#DC2626',
  leave: '#7C3AED',
  substituted: '#2563EB',
  visit: '#0D9488',
  holiday: '#1D4ED8',
  sunday: '#CBD5E1',
};

const STATE_STYLE = {
  present: { color: C.present, label: 'Present' },
  partial: { color: C.partial, label: 'Half day' },
  absent: { color: C.absent, label: 'Absent' },
  leave: { color: C.leave, label: 'Leave' },
  substituted: { color: C.substituted, label: 'Substituted' },
  visit: { color: C.visit, label: 'School visit' },
  holiday: { color: C.holiday, label: 'School holiday' },
  sunday: { color: C.sunday, label: 'Sunday' },
  // Only ever seen on a report generated mid-month; the monthly cron always
  // reports a month that has already ended.
  upcoming: { color: C.sunday, label: 'Not yet occurred' },
};

const F = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  oblique: 'Helvetica-Oblique',
};

const LOGO_PATH = path.join(__dirname, '..', '..', 'assets', 'iece-logo.png');

/**
 * The logo, read once per process. Returned as a raw Buffer; pdf.js turns it
 * into a PDFKit image object once per document so a 40-page report embeds the
 * bytes a single time rather than forty.
 */
let logoBuffer;
let logoTried = false;
function getLogoBuffer() {
  if (logoTried) return logoBuffer;
  logoTried = true;
  try {
    logoBuffer = fs.readFileSync(LOGO_PATH);
  } catch {
    // No asset shipped — drawBrandMark falls back to a vector wordmark, so the
    // report still looks deliberate rather than broken.
    logoBuffer = null;
  }
  return logoBuffer;
}

/** A compact vector "IECE" mark. Used in running headers and as logo fallback. */
function drawBrandMark(doc, x, y, size = 22) {
  doc.save();
  doc.roundedRect(x, y, size, size, size * 0.26).fill(C.white);
  doc.font(F.bold).fontSize(size * 0.4).fillColor(C.brand);
  doc.text('IECE', x, y + size * 0.31, { width: size, align: 'center', lineBreak: false });
  doc.restore();
}

/** Truncate to fit a width, adding an ellipsis. PDFKit will otherwise wrap. */
function ellipsize(doc, text, width, font = F.regular, size = 9) {
  const str = String(text === null || text === undefined ? '' : text);
  doc.font(font).fontSize(size);
  if (doc.widthOfString(str) <= width) return str;
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.widthOfString(`${str.slice(0, mid)}…`) <= width) lo = mid;
    else hi = mid - 1;
  }
  return `${str.slice(0, lo)}…`;
}

/**
 * Header band drawn on every page.
 *
 * `logo` is an image OPENED ONCE per document (PDFKit's doc.openImage), not a
 * raw buffer. Passing the buffer would embed the PNG bytes again on every
 * single page — on a forty-page organisation report that is forty copies of the
 * same file inside one attachment.
 */
function drawHeader(doc, { title, subtitle, logo, variant = 'page' }) {
  const size = variant === 'cover' ? 36 : 26;
  doc.save();
  doc.rect(0, 0, PAGE.w, HEADER_H).fill(C.brand);

  if (logo) {
    doc.image(logo, M, (HEADER_H - size) / 2, { height: size, width: size });
  } else {
    drawBrandMark(doc, M, (HEADER_H - size) / 2, size);
  }

  const textX = M + size + 12;
  doc.font(F.bold).fontSize(12).fillColor(C.white);
  doc.text(title, textX, 17, { width: CONTENT_W - 200, lineBreak: false });
  if (subtitle) {
    doc.font(F.regular).fontSize(8.5).fillColor('#B2DFD9');
    doc.text(subtitle, textX, 33, { width: CONTENT_W - 200, lineBreak: false });
  }

  doc.restore();
}

/** Footer with page number. Drawn in a second pass once the total is known. */
function drawFooter(doc, { pageNumber, pageCount, note }) {
  const y = PAGE.h - FOOTER_H;
  doc.save();
  doc.moveTo(M, y).lineTo(PAGE.w - M, y).lineWidth(0.5).stroke(C.line);
  doc.font(F.regular).fontSize(7.5).fillColor(C.faint);
  doc.text(note || '', M, y + 11, { width: CONTENT_W - 90, lineBreak: false });
  doc.text(`Page ${pageNumber} of ${pageCount}`, PAGE.w - M - 90, y + 11, {
    width: 90, align: 'right', lineBreak: false,
  });
  doc.restore();
}

/** A section heading with a short brand rule under it. Returns the next Y. */
function sectionTitle(doc, y, text, sub) {
  doc.font(F.bold).fontSize(12.5).fillColor(C.ink);
  doc.text(text, M, y, { width: CONTENT_W, lineBreak: false });
  let next = y + 17;
  if (sub) {
    doc.font(F.regular).fontSize(8.5).fillColor(C.muted);
    doc.text(sub, M, next, { width: CONTENT_W });
    next = doc.y + 2;
  }
  doc.rect(M, next, 26, 2.2).fill(C.brand);
  return next + 14;
}

/** Muted paragraph. Returns the next Y. */
function paragraph(doc, y, text, { size = 9, color = C.body, width = CONTENT_W, x = M } = {}) {
  doc.font(F.regular).fontSize(size).fillColor(color);
  doc.text(text, x, y, { width, lineGap: 2 });
  return doc.y + 6;
}

/**
 * A grid of stat cards. Each tile is { label, value, hint, color }.
 * Fixed columns so tiles line up across sections and across people.
 */
function statTiles(doc, y, tiles, { columns = 3, height = 56 } = {}) {
  const gap = 10;
  const w = (CONTENT_W - gap * (columns - 1)) / columns;
  let row = 0;
  tiles.forEach((t, i) => {
    const col = i % columns;
    row = Math.floor(i / columns);
    const x = M + col * (w + gap);
    const ty = y + row * (height + gap);

    doc.save();
    doc.roundedRect(x, ty, w, height, 7).fill(C.soft);
    doc.roundedRect(x, ty, w, height, 7).lineWidth(0.6).stroke(C.line);
    // Accent stripe so a tile can carry meaning at a glance.
    doc.roundedRect(x, ty, 3, height, 1.5).fill(t.color || C.brand);

    doc.font(F.regular).fontSize(7.5).fillColor(C.muted);
    doc.text(String(t.label).toUpperCase(), x + 12, ty + 9, { width: w - 20, lineBreak: false, characterSpacing: 0.4 });

    doc.font(F.bold).fontSize(16).fillColor(t.color || C.ink);
    doc.text(String(t.value), x + 12, ty + 21, { width: w - 20, lineBreak: false });

    if (t.hint) {
      doc.font(F.regular).fontSize(7.5).fillColor(C.faint);
      doc.text(ellipsize(doc, t.hint, w - 20, F.regular, 7.5), x + 12, ty + 41, { width: w - 20, lineBreak: false });
    }
    doc.restore();
  });
  return y + (row + 1) * (height + gap) + 2;
}

/** SVG arc path string — PDFKit understands SVG path syntax via doc.path(). */
function arcPath(cx, cy, r, startDeg, endDeg) {
  const rad = (d) => ((d - 90) * Math.PI) / 180;
  const sweep = Math.min(359.99, Math.max(0, endDeg - startDeg));
  const s = rad(startDeg);
  const e = rad(startDeg + sweep);
  const x1 = cx + r * Math.cos(s);
  const y1 = cy + r * Math.sin(s);
  const x2 = cx + r * Math.cos(e);
  const y2 = cy + r * Math.sin(e);
  const large = sweep > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

/** The score gauge: a thick ring filled proportionally, number in the middle. */
function scoreGauge(doc, cx, cy, radius, { score, grade }) {
  const thickness = 13;
  doc.save();
  doc.lineWidth(thickness).lineCap('round');
  doc.path(arcPath(cx, cy, radius, 0, 359.99)).stroke('#EDF1F3');
  if (score > 0) {
    doc.path(arcPath(cx, cy, radius, 0, (score / 100) * 359.99)).stroke(grade.color);
  }
  doc.font(F.bold).fontSize(28).fillColor(C.ink);
  doc.text(String(score), cx - radius, cy - 19, { width: radius * 2, align: 'center', lineBreak: false });
  doc.font(F.regular).fontSize(8).fillColor(C.faint);
  doc.text('out of 100', cx - radius, cy + 12, { width: radius * 2, align: 'center', lineBreak: false });
  doc.restore();
}

/** A labelled horizontal progress bar. Returns the next Y. */
function progressBar(doc, y, { label, value, max = 100, caption, color = C.brand, labelWidth = 150 }) {
  const barX = M + labelWidth + 8;
  const barW = CONTENT_W - labelWidth - 8 - 56;
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;

  doc.font(F.regular).fontSize(8.5).fillColor(C.body);
  doc.text(ellipsize(doc, label, labelWidth, F.regular, 8.5), M, y + 1, { width: labelWidth, lineBreak: false });

  doc.roundedRect(barX, y, barW, 9, 4.5).fill('#EDF1F3');
  if (ratio > 0) doc.roundedRect(barX, y, Math.max(4, barW * ratio), 9, 4.5).fill(color);

  doc.font(F.bold).fontSize(8.5).fillColor(C.ink);
  doc.text(`${Math.round(value)}`, barX + barW + 8, y + 1, { width: 48, align: 'right', lineBreak: false });

  let next = y + 13;
  if (caption) {
    doc.font(F.regular).fontSize(7.5).fillColor(C.faint);
    doc.text(caption, barX, next, { width: barW });
    next = doc.y + 2;
  }
  return next + 5;
}

/** A coloured pill — used for statuses and grades. Returns its width. */
function pill(doc, x, y, text, color, { size = 7.5, padX = 6 } = {}) {
  doc.font(F.bold).fontSize(size);
  const w = doc.widthOfString(text) + padX * 2;
  const h = size + 6;
  doc.save();
  doc.roundedRect(x, y, w, h, h / 2).fill(hexWithAlpha(color, 0.13));
  doc.fillColor(color).text(text, x + padX, y + 3.5, { width: w - padX * 2, lineBreak: false });
  doc.restore();
  return w;
}

/**
 * Flatten a colour against white at a given alpha.
 * PDFKit's fillOpacity leaks into everything drawn after it in the same save
 * block, so pre-mixing the colour is safer than switching global opacity.
 */
function hexWithAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = (c) => Math.round(c * alpha + 255 * (1 - alpha));
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

module.exports = {
  PAGE, M, CONTENT_W, HEADER_H, FOOTER_H, BODY_TOP, BODY_BOTTOM,
  C, F, STATE_STYLE,
  getLogoBuffer, drawBrandMark, drawHeader, drawFooter,
  sectionTitle, paragraph, statTiles, scoreGauge, progressBar,
  pill, ellipsize, hexWithAlpha, arcPath,
};
