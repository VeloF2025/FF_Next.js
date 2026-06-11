# SiteCam Appeals Failed Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Failed" tab to the SiteCam Appeals page showing 3-strike photo failures from `pwa_escalations`, with clickable drop numbers that expand to show the failed photos, and approve/reject actions.

**Architecture:** New read-only API (`/api/activate/sitecam-failed`) over the existing `pwa_escalations` table; new `SiteCamFailedQueue` component rendered by a fourth tab in `SiteCamAppealsQueue`; resolve actions reuse the existing `/api/sitecam/escalation-resolve` endpoint. No schema or PWA changes.

**Tech Stack:** Next.js Pages Router API routes, `pg` pool via `@/lib/db`, Vitest + node-mocks-http (API tests), Vitest + @testing-library/react (component tests).

**Spec:** `docs/superpowers/specs/2026-06-11-sitecam-failed-tab-design.md`

**Branch:** `feat/sitecam-failed-tab` (already created off origin/master). NEVER commit to master. Open a PR at the end; do NOT merge — wait for Hein/Zander.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `pages/api/activate/sitecam-failed.ts` | Create | GET list of pwa_escalations (pending/resolved), manager+ |
| `tests/api/activate/sitecam-failed.test.ts` | Create | API handler tests |
| `src/modules/activate/components/SiteCamFailedQueue.tsx` | Create | Failed tab list UI: rows, expand, photos, approve/reject |
| `src/modules/activate/components/__tests__/SiteCamFailedQueue.test.tsx` | Create | Component tests |
| `src/modules/activate/components/SiteCamAppealsQueue.tsx` | Modify | Add 4th "failed" tab; link-style drop numbers |

Reference reading for the engineer (do not modify):
- `pages/api/activate/sitecam-appeals.ts` — auth + query pattern this API mirrors
- `pages/api/sitecam/escalation-resolve.ts` — resolve endpoint the UI calls
- `scripts/migrations/sql/390_pwa_support.sql` — `pwa_escalations` schema: `id, job_type ('activations'|'civils'), site_id, step_number, tech_id, fail_reasons TEXT[], attempt_photos JSONB [{attempt,url,reasons}], status ('pending'|'approved'|'rejected'), resolved_by, resolved_at, resolution_note, created_at`

---

### Task 1: API endpoint `GET /api/activate/sitecam-failed`

**Files:**
- Test: `tests/api/activate/sitecam-failed.test.ts`
- Create: `pages/api/activate/sitecam-failed.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/api/activate/sitecam-failed.test.ts
/**
 * API Tests: GET /api/activate/sitecam-failed
 * Lists pwa_escalations (3-strike SiteCam failures) for the Appeals page Failed tab.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const mockQuery = vi.fn();

vi.mock('@/lib/db', () => ({
  default: { query: mockQuery },
  db: { query: mockQuery },
}));

vi.mock('@/lib/auth', () => ({
  withAuth: (handler: Function) => handler,
  withRole: () => (handler: Function) => handler,
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import handler from '@/pages/api/activate/sitecam-failed';

const ESCALATION_ROW = {
  id: 'esc-1',
  job_type: 'activations',
  site_id: '9999990',
  step_number: 6,
  tech_name: 'Test Tech',
  fail_reasons: ['No green cable visible'],
  attempt_photos: [
    { attempt: 1, url: 'https://app.fibreflow.app/storage/a1.jpg', reasons: ['blurry'] },
    { attempt: 2, url: 'https://app.fibreflow.app/storage/a2.jpg', reasons: ['no ONT'] },
    { attempt: 3, url: 'https://app.fibreflow.app/storage/a3.jpg', reasons: ['no green cable'] },
  ],
  status: 'pending',
  created_at: '2026-06-11T08:00:00Z',
  resolved_by_name: null,
  resolved_at: null,
  resolution_note: null,
};

describe('GET /api/activate/sitecam-failed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects non-GET methods', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST' });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(405);
  });

  it('defaults to pending and queries status = pending only', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ESCALATION_ROW] });
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'GET' });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const sql = mockQuery.mock.calls[0][0] as string;
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(sql).toContain('pwa_escalations');
    expect(params).toEqual([['pending']]);
    const body = JSON.parse(res._getData());
    expect(body.data.escalations).toHaveLength(1);
    expect(body.data.escalations[0].site_id).toBe('9999990');
  });

  it('status=resolved queries approved and rejected', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { status: 'resolved' },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params).toEqual([['approved', 'rejected']]);
  });

  it('rejects an invalid status value', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: { status: 'bogus' },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/activate/sitecam-failed.test.ts`
