#!/usr/bin/env tsx
// Imports Loeks Ellis field-captured Mohadin (PRJ-1761242661257) snapshots
// from ./data/pon-NN.md into the loeks_field_mappings staging table.
// Never writes to drops — apply via reconcile.sql after review.
//
//   tsx scripts/imports/mohadin-loeks/import.ts          # full run
//   tsx scripts/imports/mohadin-loeks/import.ts --dry    # parse + summary only
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const MOHADIN_PROJECT_ID = 'bf9a90db-e758-4c05-b999-694cd63c451f';

const SHEET_IDS: Record<number, string> = {
  17: '1BHb6UhAsfh-pNGhRVwjxQdxeU-Bhu-EGf_63rqOy6RU',
  18: '187TKBVw8m_dTgu1FSRN-oiyHwfRtmGtjyoDmsut-6WU',
  19: '1Hp92LlVM_7hICblEJbC-Pen71bTi9jsUZRowmgkGXpI',
  20: '1Wxy7XqYi5mjxWiillnVAMm_wj0XGKRtD8_r8hVaYnjg',
  21: '1ZHozAa48-gMJpCmYgoWwe5uTmK7H_ybP3zmiDbM1xQU',
  22: '18EGw8e5TTQvwDWhE0mPGxBO2DMfbShYYHEhHFra453Q',
  23: '1BULvnFjshVe2EXXdU1tQMZWtcMR1gXciVCAMkNJzGfY',
  24: '1Ls3wJ8U_fjxIBtgs-jOe1nPnyvHyXkP6Xf0pG1M_-Hs',
  25: '1SwCLBCu_0WJ0nM9WZLJs_87Niiz0TstnWSlUx3_FYRk',
  26: '1l8CFRY_dPUZmTvsJDUR3RpErsnEapUffnEo1KDykwxU',
  27: '1lzuF7Cbnno77FO68esn3IvBvwToNKgaXKb5scGSXOIA',
  28: '1AIz3TL6laTYnmcxvEHC9p5fYBkJ1X5IECUnazmu_O-0',
  29: '1DGfGs8FcKUdlJGFQNeyF9_9b8SCx7ZHJMT2CBtuNwfU',
  30: '1WWyVbsHhPl3J51cTGgyKupdjze_ZpDN4qb3Nh1BUtQE',
  31: '1YyOKwBIlACVgOou6-uHA82V9it9NtQwH-9J2SRcCOrg',
  32: '1mslr1Avtb6atigW-5XcVbxUuCZr8FtwYzd9a6wS8VTs',
};

interface Row {
  pon_no: number;
  source_sheet_id: string;
  source_row_index: number;
  property_number: string | null;
  dr_number: string | null;
  ont_serial: string | null;
  gizzu_serial: string | null;
  dwelling_label: string | null;
  notes_raw: string | null;
  pre_provision: boolean;
  needs_dr: boolean;
  cross_pon_hint: string | null;
}

const NEED_DR_RE = /(DR\s*NEEDED|NEEDS\s*DR|ACTIVATION\s*NEEDED)/i;
const TO_BE_ACTIVATED_RE = /TO\s*BE\s*ACTIVATED/i;

