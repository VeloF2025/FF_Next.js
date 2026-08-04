import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool as repositoryPool } from '@/lib/db-pool';
import { listCandidateRows } from '@/modules/velocity-review/candidateRepository';

// CANDIDATE_QUERY joins seven source tables and is the sole origin of every
// customer this pipeline contacts. Unit tests mock @/lib/db-pool and only
// regex-match the SQL text, which cannot catch a parse-time error or a column
// that no longer exists. These tests execute the real query.
//
// Column names and types below were taken from the live schema
// (information_schema.columns), not from the query, so a stand-in that has
// drifted from production fails here rather than passing circularly.
const TARGET = '2026-07-31';

const db = new Pool({ connectionString: process.env.DATABASE_URL });

const SOURCE_TABLES = `
  CREATE TABLE dr_photo_unified_reviews (
    id SERIAL PRIMARY KEY,
    drop_number VARCHAR,
    submitted_date DATE,
    subscriber_phone VARCHAR,
    subscriber_name VARCHAR,
    qcontact_phone VARCHAR,
    qcontact_name VARCHAR,
    step_10_signature BOOLEAN,
    whatsapp_submitted_at TIMESTAMPTZ,
    photos_fetched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
  );
  CREATE TABLE drops (
    id SERIAL PRIMARY KEY,
    drop_number VARCHAR,
    installed_at TIMESTAMPTZ,
    installation_date DATE
  );
  CREATE TABLE stock_serials (
    id SERIAL PRIMARY KEY,
    installed_at_drop_number VARCHAR,
    installed_date TIMESTAMPTZ
  );
  CREATE TABLE oes_activations (
    id SERIAL PRIMARY KEY,
    drop_number VARCHAR,
    activation_datetime TIMESTAMPTZ,
    activation_date DATE
  );
  CREATE TABLE oes_pp_data (
    id SERIAL PRIMARY KEY,
    resolved_drop_number TEXT,
    resolution_status TEXT,
    activated_at TIMESTAMPTZ,
    first_resolved_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ
  );
  CREATE TABLE olt_mismatch_records (
    id SERIAL PRIMARY KEY,
    drop_number VARCHAR,
    created_at TIMESTAMPTZ
  );
  CREATE TABLE onemap_properties (
    id SERIAL PRIMARY KEY,
    drop_number VARCHAR,
    contact_number VARCHAR,
    contact_name VARCHAR,
    contact_surname VARCHAR,
    home_signup_date TIMESTAMP,
    import_id INTEGER,
    updated_at TIMESTAMP
  );
`;

beforeAll(async () => {
  await db.query(SOURCE_TABLES);
});

beforeEach(async () => {
  await db.query(`
    TRUNCATE dr_photo_unified_reviews, drops, stock_serials, oes_activations,
      oes_pp_data, olt_mismatch_records, onemap_properties RESTART IDENTITY
  `);
});

afterAll(async () => {
  try {
    await repositoryPool.end();
  } finally {
    await db.end();
  }
});