Expected: FAIL — cannot resolve `@/pages/api/activate/sitecam-failed` (module does not exist).

- [ ] **Step 3: Write the implementation**

```typescript
// pages/api/activate/sitecam-failed.ts
/**
 * GET /api/activate/sitecam-failed?status=pending|resolved
 *
 * Lists pwa_escalations — SiteCam steps that failed VLM validation 3 times.
 * Feeds the "Failed" tab on the SiteCam Appeals page.
 * status=resolved returns both approved and rejected escalations.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET')
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);

  const statusFilter = (req.query.status as string) || 'pending';
  if (!['pending', 'resolved'].includes(statusFilter))
    return apiResponse.badRequest(res, 'status must be pending or resolved');

  const statuses = statusFilter === 'pending' ? ['pending'] : ['approved', 'rejected'];

  const { rows } = await pool.query(
    `SELECT e.id, e.job_type, e.site_id, e.step_number,
            e.fail_reasons, e.attempt_photos, e.status,
            e.resolved_at, e.resolution_note, e.created_at,
            t.first_name || ' ' || t.last_name AS tech_name,
            r.first_name || ' ' || r.last_name AS resolved_by_name
     FROM pwa_escalations e
     LEFT JOIN staff t ON t.id = e.tech_id
     LEFT JOIN staff r ON r.id = e.resolved_by
     WHERE e.status = ANY($1)
     ORDER BY e.created_at DESC
     LIMIT 100`,
    [statuses],
  );

  return apiResponse.success(res, { escalations: rows });
}

export default withAuth(withRole('manager')(handler));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/activate/sitecam-failed.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/api/activate/sitecam-failed.test.ts pages/api/activate/sitecam-failed.ts
git commit -m "feat(sitecam): API listing pwa_escalations for Appeals Failed tab"
```

---

### Task 2: `SiteCamFailedQueue` component

**Files:**
- Test: `src/modules/activate/components/__tests__/SiteCamFailedQueue.test.tsx`
- Create: `src/modules/activate/components/SiteCamFailedQueue.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/modules/activate/components/__tests__/SiteCamFailedQueue.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { SiteCamFailedQueue } from '../SiteCamFailedQueue';

const ESCALATION = {
  id: 'esc-1',
  job_type: 'activations',
  site_id: '9999990',
  step_number: 6,
  tech_name: 'Test Tech',
  fail_reasons: ['No green cable visible'],
  attempt_photos: [
    { attempt: 1, url: 'https://app.fibreflow.app/storage/a1.jpg', reasons: ['blurry'] },
    { attempt: 2, url: 'https://app.fibreflow.app/storage/a2.jpg', reasons: ['no ONT'] },
    { attempt: 3, url: 'https://app.fibreflow.app/storage/a3.jpg', reasons: ['no green cable'] },
  ],
  status: 'pending',
  created_at: '2026-06-11T08:00:00Z',
  resolved_by_name: null,
  resolved_at: null,
  resolution_note: null,
};

function mockFetchList(escalations: unknown[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { escalations } }),
  });
}

describe('SiteCamFailedQueue', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lists escalations with a link-styled site id', async () => {
    global.fetch = mockFetchList([ESCALATION]);
    render(<SiteCamFailedQueue />);
    const link = await screen.findByRole('button', { name: '9999990' });
    expect(link).toBeTruthy();
    expect(screen.getByText(/Step 6/)).toBeTruthy();
  });

  it('expands on site id click and shows all attempt photos', async () => {
    global.fetch = mockFetchList([ESCALATION]);
    render(<SiteCamFailedQueue />);
    fireEvent.click(await screen.findByRole('button', { name: '9999990' }));
    const imgs = await screen.findAllByRole('img');
    expect(imgs).toHaveLength(3);
    expect(screen.getByText(/no green cable/)).toBeTruthy();
  });

  it('requires a note to reject', async () => {
    global.fetch = mockFetchList([ESCALATION]);
    render(<SiteCamFailedQueue />);
    fireEvent.click(await screen.findByRole('button', { name: '9999990' }));
    const reject = await screen.findByRole('button', { name: /Reject/ });
    expect((reject as HTMLButtonElement).disabled).toBe(true);
  });

  it('posts to escalation-resolve on approve and reloads', async () => {
    const fetchMock = mockFetchList([ESCALATION]);
    global.fetch = fetchMock;
    render(<SiteCamFailedQueue />);
    fireEvent.click(await screen.findByRole('button', { name: '9999990' }));
    fireEvent.click(await screen.findByRole('button', { name: /Approve/ }));
    await waitFor(() => {
      const resolveCall = fetchMock.mock.calls.find(
        (c: unknown[]) => c[0] === '/api/sitecam/escalation-resolve',
      );
      expect(resolveCall).toBeTruthy();
      const init = resolveCall![1] as RequestInit;
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ id: 'esc-1', resolution: 'approved' });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/modules/activate/components/__tests__/SiteCamFailedQueue.test.tsx`
Expected: FAIL — cannot resolve `../SiteCamFailedQueue`.

