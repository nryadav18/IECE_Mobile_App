/**
 * Generates the three blank Excel templates that get sent out to the field staff.
 *
 *   node onboarding/generate_templates.js
 *
 * Output: backend/onboarding/templates/
 *   1_Schools_And_Chairmen.xlsx
 *   2_Team_Leaders.xlsx
 *   3_Trainers.xlsx
 */

const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const TEMPLATE_DIR = path.join(__dirname, 'templates');

const NAVY = 'FF1F4E79';
const RED = 'FFC00000';
const AMBER = 'FFFFF2CC';
const GREY = 'FFF2F2F2';

const buildSheet = (workbook, config) => {
  const sheet = workbook.addWorksheet(config.sheetName, {
    views: [{ state: 'frozen', ySplit: 3 }]
  });

  const lastCol = config.columns.length;
  const lastLetter = sheet.getColumn(lastCol).letter;

  // Row 1 — title banner.
  sheet.mergeCells(`A1:${lastLetter}1`);
  const title = sheet.getCell('A1');
  title.value = config.title;
  title.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  title.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 26;

  // Row 2 — instructions.
  sheet.mergeCells(`A2:${lastLetter}2`);
  const note = sheet.getCell('A2');
  note.value = config.instructions;
  note.font = { size: 10, color: { argb: RED }, bold: true };
  note.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER } };
  note.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  sheet.getRow(2).height = config.instructionsHeight || 42;

  // Row 3 — headings, each carrying its own example in brackets.
  const headerRow = sheet.getRow(3);
  config.columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = `${col.header}\n(${col.example})`;
    cell.font = { bold: true, size: 11, color: { argb: col.critical ? RED : 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: col.critical ? 'FFFFD966' : NAVY }
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin' }, left: { style: 'thin' },
      bottom: { style: 'thin' }, right: { style: 'thin' }
    };
    if (col.note) {
      cell.note = { texts: [{ text: col.note }] };
    }
    sheet.getColumn(i + 1).width = col.width || 26;
  });
  headerRow.height = 46;

  // Empty, bordered rows so it is obvious where to type.
  for (let r = 4; r <= 103; r++) {
    const row = sheet.getRow(r);
    config.columns.forEach((col, i) => {
      const cell = row.getCell(i + 1);
      cell.border = {
        top: { style: 'hair', color: { argb: 'FFBFBFBF' } },
        left: { style: 'hair', color: { argb: 'FFBFBFBF' } },
        bottom: { style: 'hair', color: { argb: 'FFBFBFBF' } },
        right: { style: 'hair', color: { argb: 'FFBFBFBF' } }
      };
      if (col.autoFilled) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } };
      }
      if (col.format) cell.numFmt = col.format;
    });
  }

  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: lastCol } };
  return sheet;
};

const SCHOOLS = {
  file: '1_Schools_And_Chairmen.xlsx',
  sheetName: 'Schools & Chairmen',
  title: 'IECE — SCHOOL & CHAIRMAN ONBOARDING SHEET',
  instructions:
    'HOW TO FILL: Type one school per row starting from row 4. Do NOT change, delete or reorder the heading row. ' +
    'Leave the Password column blank — every chairman is created with the default password School@2026 and can change it after first login. ' +
    'The School Name you type here becomes the master name — the Team Leader and Trainer sheets must use exactly the same spelling.',
  columns: [
    { header: 'Chairman Name', example: 'e.g. Rajesh Kumar', width: 26 },
    { header: 'Chairman / School Email', example: 'e.g. rajesh.kumar@stxaviers.edu.in', width: 34,
      note: 'This is the login ID. It must be unique — no two users can share an email.' },
    { header: 'Password', example: 'leave blank — auto: School@2026', width: 26, autoFilled: true,
      note: 'Leave blank. The system sets School@2026 by default.' },
    { header: 'School Name', example: "e.g. St. Xavier's High School", width: 34, critical: true,
      note: 'Write the full official school name. This exact spelling must be reused in the Team Leader and Trainer sheets.' },
    { header: 'State', example: 'e.g. Tamil Nadu', width: 20 },
    { header: 'Association Start Date', example: 'DD-MM-YYYY — e.g. 15-06-2024', width: 24, format: 'dd-mm-yyyy',
      note: 'The date IECE started working with this school. Use DD-MM-YYYY.' },
    { header: 'Class Coverage', example: 'e.g. 8th to 10th', width: 22 },
    { header: 'Total Strength', example: 'optional — e.g. 450', width: 18 }
  ]
};

