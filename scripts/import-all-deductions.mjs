/**
 * Bulk import all deduction notes xlsx files into ft_billing_deductions.
 * Walks /tmp/ft-invoicing/fibertime Weekly Invoicing/ chronologically,
 * finds all *notes.xlsx files, parses them, and links to existing ft_weekly_billing rows.
 *
 * Usage: node /tmp/import-all-deductions.mjs
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import pg from 'pg';
import XLSX from 'xlsx';

const DATABASE_URL = 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';
const BASE_DIR = '/tmp/ft-invoicing/fibertime Weekly Invoicing';

// ─── Patterns ────────────────────────────────────────────────────────────────

const DR_PATTERN = /^DR\d+/i;
const SERIAL_PATTERN = /^(ALCLB|ALHN|ALCL|GU18W)/i;
const TEAM_PATTERN = /^(law|moh|mam|moa|vel|mid|sow|bel|kwa|dev|lan)\d+$/i;
const NOTE_MARKER = /^Note\s*(\d)\s*:?\s*$/i;
const NOTE_MARKER_INLINE = /^Note\s*(\d)\s*:/i;

// ─── Parse notes xlsx ────────────────────────────────────────────────────────

function parseNotesXlsx(buffer, project) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames.find(s => /note/i.test(s)) || wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const deductions = [];
  let currentNote = null;
  let headerRowSeen = false;

  for (const row of rows) {
    const cells = row.map(c => String(c ?? '').trim());
    const joined = cells.join(' ').trim();

    // Check for note section markers
    for (const cell of cells) {
      const m = NOTE_MARKER.exec(cell) || NOTE_MARKER_INLINE.exec(cell);
      if (m) {
        const n = parseInt(m[1]);
        if (n >= 1 && n <= 5) {
          currentNote = `note${n}`;
          headerRowSeen = false;
          break;
        }
      }
    }

    if (!currentNote) continue;

    // Skip header rows (Zone, Drop, Serial Number, Team, etc.)
    const lower = joined.toLowerCase();
    if (/\bzone\b.*\bdrop\b/.test(lower) || /\bserial\s*number\b/.test(lower)) {
      headerRowSeen = true;
      continue;
    }
    // Skip the repeated note marker row like "Note 4:  Note 4"
    if (NOTE_MARKER_INLINE.test(joined) && cells.filter(c => c).length <= 3) continue;

    // Look for DR number
    let drNumber = '';
    let serialNumber = null;
    let team = null;

    for (const cell of cells) {
      const s = String(cell).trim();
      if (!s) continue;
      if (!drNumber && DR_PATTERN.test(s)) { drNumber = s.toUpperCase(); continue; }
      if (!serialNumber && SERIAL_PATTERN.test(s)) { serialNumber = s.toUpperCase(); continue; }
      if (!team && TEAM_PATTERN.test(s)) { team = s.toLowerCase(); continue; }
    }

    if (!drNumber) continue;

    deductions.push({ drNumber, note: currentNote, serialNumber, team, project });
  }

  return deductions;
}

// ─── Map week folder name to date ────────────────────────────────────────────

function weekFolderToDate(folderName) {
  // WE250727 → 2025-07-27
  const m = folderName.match(/WE(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  return `20${m[1]}-${m[2]}-${m[3]}`;
}

// ─── Extract project from filename ───────────────────────────────────────────

function extractProject(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes('lawley') || lower.startsWith('law')) return 'Lawley';
  if (lower.includes('mohadin') || lower.startsWith('moh')) return 'Mohadin';
  if (lower.includes('mamelodi') || lower.startsWith('mam')) return 'Mamelodi';
  return null;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

  try {
    // Get all week folders sorted chronologically
    const weekFolders = readdirSync(BASE_DIR)
      .filter(d => d.startsWith('WE') && statSync(join(BASE_DIR, d)).isDirectory())
      .sort();

    console.log(`Found ${weekFolders.length} week folders\n`);

    let totalFiles = 0;
    let totalDeductions = 0;
    let totalSkipped = 0;
    const results = [];

    for (const folder of weekFolders) {
      const weekDate = weekFolderToDate(folder);
      if (!weekDate) { console.log(`  Skip ${folder}: can't parse date`); continue; }

      const folderPath = join(BASE_DIR, folder);

      // Find all notes xlsx files (skip subdirectory duplicates)
      const files = readdirSync(folderPath)
        .filter(f => f.endsWith('.xlsx') && /notes/i.test(f) && !f.startsWith('~'));

      if (files.length === 0) continue;

      for (const file of files) {
        const project = extractProject(file);
        if (!project) { console.log(`  Skip ${file}: can't determine project`); continue; }

        // Find matching ft_weekly_billing row
        const billingResult = await pool.query(
          'SELECT id FROM ft_weekly_billing WHERE week_ending = $1 AND project = $2',
          [weekDate, project]
        );

        if (billingResult.rows.length === 0) {
          console.log(`  Skip ${folder}/${file}: no billing row for ${project} ${weekDate}`);
          totalSkipped++;
          continue;
        }

        const billingWeekId = billingResult.rows[0].id;

        // Parse the xlsx
        const buffer = readFileSync(join(folderPath, file));
        let deductions;
        try {
          deductions = parseNotesXlsx(buffer, project);
        } catch (err) {
          console.log(`  ERROR parsing ${folder}/${file}: ${err.message}`);
          continue;
        }

        if (deductions.length === 0) {
          console.log(`  ${folder}/${file}: 0 deductions parsed`);
          continue;
        }

        // Delete existing deductions for this billing week + re-insert
        await pool.query('DELETE FROM ft_billing_deductions WHERE billing_week_id = $1', [billingWeekId]);

        // Bulk insert
        const drNumbers = deductions.map(d => d.drNumber);
        const notes = deductions.map(d => d.note);
        const serials = deductions.map(d => d.serialNumber);
        const teams = deductions.map(d => d.team);
        const weekDates = deductions.map(() => weekDate);
        const projects = deductions.map(() => project);
        const weekIds = deductions.map(() => billingWeekId);

        await pool.query(
          `INSERT INTO ft_billing_deductions
             (billing_week_id, week_ending, project, dr_number, deduction_note, serial_number, team)
           SELECT
             UNNEST($1::uuid[]),
             UNNEST($2::date[]),
             UNNEST($3::varchar[]),
             UNNEST($4::varchar[]),
             UNNEST($5::varchar[]),
             UNNEST($6::varchar[]),
             UNNEST($7::varchar[])
           ON CONFLICT (billing_week_id, dr_number, deduction_note) DO UPDATE SET
             serial_number = EXCLUDED.serial_number,
             team = EXCLUDED.team`,
          [weekIds, weekDates, projects, drNumbers, notes, serials, teams]
        );

        // Count by note type
        const noteCounts = {};
        for (const d of deductions) {
          noteCounts[d.note] = (noteCounts[d.note] || 0) + 1;
        }

        const summary = Object.entries(noteCounts)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}:${v}`)
          .join(' ');

        console.log(`  ${folder}/${file} → ${deductions.length} deductions (${summary})`);
        totalFiles++;
        totalDeductions += deductions.length;

        results.push({
          week: weekDate,
          project,
          file,
          deductions: deductions.length,
          noteCounts,
        });
      }
    }

    console.log(`\n=== SUMMARY ===`);
    console.log(`Files processed: ${totalFiles}`);
    console.log(`Total deductions imported: ${totalDeductions}`);
    console.log(`Skipped (no billing row): ${totalSkipped}`);

    // Verify
    const verifyResult = await pool.query(`
      SELECT project, COUNT(DISTINCT billing_week_id) as weeks, COUNT(*) as total_deductions,
        COUNT(DISTINCT dr_number) as unique_drs
      FROM ft_billing_deductions
      GROUP BY project
      ORDER BY project
    `);
    console.log('\nPer-project deduction summary:');
    for (const row of verifyResult.rows) {
      console.log(`  ${row.project}: ${row.weeks} weeks, ${row.total_deductions} deductions, ${row.unique_drs} unique DRs`);
    }

    // Show latest week deduction counts (current state)
    const latestResult = await pool.query(`
      SELECT b.project, b.week_ending, COUNT(DISTINCT d.dr_number) as excluded_drs
      FROM ft_weekly_billing b
      JOIN ft_billing_deductions d ON d.billing_week_id = b.id
      WHERE b.week_ending = (SELECT MAX(week_ending) FROM ft_weekly_billing WHERE project = b.project)
      GROUP BY b.project, b.week_ending
      ORDER BY b.project
    `);
    console.log('\nCurrently excluded (latest week per project):');
    for (const row of latestResult.rows) {
      console.log(`  ${row.project} (${row.week_ending}): ${row.excluded_drs} DRs excluded = R${row.excluded_drs * 2700} at risk`);
    }

  } catch (error) {
    console.error('Import failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