describe('listCandidateRows against a real schema', () => {
  it('executes and returns no rows when every source table is empty', async () => {
    // Guards the parse-time failure class: a bad column or type reference
    // throws here even with no data present.
    await expect(listCandidateRows(TARGET)).resolves.toEqual([]);
  });

  it('aggregates every source flag onto one canonical DR number', async () => {
    await db.query(
      `INSERT INTO dr_photo_unified_reviews (drop_number, submitted_date) VALUES ($1, $2)`,
      [' dr1000001 ', TARGET],
    );
    await db.query(
      `INSERT INTO drops (drop_number, installation_date) VALUES ($1, $2)`,
      ['DR1000001', TARGET],
    );
    await db.query(
      `INSERT INTO stock_serials (installed_at_drop_number, installed_date) VALUES ($1, $2)`,
      ['DR1000001', `${TARGET}T08:00:00Z`],
    );
    await db.query(
      `INSERT INTO oes_activations (drop_number, activation_date) VALUES ($1, $2)`,
      ['DR1000001', TARGET],
    );
    await db.query(
      `INSERT INTO oes_pp_data (resolved_drop_number, resolution_status, activated_at)
       VALUES ($1, 'activated', $2)`,
      ['DR1000001', `${TARGET}T08:00:00Z`],
    );
    await db.query(
      `INSERT INTO olt_mismatch_records (drop_number, created_at) VALUES ($1, $2)`,
      ['DR1000001', `${TARGET}T08:00:00Z`],
    );

    const rows = await listCandidateRows(TARGET);

    expect(rows).toHaveLength(1);
    // Lower-case and padded input must canonicalise to a single grouped DR.
    expect(rows[0].dr_number).toBe('DR1000001');
    expect([...(rows[0].sources ?? [])].sort()).toEqual([
      'dr_submitted',
      'drops_installed',
      'oes_activated',
      'olt_mismatch_created',
      'pp_activated',
      'stock_installed',
    ]);
  });

  it('bounds installed_at on the SAST calendar day, not the UTC one', async () => {
    // 21:30Z is 23:30 SAST on the target date; 22:30Z is 00:30 SAST the day
    // after. Dropping AT TIME ZONE would pull the second row into the window.
    await db.query(
      `INSERT INTO drops (drop_number, installed_at) VALUES ($1, $2), ($3, $4)`,
      ['DR2000001', `${TARGET}T21:30:00Z`, 'DR2000002', `${TARGET}T22:30:00Z`],
    );

    const rows = await listCandidateRows(TARGET);

    expect(rows.map((row) => row.dr_number)).toEqual(['DR2000001']);
  });

  it('excludes pp rows whose resolution_status is not activated', async () => {
    await db.query(
      `INSERT INTO oes_pp_data (resolved_drop_number, resolution_status, activated_at)
       VALUES ($1, 'pending', $2)`,
      ['DR3000001', `${TARGET}T08:00:00Z`],
    );

    await expect(listCandidateRows(TARGET)).resolves.toEqual([]);
  });

  it('takes the freshest OneMap row by updated_at, then import_id, then id', async () => {
    await db.query(
      `INSERT INTO drops (drop_number, installation_date) VALUES ($1, $2)`,
      ['DR4000001', TARGET],
    );
    await db.query(
      `INSERT INTO onemap_properties
         (drop_number, contact_number, contact_name, import_id, updated_at)
       VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)`,
      [
        'DR4000001', '0821111111', 'Stale', 1, `${TARGET}T01:00:00`,
        'DR4000001', '0822222222', 'Fresh', 2, `${TARGET}T09:00:00`,
      ],
    );

    const rows = await listCandidateRows(TARGET);

    expect(rows).toHaveLength(1);
    expect(rows[0].onemap_phone).toBe('0822222222');
    expect(rows[0].contact_name).toBe('Fresh');
  });

  it('recovers a customer name from the review row when OneMap has none', async () => {
    // The 2026-08-04 incident: 262 customers were greeted "Hi There" because the
    // query never selected the review name columns at all, even though it already
    // joined that table for the phones. Names existed — they were simply not read.
    await db.query(
      `INSERT INTO dr_photo_unified_reviews
         (drop_number, submitted_date, subscriber_phone, subscriber_name, qcontact_name)
       VALUES ($1, $2, '0821234567', 'Thabo Mokoena', 'Ignored Qcontact')`,
      ['DR7000001', TARGET],
    );
    // OneMap knows the drop but carries no name, so the review name must win over
    // the placeholder rather than being silently discarded.
    await db.query(
      `INSERT INTO onemap_properties (drop_number, contact_number, updated_at)
       VALUES ($1, '0821234567', $2)`,
      ['DR7000001', `${TARGET}T09:00:00`],
    );

    const rows = await listCandidateRows(TARGET);
    const row = rows.find((item) => item.dr_number === 'DR7000001');

    expect(row).toBeDefined();
    expect(row?.subscriber_name).toBe('Thabo Mokoena');
  });

  it('takes the most recent non-blank subscriber and qcontact phones', async () => {
    // The newer review has a blank subscriber_phone; the FILTER clause must
    // skip it and fall through to the older non-blank value rather than
    // returning NULL.
    await db.query(
      `INSERT INTO dr_photo_unified_reviews
         (drop_number, submitted_date, subscriber_phone, qcontact_phone, updated_at)
       VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)`,
      [
        'DR5000001', TARGET, '0831111111', '0841111111', `${TARGET}T01:00:00Z`,
        'DR5000001', TARGET, '   ', '0842222222', `${TARGET}T09:00:00Z`,
      ],
    );

    const rows = await listCandidateRows(TARGET);

    expect(rows).toHaveLength(1);
    expect(rows[0].subscriber_phone).toBe('0831111111');
    expect(rows[0].qcontact_phone).toBe('0842222222');
  });

  it('reports signature evidence only when a signature is present', async () => {
    await db.query(
      `INSERT INTO dr_photo_unified_reviews
         (drop_number, submitted_date, step_10_signature, whatsapp_submitted_at)
       VALUES ($1, $2, TRUE, $3), ($4, $5, FALSE, $6)`,
      [
        'DR6000001', TARGET, `${TARGET}T08:00:00Z`,
        'DR6000002', TARGET, `${TARGET}T08:00:00Z`,
      ],
    );

    const rows = await listCandidateRows(TARGET);
    const signed = rows.find((row) => row.dr_number === 'DR6000001');
    const unsigned = rows.find((row) => row.dr_number === 'DR6000002');

    expect(signed?.signature_present).toBe(true);
    expect(signed?.signature_evidence_at).toBeInstanceOf(Date);
    expect(unsigned?.signature_present).toBe(false);
    expect(unsigned?.signature_evidence_at).toBeNull();
  });

  it('drops rows whose DR number trims to an empty string', async () => {
    await db.query(
      `INSERT INTO drops (drop_number, installation_date) VALUES ($1, $2)`,
      ['   ', TARGET],
    );

    await expect(listCandidateRows(TARGET)).resolves.toEqual([]);
  });
});