- [ ] **Step 3: Write the component**

```tsx
// src/modules/activate/components/SiteCamFailedQueue.tsx
import { useEffect, useState, useCallback } from 'react';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { log } from '@/lib/logger';

interface AttemptPhoto {
  attempt: number;
  url: string;
  reasons: string[];
}

interface Escalation {
  id: string;
  job_type: 'activations' | 'civils';
  site_id: string;
  step_number: number;
  tech_name: string | null;
  fail_reasons: string[];
  attempt_photos: AttemptPhoto[];
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  resolved_by_name: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

const STEP_LABELS: Record<number, string> = {
  1: 'House Photo', 2: 'Cable from Pole', 3: 'Entry Outside',
  4: 'Entry Inside', 5: 'Wall Mount', 6: 'ONT Back After Install',
  7: 'Power Meter', 8: 'Final Installation', 9: 'Green Lights',
  10: 'Signature', 11: 'Dome Joint Open', 12: 'Dome Joint Closed',
};

const MODULE = 'SiteCamFailedQueue';

export function SiteCamFailedQueue() {
  const [filter, setFilter] = useState<'pending' | 'resolved'>('pending');
  const [items, setItems] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (status: 'pending' | 'resolved') => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/activate/sitecam-failed?status=${status}`, { credentials: 'include' });
      const j = (await r.json()) as { data: { escalations: Escalation[] } };
      setItems(j.data.escalations);
    } catch (err) {
      log.error('Load failed escalations failed', { err: String(err) }, MODULE);
      setError('Could not load failed submissions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(filter); }, [filter, load]);

  async function resolve(id: string, resolution: 'approved' | 'rejected') {
    setResolving(id);
    setError(null);
    try {
      const res = await fetch('/api/sitecam/escalation-resolve', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          resolution === 'rejected' ? { id, resolution, note } : { id, resolution },
        ),
      });
      if (!res.ok) {
        log.error('Resolve rejected', { id, status: res.status }, MODULE);
        setError('Could not resolve — it may already be resolved. Reloading…');
        await load(filter);
        return;
      }
      setNote('');
      setExpanded(null);
      await load(filter);
    } catch (err) {
      log.error('Resolve failed', { err: String(err) }, MODULE);
      setError('Could not resolve the escalation');
    } finally {
      setResolving(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['pending', 'resolved'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
              filter === f ? 'bg-sky-100 text-sky-700' : 'bg-neutral-100 text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading && (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <p className="py-10 text-center text-sm text-neutral-400">No {filter} failed submissions</p>
      )}

      <div className="space-y-2">
        {items.map((e) => (
          <div key={e.id} className="rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex w-full items-center justify-between px-4 py-3">
              <div>
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  className="font-medium text-sky-700 underline-offset-2 hover:underline"
                >
                  {e.site_id}
                </button>
                <span className="mx-2 text-neutral-400">·</span>
                <span className="text-sm text-neutral-600">
                  Step {e.step_number}: {STEP_LABELS[e.step_number] ?? ''}
                </span>
                <span className="mx-2 text-neutral-400">·</span>
                <span className="text-xs text-neutral-500">{e.tech_name ?? 'Unknown'}</span>
              </div>
              <span className={`text-xs font-medium capitalize ${
                e.status === 'pending' ? 'text-amber-600'
                  : e.status === 'approved' ? 'text-green-600' : 'text-red-600'
              }`}>
                {e.status}
              </span>
            </div>

            {expanded === e.id && (
              <div className="border-t border-neutral-100 px-4 py-4 space-y-4">
                {e.fail_reasons.length > 0 && (
                  <p className="text-sm text-neutral-700">{e.fail_reasons.join('; ')}</p>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {e.attempt_photos.map((p) => (
                    <figure key={p.attempt} className="space-y-1">
                      <img
                        src={p.url}
                        alt={`Attempt ${p.attempt}`}
                        className="h-40 w-full rounded-lg object-contain border border-neutral-200 bg-neutral-50"
                      />
                      <figcaption className="text-xs text-neutral-500">
                        Attempt {p.attempt}: {p.reasons.join(', ')}
                      </figcaption>
                    </figure>
                  ))}
                </div>

                {e.status === 'pending' ? (
                  <div className="space-y-3">
                    <textarea
                      value={note}
                      onChange={(ev) => setNote(ev.target.value)}
                      placeholder="Note (required if rejecting)…"
                      rows={2}
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-sky-400"
                    />
                    <div className="flex gap-3">
                      <button
                        type="button"
                        disabled={resolving === e.id}
                        onClick={() => void resolve(e.id, 'approved')}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
                      >
                        <CheckCircle className="h-4 w-4" /> Approve
                      </button>
                      <button
                        type="button"
                        disabled={resolving === e.id || !note.trim()}
                        onClick={() => void resolve(e.id, 'rejected')}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
                      >
                        <XCircle className="h-4 w-4" /> Reject
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-neutral-500">
                    {e.status === 'approved' ? 'Approved' : 'Rejected'} by {e.resolved_by_name ?? 'unknown'}
                    {e.resolution_note ? ` — ${e.resolution_note}` : ''}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/modules/activate/components/__tests__/SiteCamFailedQueue.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/activate/components/SiteCamFailedQueue.tsx src/modules/activate/components/__tests__/SiteCamFailedQueue.test.tsx
git commit -m "feat(sitecam): Failed-submissions queue component with approve/reject"
```

---

### Task 3: Wire the Failed tab into `SiteCamAppealsQueue` + link-style drop numbers

**Files:**
- Modify: `src/modules/activate/components/SiteCamAppealsQueue.tsx`

- [ ] **Step 1: Add the import**

At the top of `SiteCamAppealsQueue.tsx`, after the existing imports:

```tsx
import { SiteCamFailedQueue } from './SiteCamFailedQueue';
```

- [ ] **Step 2: Extend the tab state and list**

Replace:
```tsx
  const [tab, setTab] = useState<'pending' | 'approved' | 'denied'>('pending');
```
with:
```tsx
  const [tab, setTab] = useState<'pending' | 'approved' | 'denied' | 'failed'>('pending');
```

Replace:
```tsx
  const tabs: Array<'pending' | 'approved' | 'denied'> = ['pending', 'approved', 'denied'];
```
with:
```tsx
  const tabs: Array<'pending' | 'approved' | 'denied' | 'failed'> = ['pending', 'approved', 'denied', 'failed'];
```

- [ ] **Step 3: Guard the appeals loader and render the Failed queue**

Replace:
```tsx
  useEffect(() => { void load(tab); }, [tab, load]);
```
with:
```tsx
  useEffect(() => {
    if (tab !== 'failed') void load(tab);
  }, [tab, load]);
```

In the JSX, immediately after the tab-bar `</div>` (the one closing `className="flex gap-2 border-b ..."`), add an early branch so the failed tab renders its own queue:

```tsx
      {tab === 'failed' ? (
        <SiteCamFailedQueue />
      ) : (
        <>
```
and close the fragment after the appeals list's final `</div>` (the one closing `className="space-y-2"`), before the component's outer closing `</div>`:
```tsx
        </>
      )}
```
The existing `{loading && ...}`, `{!loading && appeals.length === 0 && ...}`, and the appeals `<div className="space-y-2">` list all move inside this fragment (indentation only — no logic changes).

Note: `decide()` calls `load(tab)` — TypeScript will complain that `tab` can now be `'failed'`. `decide` is only reachable from appeal cards (never rendered when `tab === 'failed'`), so narrow it:
```tsx
      await load(tab === 'failed' ? 'pending' : tab);
```

- [ ] **Step 4: Make the appeal drop number the link-styled click target**

In the appeal card, the row is one `<button>` wrapping everything. Change the drop-number span inside it from:
```tsx
                <span className="font-medium text-neutral-800">{a.dr_number}</span>
```
to:
```tsx
                <span className="font-medium text-sky-700 underline-offset-2 hover:underline">{a.dr_number}</span>
```
(The whole row stays clickable; the drop number now reads as the affordance.)

- [ ] **Step 5: Type-check and run all the new tests**

Run: `npx tsc --noEmit && npx vitest run tests/api/activate/sitecam-failed.test.ts src/modules/activate/components/__tests__/SiteCamFailedQueue.test.tsx`
Expected: type-check clean, 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/activate/components/SiteCamAppealsQueue.tsx
git commit -m "feat(sitecam): Failed tab on Appeals page + link-styled drop numbers"
```

---

### Task 4: CI, manual verification, PR

- [ ] **Step 1: Run local CI gates**

Run: `npm run ci:quick`
Expected: all gates pass. Fix anything that fails (never `--no-verify`).

- [ ] **Step 2: Manual verification (local dev)**

1. `PORT=3004 npm run dev`
2. Insert a fake escalation for a seeded test DR (uses the dev DB — coordinate before inserting):
   ```sql
   INSERT INTO pwa_escalations (job_type, site_id, step_number, fail_reasons, attempt_photos)
   VALUES ('activations', '9999990', 6, ARRAY['test fail'],
           '[{"attempt":1,"url":"https://app.fibreflow.app/storage/test.jpg","reasons":["test"]}]');
   ```
3. Open `http://localhost:3004/activate/sitecam-appeals` as a manager+ user → Failed tab shows the row; click `9999990` → photos expand; Reject is disabled until a note is typed; Approve resolves and the row moves to the Resolved filter.
4. Clean up: `DELETE FROM pwa_escalations WHERE site_id = '9999990' AND fail_reasons = ARRAY['test fail'];`
   (or run `scripts/test-fixtures/sitecam-reset.sql`).

- [ ] **Step 3: Push and open the PR (do NOT merge)**

```bash
git push -u origin feat/sitecam-failed-tab
gh pr create --title "feat(sitecam): Failed tab on Appeals page + clickable drop numbers" --body "$(cat <<'EOF'
## Summary
- New **Failed** tab on the SiteCam Appeals page listing 3-strike photo failures from `pwa_escalations` (pending/resolved sub-filter)
- Clicking the drop number expands the card inline showing **all attempt photos** with fail reasons
- Approve / Reject (+ required note) via the existing `escalation-resolve` endpoint (manager+)
- Drop numbers in the appeal tabs are now link-styled click targets
- No schema or PWA changes — the PWA already reports these failures

Spec: docs/superpowers/specs/2026-06-11-sitecam-failed-tab-design.md

## Test plan
- [x] API tests: `tests/api/activate/sitecam-failed.test.ts`
- [x] Component tests: `src/modules/activate/components/__tests__/SiteCamFailedQueue.test.tsx`
- [x] `npm run ci:quick`
- [x] Manual: Failed tab renders, expands, approve/reject flows

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Stop at "PR opened" — wait for review/approval before merging.