function clean(v: string | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function detectDwelling(notes: string | null): string | null {
  if (!notes) return null;
  const up = notes.toUpperCase();
  // Tolerate observed typos: 'MAINJ HOUSE', 'BACKM ROOM'
  if (/MAIN\s*J?\s*HOUSE/.test(up)) return 'MAIN HOUSE';
  if (/BACK\s*M?\s*ROOM/.test(up)) return 'BACK ROOM';
  return null;
}

function detectCrossPon(notes: string | null): string | null {
  if (!notes) return null;
  const m = notes.match(/PON\s*(\d{1,3})/i);
  return m ? `PON ${m[1]}` : null;
}

function parsePonFile(pon: number, contents: string): Row[] {
  const rows: Row[] = [];
  let currentProperty: string | null = null;
  let bodyStarted = false;
  let rowIdx = 0;

  for (const raw of contents.split('\n')) {
    if (!raw.startsWith('|')) continue;
    if (raw.includes('PROPERTY NUMBER')) {
      bodyStarted = true;
      continue;
    }
    if (raw.includes(':-:')) continue;
    if (!bodyStarted) continue;

    const cells = raw.split('|').slice(1, -1).map((s) => s.trim());
    if (cells.length < 5) continue;
    const [propRaw, drRaw, ontRaw, gizzuRaw, notesRaw] = cells;
    const prop = clean(propRaw);
    const dr = clean(drRaw);
    const ont = clean(ontRaw);
    const gizzu = clean(gizzuRaw);
    const notes = clean(notesRaw);

    if (prop) currentProperty = prop;

    if (!prop && !dr && !ont && !gizzu && !notes) {
      rowIdx++;
      continue;
    }

    const dwelling = detectDwelling(notes);
    const preProv = !!ont && !dr && !!notes && TO_BE_ACTIVATED_RE.test(notes);
    const needsDr =
      (dr != null && NEED_DR_RE.test(dr)) ||
      (notes != null && NEED_DR_RE.test(notes));

    rows.push({
      pon_no: pon,
      source_sheet_id: SHEET_IDS[pon],
      source_row_index: rowIdx++,
      property_number: currentProperty,
      dr_number: dr,
      ont_serial: ont,
      gizzu_serial: gizzu,
      dwelling_label: dwelling,
      notes_raw: notes,
      pre_provision: preProv,
      needs_dr: needsDr,
      cross_pon_hint: detectCrossPon(notes),
    });
  }

  return rows;
}

function loadAll(): Row[] {
  const all: Row[] = [];
  for (const file of readdirSync(DATA_DIR).sort()) {
    const m = file.match(/^pon-(\d{2})\.md$/);
    if (!m) continue;
    const pon = parseInt(m[1], 10);
    if (!SHEET_IDS[pon]) {
      throw new Error(`No sheet ID mapped for ${file}`);
    }
    const contents = readFileSync(join(DATA_DIR, file), 'utf-8');
    all.push(...parsePonFile(pon, contents));
  }
  return all;
}

async function stage(pool: Pool, rows: Row[]): Promise<void> {
  await pool.query('BEGIN');
  try {
    await pool.query('TRUNCATE loeks_field_mappings RESTART IDENTITY');
    for (const r of rows) {
      await pool.query(
        `INSERT INTO loeks_field_mappings
         (pon_no, source_sheet_id, source_row_index, property_number, dr_number,
          ont_serial, gizzu_serial, dwelling_label, notes_raw, pre_provision,
          needs_dr, cross_pon_hint)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          r.pon_no, r.source_sheet_id, r.source_row_index, r.property_number,
          r.dr_number, r.ont_serial, r.gizzu_serial, r.dwelling_label,
          r.notes_raw, r.pre_provision, r.needs_dr, r.cross_pon_hint,
        ],
      );
    }
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

// Order matters. pre_provision MUST precede needs_dr — a "TO BE ACTIVATED"
// row has pre_provision=true and dr_number=NULL; the needs_dr predicate
// would otherwise swallow it. invalid_dr is the catch-all for malformed
// DR strings (e.g. 'CURRENT: DR…', duplicates, 'DAR…') that needs_dr
// didn't claim. Anything still NULL after this list surfaces as a warning.
const CLASSIFIERS: ReadonlyArray<{ sql: string; params?: unknown[] }> = [
  { sql: `UPDATE loeks_field_mappings SET match_status='no_dr_no_serial' WHERE dr_number IS NULL AND ont_serial IS NULL AND property_number IS NULL` },
  { sql: `UPDATE loeks_field_mappings SET match_status='property_only' WHERE match_status IS NULL AND property_number IS NOT NULL AND dr_number IS NULL AND ont_serial IS NULL` },
  { sql: `UPDATE loeks_field_mappings SET match_status='pre_provision', match_notes='ONT pre-provisioned on site; no DR linked in sheet' WHERE match_status IS NULL AND ont_serial IS NOT NULL AND dr_number IS NULL AND pre_provision` },
  { sql: `UPDATE loeks_field_mappings SET match_status='needs_dr', match_notes='Sheet flagged: ' || COALESCE(dr_number, notes_raw) WHERE match_status IS NULL AND ont_serial IS NOT NULL AND (dr_number IS NULL OR dr_number !~ '^DR[0-9]{6,8}$') AND needs_dr` },
  { sql: `UPDATE loeks_field_mappings SET match_status='invalid_serial', match_notes='ONT serial fails ALCLB+hex format check' WHERE match_status IS NULL AND ont_serial IS NOT NULL AND ont_serial !~* '^ALCLB[A-F0-9]{7,13}$'` },
  {
    sql: `UPDATE loeks_field_mappings s
          SET match_status = CASE
                WHEN d.ont_serial IS NULL OR d.ont_serial = '' THEN 'new_fill'
                WHEN d.ont_serial = s.ont_serial THEN 'already_set'
                ELSE 'conflict' END,
              match_drop_id = d.id,
              match_notes = CASE
                WHEN d.ont_serial IS NOT NULL AND d.ont_serial <> ''
                     AND d.ont_serial <> s.ont_serial
                  THEN 'DB has serial ' || d.ont_serial || '; sheet has ' || s.ont_serial
                ELSE NULL END
          FROM drops d
          WHERE s.match_status IS NULL AND s.dr_number ~ '^DR[0-9]{6,8}$'
            AND d.drop_number = s.dr_number AND d.project_id = $1`,
    params: [MOHADIN_PROJECT_ID],
  },
  { sql: `UPDATE loeks_field_mappings SET match_status='dr_not_found', match_notes='DR ' || dr_number || ' not found in drops for Mohadin' WHERE match_status IS NULL AND dr_number ~ '^DR[0-9]{6,8}$'` },
  { sql: `UPDATE loeks_field_mappings SET match_status='invalid_dr', match_notes='DR field does not match DRNNNNNNN format: ' || dr_number WHERE match_status IS NULL AND dr_number IS NOT NULL AND dr_number !~ '^DR[0-9]{6,8}$'` },
  { sql: `UPDATE loeks_field_mappings SET match_status='serial_orphan', match_notes='ONT serial captured without DR or activation note' WHERE match_status IS NULL AND ont_serial IS NOT NULL AND dr_number IS NULL` },
];

async function reconcile(pool: Pool): Promise<void> {
  await pool.query('BEGIN');
  try {
    await pool.query(`UPDATE loeks_field_mappings SET match_status=NULL, match_drop_id=NULL, match_notes=NULL`);
    for (const step of CLASSIFIERS) {
      await pool.query(step.sql, step.params);
    }
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

const out = (s: string): void => { process.stdout.write(s + '\n'); };
const err = (s: string): void => { process.stderr.write(s + '\n'); };

async function summary(pool: Pool): Promise<void> {
  const res = await pool.query(
    `SELECT COALESCE(match_status, '(unclassified)') AS status, COUNT(*)::int AS n
     FROM loeks_field_mappings GROUP BY status ORDER BY n DESC`,
  );
  out('\nReconciliation summary:');
  for (const r of res.rows) {
    out(`  ${r.status.padEnd(20)} ${r.n}`);
  }
  const unclassified = res.rows.find((r: { status: string; n: number }) => r.status === '(unclassified)');
  if (unclassified && unclassified.n > 0) {
    err(`\nWARNING: ${unclassified.n} rows ended reconciliation unclassified.`);
    err('Inspect them with: SELECT * FROM loeks_field_mappings WHERE match_status IS NULL;');
  }
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const rows = loadAll();
  const pons = new Set(rows.map((r) => r.pon_no));
  out(`Parsed ${rows.length} rows across ${pons.size} PONs.`);

  const counts = {
    with_dr: rows.filter((r) => r.dr_number).length,
    with_ont: rows.filter((r) => r.ont_serial).length,
    pre_provision: rows.filter((r) => r.pre_provision).length,
    needs_dr: rows.filter((r) => r.needs_dr).length,
    main_house: rows.filter((r) => r.dwelling_label === 'MAIN HOUSE').length,
    back_room: rows.filter((r) => r.dwelling_label === 'BACK ROOM').length,
  };
  for (const [k, v] of Object.entries(counts)) {
    out(`  ${k.padEnd(15)} ${v}`);
  }

  if (dry) {
    out('\n--dry: skipping DB writes');
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL env var required');
  const pool = new Pool({ connectionString: url });
  try {
    await stage(pool, rows);
    out(`Staged ${rows.length} rows.`);
    await reconcile(pool);
    await summary(pool);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { err(String(e)); process.exit(1); });