const TEAM_LEADERS = {
  file: '2_Team_Leaders.xlsx',
  sheetName: 'Team Leaders',
  title: 'IECE — TEAM LEADER ONBOARDING SHEET',
  instructions:
    'HOW TO FILL: One team leader per row starting from row 4. Leave the Password column blank — the default is TeamLeader@2026. ' +
    'IMPORTANT: The School Name must be typed EXACTLY as it appears in the Schools & Chairmen sheet (same spelling, same spacing, same punctuation). ' +
    'The school is matched by this name — if it does not match an existing school, that row will be rejected.',
  columns: [
    { header: 'Team Leader Name', example: 'e.g. Anitha Menon', width: 28 },
    { header: 'Official Working Email', example: 'e.g. anitha.menon@iece.org.in', width: 34,
      note: 'This is the login ID. Must be unique.' },
    { header: 'Password', example: 'leave blank — auto: TeamLeader@2026', width: 28, autoFilled: true,
      note: 'Leave blank. The system sets TeamLeader@2026 by default.' },
    { header: 'School Name (MUST MATCH EXISTING)', example: "e.g. St. Xavier's High School", width: 38, critical: true,
      note: 'Copy-paste this from the Schools & Chairmen sheet. An unmatched name will fail the row.' }
  ]
};

const TRAINERS = {
  file: '3_Trainers.xlsx',
  sheetName: 'Trainers',
  title: 'IECE — TRAINER ONBOARDING SHEET',
  instructions:
    'HOW TO FILL: One trainer per row starting from row 4. Leave the Password column blank — the default is Trainer@2026. ' +
    'IMPORTANT: School Name must match an existing school EXACTLY, and Team Leader Email must match an already-created team leader EXACTLY. ' +
    'Both are used to link the trainer — a mismatch will reject that row.',
  instructionsHeight: 50,
  columns: [
    { header: 'Trainer Name', example: 'e.g. Suresh Babu', width: 26 },
    { header: 'Official Working Email', example: 'e.g. suresh.babu@iece.org.in', width: 32,
      note: 'This is the login ID. Must be unique.' },
    { header: 'Password', example: 'leave blank — auto: Trainer@2026', width: 26, autoFilled: true,
      note: 'Leave blank. The system sets Trainer@2026 by default.' },
    { header: 'School Name (MUST MATCH EXISTING)', example: "e.g. St. Xavier's High School", width: 36, critical: true,
      note: 'Copy-paste from the Schools & Chairmen sheet.' },
    { header: 'Team Leader Email (MUST MATCH EXISTING)', example: 'e.g. anitha.menon@iece.org.in', width: 36, critical: true,
      note: 'Copy-paste from the Team Leaders sheet. Email is used because two leaders may share a name.' }
  ]
};

const run = async () => {
  if (!fs.existsSync(TEMPLATE_DIR)) fs.mkdirSync(TEMPLATE_DIR, { recursive: true });

  for (const config of [SCHOOLS, TEAM_LEADERS, TRAINERS]) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'IECE App';
    buildSheet(workbook, config);
    const outPath = path.join(TEMPLATE_DIR, config.file);
    await workbook.xlsx.writeFile(outPath);
    console.log(`Created: ${outPath}`);
  }

  console.log('\nSend these three files to the field staff. When they come back filled, save them into');
  console.log(`  ${path.join(__dirname, 'data')}`);
  console.log('and run the create_* scripts in order (schools -> team leaders -> trainers).');
};

run().catch(err => {
  console.error(err);
  process.exit(1);
});
