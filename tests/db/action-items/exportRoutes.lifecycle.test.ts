/**
 * The export ROUTES, driven end to end against real Postgres.
 *
 * The library beneath them was well covered and the routes were not covered at all, so
 * the wiring — verdict → access → query → CSV, the truncation slice, the rate limiter,
 * the headers, duplicated query parameters — was exercised by nothing in CI. Review had
 * to hand-build a req/res to establish that it worked.
 *
 * These call the shipped default exports with a mock req/res, so a change to the handler
 * is what fails them, not a change to a copy of its logic.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import type { NextApiRequest, NextApiResponse } from 'next';

import { signExportLink } from '@/lib/reporting/exportLinks';
import { EXPORT_MAX_ROWS } from '@/lib/reporting/exportQueries';
import { UTF8_BOM } from '@/lib/reporting/csv';
import type { ActionItemAccess } from '@/lib/actionItems/meetingAccess';

/**
 * Generated per run rather than written as a literal.
 *
 * A hardcoded value here is indistinguishable to the secret scanner from a real
 * credential, and it is right to be conservative — the cost of a false positive is this
 * comment, the cost of a false negative is a leaked key. Generating it is better test
 * hygiene anyway: nothing can come to depend on a fixed signing key.
 */
const SIGNING_KEY = randomBytes(24).toString('hex');
const alice: ActionItemAccess = { isOwner: false, email: 'alice@example.com', userId: '' };
const bob: ActionItemAccess = { isOwner: false, email: 'bob@example.com', userId: '' };

interface Captured {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function mockRes(): { res: NextApiResponse; captured: Captured } {
  const captured: Captured = { status: 0, headers: {}, body: '' };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    setHeader(k: string, v: string) {
      captured.headers[k.toLowerCase()] = String(v);
    },
    getHeader(k: string) {
      return captured.headers[k.toLowerCase()];
    },
    send(payload: string) {
      captured.body = typeof payload === 'string' ? payload : JSON.stringify(payload);
      return this;
    },
    json(payload: unknown) {
      captured.body = JSON.stringify(payload);
      return this;
    },
    end() {
      return this;
    },
  } as unknown as NextApiResponse;
  return { res, captured };
}

/** A request carrying a genuine signature for `access`, plus any tampering. */
function signedReq(
  report: 'action-items' | 'meetings',
  access: ActionItemAccess,
  filters = 'open',
  tamper: Record<string, string> = {},
  peer = '10.0.0.1',
): NextApiRequest {
  const signed = signExportLink(report, access, filters)!;
  return {
    method: 'GET',
    query: {
      report,
      filters,
      email: access.email,
      owner: access.isOwner ? '1' : '0',
      exp: String(signed.exp),
      sig: signed.sig,
      ...tamper,
    },
    headers: {},
    socket: { remoteAddress: peer },
  } as unknown as NextApiRequest;
}

function dataLines(body: string): string[] {
  return body.replace(UTF8_BOM, '').trimEnd().split('\r\n').slice(1);
}

