const path = require('path');
const fs = require('fs');
const dns = require('dns');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const ExcelJS = require('exceljs');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
if (process.env.NODE_ENV !== 'production') {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is missing. Add it to backend/.env before running this script.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log('MongoDB connected.\n');
};

// Normalises a value for tolerant comparison: trims, collapses inner spaces, lowercases.
const norm = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase();

const clean = (value) => {
  if (value == null) return '';
  // ExcelJS returns objects for hyperlinks and rich text cells.
  if (typeof value === 'object') {
    if (value.text) return String(value.text).trim();
    if (value.richText) return value.richText.map(r => r.text).join('').trim();
    if (value.result != null) return String(value.result).trim();
    if (value instanceof Date) return value;
  }
  return String(value).replace(/\s+/g, ' ').trim();
};

const ordinal = (n) => {
  const suffix = (n % 100 >= 11 && n % 100 <= 13) ? 'th'
    : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  return `${n}${suffix}`;
};

// Accepts a real Excel date cell, or text as DD-MM-YYYY / DD/MM/YYYY / YYYY-MM-DD.
const parseDate = (value) => {
  if (value instanceof Date && !isNaN(value)) return value;
  const text = String(value || '').trim();
  if (!text) return null;

  let m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));

  m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  const fallback = new Date(text);
  return isNaN(fallback) ? null : fallback;
};

// "15-06-2024" started 2 full years ago -> "3rd-year" of association.
const associationYearFrom = (startDate) => {
  const now = new Date();
  let years = now.getFullYear() - startDate.getFullYear();
  const beforeAnniversary =
    now.getMonth() < startDate.getMonth() ||
    (now.getMonth() === startDate.getMonth() && now.getDate() < startDate.getDate());
  if (beforeAnniversary) years -= 1;
  return `${ordinal(Math.max(0, years) + 1)}-year`;
};

/**
 * Reads a filled template. Finds the header row by looking for the anchor keyword
 * (so an extra instructions/banner row above the headers is fine), then maps each
 * requested field onto a column by keyword match.
 *
 * fields: { key: [regex, ...] } — first matching, not-yet-claimed column wins.
 */
const loadRows = async (filePath, anchor, fields) => {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    console.error('Fill the generated template and save it there, or pass a path: node <script>.js "C:\\path\\to\\sheet.xlsx"');
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  if (filePath.toLowerCase().endsWith('.csv')) {
    await workbook.csv.readFile(filePath);
  } else {
    await workbook.xlsx.readFile(filePath);
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    console.error('The workbook has no sheets.');
    process.exit(1);
  }

  let headerRowNumber = null;
  for (let r = 1; r <= Math.min(15, sheet.rowCount); r++) {
    const cells = sheet.getRow(r).values || [];
    if (cells.some(c => anchor.test(String(clean(c))))) {
      headerRowNumber = r;
      break;
    }
  }
  if (!headerRowNumber) {
    console.error(`Could not find the header row (no column matching ${anchor}).`);
    console.error('Do not delete or rename the heading row of the template.');
    process.exit(1);
  }

  const headerRow = sheet.getRow(headerRowNumber);
  const columns = {};
  const claimed = new Set();
  for (const [key, patterns] of Object.entries(fields)) {
    for (const pattern of patterns) {
      let found = null;
      headerRow.eachCell((cell, colNumber) => {
        if (found || claimed.has(colNumber)) return;
        if (pattern.test(String(clean(cell.value)))) found = colNumber;
      });
      if (found) {
        columns[key] = found;
        claimed.add(found);
        break;
      }
    }
  }

  const rows = [];
  for (let r = headerRowNumber + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const record = { _rowNumber: r };
    let hasData = false;
    for (const [key, colNumber] of Object.entries(columns)) {
      const value = clean(row.getCell(colNumber).value);
      record[key] = value;
      if (value !== '') hasData = true;
    }
    if (hasData) rows.push(record);
  }

  console.log(`Read ${rows.length} data row(s) from ${path.basename(filePath)}\n`);
  return { rows, columns };
};

const isValidEmail = (email) => /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,})+$/.test(email);

/**
 * Prints the created accounts as a copy-pasteable block and saves them to
 * onboarding/output/ as an .xlsx handout.
 */
const reportCredentials = async (title, created, skipped, failed, outputName) => {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${title.toUpperCase()} — SUMMARY`);
  console.log('='.repeat(70));
  console.log(`  Created: ${created.length}   Skipped (already exist): ${skipped.length}   Failed: ${failed.length}`);

  if (created.length) {
    console.log('\n--- LOGIN CREDENTIALS (copy & share with each user) ---\n');
    created.forEach((c, i) => {
      console.log(`${i + 1}. ${c.name}`);
      Object.entries(c.extra || {}).forEach(([k, v]) => console.log(`   ${k}: ${v}`));
      console.log(`   Email    : ${c.email}`);
      console.log(`   Password : ${c.password}`);
      console.log('');
    });
  }

  if (skipped.length) {
    console.log('--- SKIPPED (email already registered) ---');
    skipped.forEach(s => console.log(`   Row ${s.row}: ${s.email} — ${s.reason}`));
    console.log('');
  }

  if (failed.length) {
    console.log('--- FAILED (fix the sheet and re-run; created rows are skipped automatically) ---');
    failed.forEach(f => console.log(`   Row ${f.row}: ${f.reason}`));
    console.log('');
  }

  if (created.length) {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Credentials');
    const extraKeys = Object.keys(created[0].extra || {});
    sheet.columns = [
      { header: 'Name', key: 'name', width: 30 },
      ...extraKeys.map(k => ({ header: k, key: k, width: 32 })),
      { header: 'Email', key: 'email', width: 34 },
      { header: 'Password', key: 'password', width: 20 }
    ];
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    created.forEach(c => sheet.addRow({ name: c.name, email: c.email, password: c.password, ...(c.extra || {}) }));

    const stamp = new Date().toISOString().slice(0, 10);
    const outPath = path.join(OUTPUT_DIR, `${outputName}_${stamp}.xlsx`);
    await workbook.xlsx.writeFile(outPath);
    console.log(`Credentials sheet saved to: ${outPath}`);
  }

  console.log('='.repeat(70) + '\n');
};

const finish = async (code = 0) => {
  await mongoose.connection.close();
  process.exit(code);
};

module.exports = {
  ExcelJS, DATA_DIR, OUTPUT_DIR,
  connectDB, finish,
  norm, clean, ordinal, parseDate, associationYearFrom,
  loadRows, isValidEmail, reportCredentials
};
