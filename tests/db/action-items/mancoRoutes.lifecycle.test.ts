/**
 * The manco routes' ENFORCEMENT, driven end to end.
 *
 * The helper that decides access was well covered and the wiring was not covered at all:
 * deleting the entire `if (!access.ok) { ... }` block from both route files left the whole
 * suite green. The helper is the easy half. "The guard is reached, and it returns before
 * anything touches the database" is the property these routes exist to establish, and it
 * was pinned by nothing.
 *
 * So these call the shipped default exports and assert on the RESPONSE — a 403 with no
 * row written — rather than on the helper's return value.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { NextApiRequest, NextApiResponse } from 'next';

const ALLOWED = '11111111-1111-4111-8111-111111111111';
const DENIED = '22222222-2222-4222-8222-222222222222';

/**
 * Only the permission lookup is mocked — everything else is the real route, the real
 * query and a real database. Mocking the route's own logic would test a copy of it.
 */
vi.mock('@/lib/permissions', () => ({
  userHasPermission: vi.fn(async (userId: string) => userId === ALLOWED),
}));

/**
 * `withAuth` is stubbed to a pass-through that leaves `req.user` as the test set it.
 *
 * Authentication is not what these tests are about — they establish that the PERMISSION
 * guard is reached and returns before any query. Driving the real middleware would mean
 * minting a JWT and a user_sessions row per case, which tests the session layer instead.
 * Everything inside the handler, including the guard, is the shipped code.
 */
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  withAuth:
    (handler: (r: NextApiRequest, s: NextApiResponse) => unknown) =>
    (r: NextApiRequest, s: NextApiResponse) =>
      handler(r, s),
}));

interface Captured {
  status: number;
  body: unknown;
}

function mockRes(): { res: NextApiResponse; captured: Captured } {
  const captured: Captured = { status: 0, body: undefined };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
    setHeader() {},
    send(payload: unknown) {
      captured.body = payload;
      return this;
    },
    end() {
      return this;
    },
  } as unknown as NextApiResponse;
  return { res, captured };
}

function req(
  method: string,
  opts: { query?: Record<string, unknown>; body?: unknown; user: string },
): NextApiRequest {
  return {
    method,
    query: opts.query ?? {},
    body: opts.body ?? {},
    headers: {},
    user: { id: opts.user, email: `${opts.user}@example.com`, role: 'viewer' },
  } as unknown as NextApiRequest;
}