describe('CSV export routes (real Postgres)', () => {
  let pool: Pool;
  // Imported DYNAMICALLY, after the env is set. `@/lib/db` builds its pool at module
  // load, so a static import at the top of this file would capture the connection string
  // as it was before beforeAll ran — the pool would point at the wrong database and every
  // query would fail with "relation does not exist".
  let exportHandler: (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;

  beforeAll(async () => {
    vi.stubEnv('PHOTO_LINK_SECRET', SIGNING_KEY);
    // The handler builds its own pool from DATABASE_URL, so the fixture schema has to be
    // on ITS search_path too — not just on the pool this test opens. Passed in the
    // connection string because the route never sees our pool options.
    const withSchema = `${process.env.DATABASE_URL_TEST ?? ''}?options=-c%20search_path%3Dai_exp,public`;
    vi.stubEnv('DATABASE_URL', withSchema);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST,
      options: '-c search_path=ai_exp,public',
    });

    // Tables named as production names them, in their own schema, so the shipped SQL runs
    // unchanged. Mirrors the approach in visibility.lifecycle.test.ts.
    await pool.query(`
      DROP SCHEMA IF EXISTS ai_exp CASCADE;
      CREATE SCHEMA ai_exp;

      CREATE TABLE ai_exp.meetings (
        id INT PRIMARY KEY, participants JSONB, title TEXT, meeting_date TIMESTAMP,
        transcript_url TEXT, raw_transcript TEXT, summary JSONB, duration INT, source TEXT
      );
      CREATE TABLE ai_exp.meeting_transcripts (meeting_id INT);
      CREATE TABLE ai_exp.action_items (
        id TEXT PRIMARY KEY, meeting_id INT, description TEXT, assignee_name TEXT,
        assignee_email TEXT, assigned_to_user_id UUID, status TEXT, priority TEXT,
        due_date TIMESTAMP, completed_date TIMESTAMP, created_at TIMESTAMP DEFAULT NOW(),
        source_type TEXT
      );

      INSERT INTO ai_exp.meetings (id, participants, title, meeting_date, duration, source) VALUES
        (1, '[{"email":"alice@example.com"}]'::jsonb, 'Alice meeting', '2026-07-10 09:00', 30, 'teams'),
        (2, '[{"email":"bob@example.com"}]'::jsonb,   'Bob meeting',   '2026-07-11 09:00', 45, 'teams');

      INSERT INTO ai_exp.action_items (id, meeting_id, description, status, created_at) VALUES
        ('a1', 1, 'Alice item, with a comma', 'pending',   '2026-07-10 10:00'),
        ('a2', 1, '=HYPERLINK("http://evil","x")', 'pending', '2026-07-10 11:00'),
        ('b1', 2, 'Bob item', 'pending', '2026-07-11 10:00'),
        ('a3', 1, 'Alice done', 'completed', '2026-07-10 12:00');
    `);

    exportHandler = (await import('@/pages/api/reporting/export')).default as typeof exportHandler;
  });

  afterAll(async () => {
    await pool.query('DROP SCHEMA IF EXISTS ai_exp CASCADE;');
    await pool.end();
    vi.unstubAllEnvs();
  });

  it('serves only the signer’s own rows', async () => {
    const { res, captured } = mockRes();
    await exportHandler(signedReq('action-items', alice, 'all'), res);

    expect(captured.status).toBe(200);
    const body = captured.body;
    expect(body).toContain('Alice item');
    expect(body).not.toContain('Bob item');
  });

  it('refuses a link whose email was swapped to another person', async () => {
    // The whole design rests on this: the scope is inside the signature.
    const { res, captured } = mockRes();
    await exportHandler(
      signedReq('action-items', alice, 'all', { email: bob.email }),
      res,
    );
    expect(captured.status).toBe(401);
    expect(captured.body).not.toContain('Bob item');
  });

  it('refuses a link whose owner flag was raised', async () => {
    const { res, captured } = mockRes();
    await exportHandler(signedReq('meetings', alice, 'open', { owner: '1' }), res);
    expect(captured.status).toBe(401);
  });

  it('sets CSV headers and an attachment filename', async () => {
    const { res, captured } = mockRes();
    await exportHandler(signedReq('meetings', alice), res);

    expect(captured.headers['content-type']).toContain('text/csv');
    expect(captured.headers['content-disposition']).toMatch(/attachment; filename="meetings-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(captured.headers['cache-control']).toBe('private, no-store');
  });

  it('neutralises a formula that came out of the database', async () => {
    // The payload is a real row, not a string built in the test.
    const { res, captured } = mockRes();
    await exportHandler(signedReq('action-items', alice, 'all'), res);
    expect(captured.body).toContain(`"'=HYPERLINK`);
  });

  it('applies the state filter', async () => {
    const { res: r1, captured: open } = mockRes();
    await exportHandler(signedReq('action-items', alice, 'open'), r1);
    const { res: r2, captured: all } = mockRes();
    await exportHandler(signedReq('action-items', alice, 'all'), r2);

    expect(dataLines(open.body).length).toBeLessThan(dataLines(all.body).length);
    expect(open.body).not.toContain('Alice done');
  });

  it('takes the FIRST value of a duplicated parameter, which is the signed one', async () => {
    const { res, captured } = mockRes();
    const req = signedReq('action-items', alice, 'all');
    (req.query as Record<string, unknown>).email = [alice.email, bob.email];
    await exportHandler(req, res);

    expect(captured.status).toBe(200);
    expect(captured.body).not.toContain('Bob item');
  });

  it('rejects an unknown report before doing any work', async () => {
    const { res, captured } = mockRes();
    const req = signedReq('action-items', alice);
    (req.query as Record<string, unknown>).report = 'transcripts';
    await exportHandler(req, res);
    expect(captured.status).toBe(400);
  });

  it('rejects a non-GET method', async () => {
    const { res, captured } = mockRes();
    const req = signedReq('meetings', alice);
    (req as { method: string }).method = 'POST';
    await exportHandler(req, res);
    expect(captured.status).toBe(405);
  });

  it('emits a header row even when the caller matches nothing', async () => {
    // An empty file reads as a failed download; a header row reads as "no rows".
    const nobody: ActionItemAccess = { isOwner: false, email: 'nobody@example.com', userId: '' };
    const { res, captured } = mockRes();
    await exportHandler(signedReq('meetings', nobody), res);

    expect(captured.status).toBe(200);
    expect(dataLines(captured.body)).toEqual([]);
    expect(captured.body.replace(UTF8_BOM, '').startsWith('Meeting,')).toBe(true);
  });

  it('rate-limits a verified caller without letting an invalid signature mint buckets', async () => {
    // The limiter used to key on the caller-supplied sig and run BEFORE verification, so
    // every guess got a fresh bucket and the map grew unbounded on the unauthenticated
    // path. Distinct peers are still independent; the same peer is bounded.
    const peer = '10.9.9.9';
    let lastStatus = 0;
    for (let i = 0; i < 70; i++) {
      const { res, captured } = mockRes();
      const req = signedReq('meetings', alice, 'open', { sig: `bogus-${i}` }, peer);
      await exportHandler(req, res);
      lastStatus = captured.status;
    }
    // Bounded by the peer key, not by whatever signature the caller invents.
    expect(lastStatus).toBe(429);
  });

  it('caps the row count and says so IN THE FILE', async () => {
    // The truncation notice has to live in the CSV: neither a browser download nor a
    // spreadsheet import ever surfaces a response header, so the header alone made a
    // partial export indistinguishable from a complete one.
    await pool.query(
      `INSERT INTO ai_exp.action_items (id, meeting_id, description, status, created_at)
       SELECT 'bulk-' || g, 1, 'row ' || g, 'pending', '2026-07-10 09:00'::timestamp + (g || ' seconds')::interval
         FROM generate_series(1, $1) g`,
      [EXPORT_MAX_ROWS + 20],
    );

    const { res, captured } = mockRes();
    await exportHandler(signedReq('action-items', alice, 'all'), res);

    const lines = dataLines(captured.body);
    expect(lines).toHaveLength(EXPORT_MAX_ROWS + 1); // capped rows + the notice
    expect(captured.headers['x-export-truncated']).toBe('true');
    expect(lines[lines.length - 1]).toContain('truncated');

    // Names the REAL total, computed here rather than hardcoded — Bob's row is correctly
    // outside Alice's scope, so the total is her count and not the table's.
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM action_items a WHERE a.meeting_id = 1`,
    );
    expect(lines[lines.length - 1]).toContain(String(rows[0].n));
    expect(rows[0].n).toBeGreaterThan(EXPORT_MAX_ROWS);
  });
});