describe('manco route enforcement (real Postgres)', () => {
  let pool: Pool;
  let indexHandler: (r: NextApiRequest, s: NextApiResponse) => Promise<unknown>;
  let idHandler: (r: NextApiRequest, s: NextApiResponse) => Promise<unknown>;
  let linkHandler: (r: NextApiRequest, s: NextApiResponse) => Promise<unknown>;
  let linkedHandler: (r: NextApiRequest, s: NextApiResponse) => Promise<unknown>;
  let itemId: string;

  beforeAll(async () => {
    const url = `${process.env.DATABASE_URL_TEST ?? ''}?options=-c%20search_path%3Dmanco_rt,public`;
    vi.stubEnv('DATABASE_URL', url);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST,
      options: '-c search_path=manco_rt,public',
    });

    await pool.query(`
      DROP SCHEMA IF EXISTS manco_rt CASCADE;
      CREATE SCHEMA manco_rt;
      CREATE TABLE manco_rt.manco_action_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        action_item TEXT NOT NULL,
        department TEXT, logged_date DATE, completion_eta DATE, completion_date DATE,
        responsible_person TEXT, fibreflow_dev BOOLEAN DEFAULT false,
        fibreflow_module TEXT, fibreflow_link TEXT, fibreflow_responsible TEXT,
        fibreflow_priority TEXT, fibreflow_dev_status TEXT, comment TEXT,
        status TEXT NOT NULL DEFAULT 'pending', is_ongoing BOOLEAN DEFAULT false,
        source_meeting_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        reference_link TEXT, document_url TEXT
      );
      -- Mirrors production: link-meeting does ON CONFLICT (manco_action_item_id,
      -- meeting_id) ... RETURNING id, so the fixture needs both the id column and the
      -- unique constraint or the INSERT throws and the route silently reports failure.
      CREATE TABLE manco_rt.manco_action_item_meetings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        manco_action_item_id UUID,
        meeting_id INTEGER,
        linked_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (manco_action_item_id, meeting_id)
      );
      CREATE TABLE manco_rt.meetings (id INTEGER PRIMARY KEY, title TEXT, meeting_date DATE);
      INSERT INTO manco_rt.meetings (id, title, meeting_date) VALUES (1, 'Board meeting', '2026-08-10');
    `);

    const inserted = await pool.query(
      `INSERT INTO manco_rt.manco_action_items (action_item, status)
       VALUES ('original text', 'pending') RETURNING id::text`,
    );
    itemId = inserted.rows[0].id;

    // Imported AFTER the env is set: @/lib/db builds its pool at module load, so a static
    // import would capture the connection string from before beforeAll ran.
    indexHandler = (await import('@/pages/api/manco-action-items/index')).default as typeof indexHandler;
    idHandler = (await import('@/pages/api/manco-action-items/[id]')).default as typeof idHandler;
    linkHandler = (await import('@/pages/api/manco-action-items/link-meeting')).default as typeof linkHandler;
    linkedHandler = (await import('@/pages/api/manco-action-items/linked-meetings')).default as typeof linkedHandler;
  });

  afterAll(async () => {
    await pool.query('DROP SCHEMA IF EXISTS manco_rt CASCADE;');
    await pool.end();
    vi.unstubAllEnvs();
  });

  afterEach(async () => {
    await pool.query(`UPDATE manco_rt.manco_action_items SET action_item = 'original text', status = 'pending' WHERE id = $1::uuid`, [itemId]);
    await pool.query('DELETE FROM manco_rt.manco_action_item_meetings');
  });

  async function itemText(): Promise<string> {
    const { rows } = await pool.query('SELECT action_item FROM manco_action_items WHERE id = $1::uuid', [itemId]);
    return rows[0]?.action_item as string;
  }

  describe('a denied caller', () => {
    it('cannot PATCH — 403 and the row is UNCHANGED', async () => {
      // The row check is what makes this a test of enforcement rather than of a status
      // code: a guard that 403s after writing would pass a status-only assertion.
      const { res, captured } = mockRes();
      await idHandler(
        req('PATCH', { query: { id: itemId }, body: { action_item: 'tampered' }, user: DENIED }),
        res,
      );
      expect(captured.status).toBe(403);
      expect(await itemText()).toBe('original text');
    });

    it('cannot DELETE — 403 and the row SURVIVES', async () => {
      const { res, captured } = mockRes();
      await idHandler(req('DELETE', { query: { id: itemId }, user: DENIED }), res);
      expect(captured.status).toBe(403);
      expect(await itemText()).toBe('original text');
    });

    it('cannot GET a single item', async () => {
      const { res, captured } = mockRes();
      await idHandler(req('GET', { query: { id: itemId }, user: DENIED }), res);
      expect(captured.status).toBe(403);
    });

    it('cannot LIST', async () => {
      const { res, captured } = mockRes();
      await indexHandler(req('GET', { user: DENIED }), res);
      expect(captured.status).toBe(403);
    });

    it('cannot CREATE — 403 and no row is inserted', async () => {
      const before = await pool.query('SELECT count(*)::int n FROM manco_action_items');
      const { res, captured } = mockRes();
      await indexHandler(req('POST', { body: { action_item: 'sneaked in' }, user: DENIED }), res);
      expect(captured.status).toBe(403);
      const after = await pool.query('SELECT count(*)::int n FROM manco_action_items');
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it('cannot LINK a meeting — 403 and no link row is written', async () => {
      // link-meeting writes to manco_action_items too, so gating the other two routes
      // while leaving this one open would move the hole rather than close it.
      const { res, captured } = mockRes();
      await linkHandler(
        req('POST', { body: { manco_action_item_id: itemId, meeting_id: 1 }, user: DENIED }),
        res,
      );
      expect(captured.status).toBe(403);
      const { rows } = await pool.query('SELECT count(*)::int n FROM manco_action_item_meetings');
      expect(rows[0].n).toBe(0);
    });

    it('cannot READ the linked meetings — 403, and no meeting title comes back', async () => {
      // The read side of the same pair. link-meeting was gated and this was not, so a
      // denied caller could still ask "what meetings does item X touch?" and be told the
      // title and date of each — enough to confirm a meeting exists and when it ran.
      const { res, captured } = mockRes();
      await linkedHandler(req('GET', { query: { item_id: itemId }, user: DENIED }), res);
      expect(captured.status).toBe(403);
      expect(JSON.stringify(captured.body ?? '')).not.toContain('Board meeting');
    });

    it('cannot UNLINK a meeting', async () => {
      const { res, captured } = mockRes();
      await linkHandler(
        req('DELETE', { body: { manco_action_item_id: itemId, meeting_id: 1 }, user: DENIED }),
        res,
      );
      expect(captured.status).toBe(403);
    });
  });

  describe('an allowed caller', () => {
    it('CAN PATCH, and the row actually changes', async () => {
      // The mirror of the denial tests. Without this a guard that refused EVERYONE would
      // satisfy every assertion above.
      const { res, captured } = mockRes();
      await idHandler(
        req('PATCH', { query: { id: itemId }, body: { action_item: 'legitimately edited' }, user: ALLOWED }),
        res,
      );
      expect(captured.status).not.toBe(403);
      expect(await itemText()).toBe('legitimately edited');
    });

    it('CAN list', async () => {
      const { res, captured } = mockRes();
      await indexHandler(req('GET', { user: ALLOWED }), res);
      expect(captured.status).not.toBe(403);
    });

    it('CAN link a meeting', async () => {
      const { res, captured } = mockRes();
      await linkHandler(
        req('POST', { body: { manco_action_item_id: itemId, meeting_id: 1 }, user: ALLOWED }),
        res,
      );
      expect(captured.status).not.toBe(403);
      const { rows } = await pool.query('SELECT count(*)::int n FROM manco_action_item_meetings');
      expect(rows[0].n).toBe(1);
    });

    it('CAN read the linked meetings, and actually gets the title', async () => {
      // The mirror of the denial test: without it, a route that 403'd everyone would
      // satisfy that one. The link is made here rather than relying on the test above —
      // afterEach clears the link table, so leaning on execution order would assert
      // against an empty result and pass for the wrong reason.
      await pool.query(
        'INSERT INTO manco_action_item_meetings (manco_action_item_id, meeting_id) VALUES ($1::uuid, 1)',
        [itemId],
      );
      const { res, captured } = mockRes();
      await linkedHandler(req('GET', { query: { item_id: itemId }, user: ALLOWED }), res);
      expect(captured.status).not.toBe(403);
      expect(JSON.stringify(captured.body ?? '')).toContain('Board meeting');
    });
  });

  it('refuses an unknown id without reaching the guard for a malformed request', async () => {
    const { res, captured } = mockRes();
    await idHandler(req('PATCH', { query: {}, body: {}, user: ALLOWED }), res);
    expect(captured.status).toBe(400);
  });

  it('does not write when a permitted caller targets a row that does not exist', async () => {
    const { res, captured } = mockRes();
    await idHandler(
      req('PATCH', { query: { id: randomUUID() }, body: { action_item: 'x' }, user: ALLOWED }),
      res,
    );
    expect([404, 400]).toContain(captured.status);
    expect(await itemText()).toBe('original text');
  });
});
