# Works QA Zone Photo ZIP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "download whole zone" button to Works QA that streams every PON's QA photos as one `Zone → PON → Pole` ZIP.

**Architecture:** A new streaming endpoint (`archiver`, no compression, bounded concurrency + bounded append backlog) pipes the ZIP straight to the browser so a ~4.5 GB zone never buffers in RAM. A new pure helper owns the per-pole ZIP layout so it stays identical to the existing per-PON download. The working, tested `pon-zip.ts` is left untouched.

**Tech Stack:** Next.js Pages API route, `archiver` (new), `pg` via `@/lib/db`, Vitest + `node-mocks-http`, React/Tailwind header component.

## Global Constraints

- No `console.log` — use `log` from `@/lib/logger`. No empty catch blocks. 100% type coverage. Files < 300 lines, components < 200 lines. (CLAUDE.md rule 12)
- `apiResponse` helpers for all non-stream responses (`@/lib/apiResponse`).
- Auth gate exactly: `withAuth(withPermission('construction-qa.works-qa.export', 'view')(handler))`.
- npm is canonical — use `npm install`, never `bun install`. Run `npm run ci:quick` before PR.
- All work in worktree `/home/hein/Workspace/FF_Next.js-worksqa-zone-zip` (branch `feat/works-qa-zone-zip`). Never touch the main tree.
- ZIP layout must match `pon-zip.ts` exactly: `{prefix}/{pole_label}/civil/{NN}_{label}.jpg`, `.../optical/{NN}_{label}.jpg`, `.../optical/tray_{NN}.jpg`, `.../unassigned/photo_{NN}.jpg`. For the zone endpoint `prefix = Zone_{zone}/PON_{pon}`.

---

### Task 1: Environment — link node_modules, add `archiver`

**Files:**
- Modify: `package.json` (dependencies + devDependencies)
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `archiver` importable as `import archiver from 'archiver'`; `@types/archiver` for types.

- [ ] **Step 1: Link node_modules into the worktree** (worktree has none after `git worktree add`)

```bash
cd /home/hein/Workspace/FF_Next.js-worksqa-zone-zip && \
  [ -e node_modules ] || ln -s /home/hein/Workspace/FF_Next.js/node_modules node_modules
ls -ld node_modules   # expect: symlink -> .../FF_Next.js/node_modules
```

- [ ] **Step 2: Add the dependency** (additive `npm install <pkg>` — does not prune the shared tree)

```bash
cd /home/hein/Workspace/FF_Next.js-worksqa-zone-zip && \
  npm install archiver@^7.0.1 && npm install --save-dev @types/archiver@^6.0.3
```

- [ ] **Step 3: Verify import resolves and main tree is untouched**

```bash
cd /home/hein/Workspace/FF_Next.js-worksqa-zone-zip && \
  node -e "require('archiver'); console.log('archiver ok')" && \
  git -C /home/hein/Workspace/FF_Next.js status --porcelain package.json package-lock.json
```
Expected: `archiver ok`, and the main-tree `git status` prints nothing (its tracked files unchanged).

- [ ] **Step 4: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-worksqa-zone-zip && \
  git add package.json package-lock.json && \
  git commit -m "build(works-qa): add archiver for streaming zone ZIP"
```

---

### Task 2: `zip-entries.ts` — per-pole ZIP layout helper (TDD)

**Files:**
- Create: `src/modules/works-qa/utils/zip-entries.ts`
- Test: `src/modules/works-qa/utils/__tests__/zip-entries.test.ts`

**Interfaces:**
- Consumes: `SLOT_META` from `../slot-keys`, `PoleQaPhoto` from `../../types/works-qa.types`.
- Produces:
  - `interface ZipEntry { path: string; storageKey: string }`
  - `function slotFilename(stepNumber: number, label: string): string`
  - `function poleToZipEntries(pole: PoleQaPhoto, prefix: string): ZipEntry[]`

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/works-qa/utils/__tests__/zip-entries.test.ts
import { describe, it, expect } from 'vitest';
import { poleToZipEntries, slotFilename } from '../zip-entries';
import type { PoleQaPhoto } from '../../../types/works-qa.types';

const BASE: PoleQaPhoto = {
  id: 'p1', project_id: 'proj-1', pole_label: 'TEST.P.A001', zone_no: 5, pon_no: 999,
  civil_step_01_key: null, civil_step_02_key: null, civil_step_03_key: null, civil_step_04_key: null,
  civil_step_05_key: null, civil_step_06_key: null,
  civil_step_07_key: 'works-qa/proj-1/TEST.P.A001/civil/civil_07_1.jpg', civil_step_08_key: null,
  optical_dome_01_key: null, optical_dome_02_key: null, optical_dome_03_key: null, optical_dome_04_key: null,
  optical_dome_05_key: null, optical_dome_06_key: null, optical_dome_07_key: null, optical_dome_08_key: null,
  main_joint_11_key: null, main_joint_12_key: null, main_joint_13_key: null, main_joint_14_key: null,
  main_joint_15_key: null, main_joint_16_key: null,
  main_joint_tray_keys: [], unassigned_photo_keys: [],
  vlm_results: {}, civil_approved: false, dome_approved: false, joint_approved: false,
  approved_by: null, approved_at: null, override_reason: null, overridden_by: null, overridden_at: null,
  created_at: '', updated_at: '',
};

describe('slotFilename', () => {
  it('zero-pads and slugifies the label', () => {
    expect(slotFilename(7, 'After Photo')).toBe('07_after_photo.jpg');
  });
});

describe('poleToZipEntries', () => {
  it('places a civil photo under {prefix}/{pole}/civil', () => {
    const entries = poleToZipEntries(BASE, 'Zone_5/PON_999');
    expect(entries).toContainEqual({
      path: 'Zone_5/PON_999/TEST.P.A001/civil/07_after_photo.jpg',
      storageKey: 'works-qa/proj-1/TEST.P.A001/civil/civil_07_1.jpg',
    });
  });

  it('places tray + unassigned photos under optical/ and unassigned/', () => {
    const pole = { ...BASE, main_joint_tray_keys: ['k/tray1.jpg'], unassigned_photo_keys: ['k/u1.jpg', 'k/u2.jpg'] };
    const paths = poleToZipEntries(pole, 'Zone_5/PON_999').map(e => e.path);
    expect(paths).toContain('Zone_5/PON_999/TEST.P.A001/optical/tray_01.jpg');
    expect(paths).toContain('Zone_5/PON_999/TEST.P.A001/unassigned/photo_01.jpg');
    expect(paths).toContain('Zone_5/PON_999/TEST.P.A001/unassigned/photo_02.jpg');
  });

  it('emits no unassigned entries when the pole has none', () => {
    const paths = poleToZipEntries(BASE, 'Zone_5/PON_999').map(e => e.path);
    expect(paths.some(p => p.includes('/unassigned/'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/hein/Workspace/FF_Next.js-worksqa-zone-zip && npx vitest run src/modules/works-qa/utils/__tests__/zip-entries.test.ts`
Expected: FAIL — cannot resolve `../zip-entries`.

- [ ] **Step 3: Write the implementation**

```ts
// src/modules/works-qa/utils/zip-entries.ts
import { SLOT_META } from './slot-keys';
import type { PoleQaPhoto } from '../types/works-qa.types';

export interface ZipEntry {
  /** Full path inside the ZIP, e.g. "Zone_5/PON_999/POLE/civil/07_after_photo.jpg". */
  path: string;
  /** Storage key to resolve into an actual photo. */
  storageKey: string;
}

const CIVIL_SLOTS = SLOT_META.filter(s => s.discipline === 'civil');
const OPTICAL_SLOTS = SLOT_META.filter(s => s.discipline === 'dome' || s.discipline === 'main_joint');

/** Slot photo filename, e.g. (7, 'After Photo') -> "07_after_photo.jpg". */
export function slotFilename(stepNumber: number, label: string): string {
  return `${String(stepNumber).padStart(2, '0')}_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.jpg`;
}

/**
 * Map one pole row to its ZIP entries under `prefix`. Layout matches the
 * per-PON download (pon-zip.ts): {prefix}/{pole}/civil|optical|unassigned/...
 * Only photos with a non-null key produce an entry.
 */
export function poleToZipEntries(pole: PoleQaPhoto, prefix: string): ZipEntry[] {
  const base = `${prefix}/${pole.pole_label}`;
  const entries: ZipEntry[] = [];

  for (const slot of CIVIL_SLOTS) {
    const key = pole[slot.dbColumn as keyof PoleQaPhoto] as string | null;
    if (key) entries.push({ path: `${base}/civil/${slotFilename(slot.stepNumber, slot.label)}`, storageKey: key });
  }
  for (const slot of OPTICAL_SLOTS) {
    const key = pole[slot.dbColumn as keyof PoleQaPhoto] as string | null;
    if (key) entries.push({ path: `${base}/optical/${slotFilename(slot.stepNumber, slot.label)}`, storageKey: key });
  }

  const trayKeys = Array.isArray(pole.main_joint_tray_keys) ? pole.main_joint_tray_keys : [];
  trayKeys.forEach((key, i) => {
    if (key) entries.push({ path: `${base}/optical/tray_${String(i + 1).padStart(2, '0')}.jpg`, storageKey: key });
  });

  const unassignedKeys = Array.isArray(pole.unassigned_photo_keys) ? pole.unassigned_photo_keys : [];
  unassignedKeys.forEach((key, i) => {
    if (key) entries.push({ path: `${base}/unassigned/photo_${String(i + 1).padStart(2, '0')}.jpg`, storageKey: key });
  });

  return entries;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/hein/Workspace/FF_Next.js-worksqa-zone-zip && npx vitest run src/modules/works-qa/utils/__tests__/zip-entries.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-worksqa-zone-zip && \
  git add src/modules/works-qa/utils/zip-entries.ts src/modules/works-qa/utils/__tests__/zip-entries.test.ts && \
  git commit -m "feat(works-qa): pure per-pole ZIP layout helper"
```

---

### Task 3: `zone-zip.ts` — streaming endpoint (TDD)

**Files:**
- Create: `pages/api/works-qa/zone-zip.ts`
- Test: `pages/api/works-qa/__tests__/zone-zip.test.ts`

**Interfaces:**
- Consumes: `poleToZipEntries` (Task 2); `pool` from `@/lib/db`; `apiResponse`; `withAuth`/`withPermission`; `log`; `archiver` (Task 1); `PoleQaPhoto`.
- Produces: default-exported Next API handler at `GET /api/works-qa/zone-zip?project_id=&zone_no=[&include_unapproved=true]`.

- [ ] **Step 1: Write the failing test**

```ts
// pages/api/works-qa/__tests__/zone-zip.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { createMocks } from 'node-mocks-http';

const { poolMock } = vi.hoisted(() => ({ poolMock: { query: vi.fn() } }));
vi.mock('@/lib/db', () => ({ __esModule: true, default: poolMock }));
vi.mock('@/lib/auth', () => ({ withAuth: (h: unknown) => h, withPermission: () => (h: unknown) => h }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tinyPng = Buffer.from('89504e470d0a1a0a', 'hex');
const fetchMock = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => tinyPng }));
vi.stubGlobal('fetch', fetchMock);

import handler from '../zone-zip';

const POLE = {
  id: 'p1', project_id: 'proj-1', pole_label: 'TEST.P.A001', zone_no: 5, pon_no: 999,
  civil_step_07_key: 'works-qa/proj-1/TEST.P.A001/civil/civil_07_1.jpg',
  main_joint_tray_keys: [], unassigned_photo_keys: ['works-qa/proj-1/TEST.P.A001/unassigned/u1.jpg'],
} as unknown;

async function drainZip(res: { _getBuffer(): Buffer }) {
  return Object.keys((await JSZip.loadAsync(res._getBuffer())).files);
}

describe('zone-zip', () => {
  beforeEach(() => { poolMock.query.mockReset(); fetchMock.mockClear(); });

  it('streams a Zone_/PON_/pole tree', async () => {
    poolMock.query.mockResolvedValue({ rows: [POLE] });
    const { req, res } = createMocks({ method: 'GET', query: { project_id: 'proj-1', zone_no: '5', include_unapproved: 'true' } });
    // @ts-expect-error node-mocks res is not our exact NextApiResponse
    await handler(req, res);
    const paths = await drainZip(res);
    expect(paths).toContain('Zone_5/PON_999/TEST.P.A001/civil/07_after_photo.jpg');
    expect(paths).toContain('Zone_5/PON_999/TEST.P.A001/unassigned/photo_01.jpg');
  });

  it('skips a missing photo and writes a _manifest.txt instead of aborting', async () => {
    poolMock.query.mockResolvedValue({ rows: [POLE] });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, arrayBuffer: async () => tinyPng }); // first photo 404s
    const { req, res } = createMocks({ method: 'GET', query: { project_id: 'proj-1', zone_no: '5', include_unapproved: 'true' } });
    // @ts-expect-error
    await handler(req, res);
    const paths = await drainZip(res);
    expect(paths).toContain('_manifest.txt');
  });

  it('drops approved_at filter when include_unapproved=true', async () => {
    poolMock.query.mockResolvedValue({ rows: [POLE] });
    const { req, res } = createMocks({ method: 'GET', query: { project_id: 'proj-1', zone_no: '5', include_unapproved: 'true' } });
    // @ts-expect-error
    await handler(req, res);
    expect(poolMock.query.mock.calls[0]![0] as string).not.toMatch(/approved_at IS NOT NULL/);
  });

  it('404s when the zone has no matching poles', async () => {
    poolMock.query.mockResolvedValue({ rows: [] });
    const { req, res } = createMocks({ method: 'GET', query: { project_id: 'proj-1', zone_no: '5' } });
    // @ts-expect-error
    await handler(req, res);
    expect(res._getStatusCode()).toBe(404);
    expect(poolMock.query.mock.calls[0]![0] as string).toMatch(/approved_at IS NOT NULL/);
  });

  it('400s when zone_no is missing', async () => {
    const { req, res } = createMocks({ method: 'GET', query: { project_id: 'proj-1' } });
    // @ts-expect-error
    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/hein/Workspace/FF_Next.js-worksqa-zone-zip && npx vitest run pages/api/works-qa/__tests__/zone-zip.test.ts`
Expected: FAIL — cannot resolve `../zone-zip`.

- [ ] **Step 3: Write the implementation**

```ts
// pages/api/works-qa/zone-zip.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import archiver from 'archiver';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { log } from '@/lib/logger';
import { poleToZipEntries } from '@/modules/works-qa/utils/zip-entries';
import type { PoleQaPhoto } from '@/modules/works-qa/types/works-qa.types';

// Streamed response: disable Next's 4 MB response cap and its
// "resolved without sending a response" warning (we own res).
export const config = { api: { responseLimit: false, externalResolver: true } };

const LOOPBACK_PORT = process.env.PORT ?? '3000';
const LOOPBACK_BASE = `http://127.0.0.1:${LOOPBACK_PORT}`;
const FETCH_CONCURRENCY = 8;   // parallel loopback photo fetches
const MAX_PENDING = 24;        // appended-but-unwritten entries (~24 * ~350KB ≈ 8 MB ceiling)

// Same prefix dispatch as pon-zip.ts / photo-url.ts.
function photoUrl(key: string): string {
  if (key.startsWith('works-qa/')) return `${LOOPBACK_BASE}/storage/${key}`;
  const source = key.startsWith('projects/') ? 'qfield'
              : key.startsWith('sharepoint:') ? 'sharepoint'
              : 'local';
  return `${LOOPBACK_BASE}/api/construction-qa/photo-proxy?key=${encodeURIComponent(key)}&source=${source}&vlm=true`;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  const { project_id, zone_no } = req.query;
  if (!project_id || typeof project_id !== 'string') return apiResponse.badRequest(res, 'project_id required');
  if (!zone_no || typeof zone_no !== 'string') return apiResponse.badRequest(res, 'zone_no required');
  const zoneNum = parseInt(zone_no, 10);
  if (isNaN(zoneNum)) return apiResponse.badRequest(res, 'zone_no must be a number');

  const includeUnapproved = req.query.include_unapproved === 'true';
  const approvedFilter = includeUnapproved ? '' : 'AND approved_at IS NOT NULL';

  let rows: PoleQaPhoto[];
  try {
    const result = await pool.query<PoleQaPhoto>(
      `SELECT * FROM pole_qa_photos
        WHERE project_id = $1::uuid AND zone_no = $2
          ${approvedFilter}
        ORDER BY pon_no ASC, pole_label ASC`,
      [project_id, zoneNum],
    );
    rows = result.rows;
  } catch (err) {
    log.error('zone-zip: query failed', { err, project_id, zone_no });
    return apiResponse.internalError(res, 'Failed to query zone photos');
  }

  if (rows.length === 0) {
    return apiResponse.notFound(res, includeUnapproved ? 'Poles' : 'Approved poles', `${project_id} zone ${zoneNum}`);
  }

  const cookie = req.headers.cookie ?? '';
  const entries = rows.flatMap(pole =>
    poleToZipEntries(pole, `Zone_${zoneNum}/PON_${pole.pon_no ?? 'unknown'}`),
  );

  // --- stream the archive (headers before first byte) ---
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="works-qa-${project_id.slice(0, 8)}-Zone_${zoneNum}.zip"`);
  res.setHeader('X-Accel-Buffering', 'no'); // stop nginx buffering a multi-GB body

  const archive = archiver('zip', { store: true }); // JPEGs are already compressed
  archive.on('warning', err => log.warn('zone-zip: archiver warning', { err: err.message }));
  archive.on('error', err => { log.error('zone-zip: archiver error', { err: err.message }); res.destroy(err); });
  archive.pipe(res);

  // Bound the append backlog so archiver never queues the whole zone in RAM.
  let pending = 0;
  const drainWaiters: Array<() => void> = [];
  archive.on('entry', () => { pending--; drainWaiters.shift()?.(); });
  const waitForDrain = () =>
    pending < MAX_PENDING ? Promise.resolve() : new Promise<void>(r => drainWaiters.push(r));

  // Abort fetching if the client cancels the download.
  let aborted = false;
  res.on('close', () => { if (!res.writableEnded) { aborted = true; archive.abort(); } });

  const skipped: string[] = [];
  let idx = 0;
  async function worker() {
    while (idx < entries.length && !aborted) {
      const entry = entries[idx++];
      try {
        const resp = await fetch(photoUrl(entry.storageKey), { headers: cookie ? { cookie } : {} });
        if (!resp.ok) { skipped.push(entry.storageKey); continue; }
        const buf = Buffer.from(await resp.arrayBuffer());
        await waitForDrain();
        if (aborted) return;
        pending++;
        archive.append(buf, { name: entry.path });
      } catch (err) {
        skipped.push(entry.storageKey);
        log.warn('zone-zip: photo fetch failed', { key: entry.storageKey, err: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, () => worker()));
    if (!aborted && skipped.length > 0) {
      archive.append(`Skipped ${skipped.length} missing photo(s):\n${skipped.join('\n')}\n`, { name: '_manifest.txt' });
    }
    if (!aborted) await archive.finalize();
  } catch (err) {
    log.error('zone-zip: stream failed', { err: err instanceof Error ? err.message : String(err), project_id, zone_no });
    if (!res.writableEnded) res.destroy();
  }
}

export default withAuth(withPermission('construction-qa.works-qa.export', 'view')(handler));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/hein/Workspace/FF_Next.js-worksqa-zone-zip && npx vitest run pages/api/works-qa/__tests__/zone-zip.test.ts`
Expected: PASS (5 tests). If node-mocks-http `res` lacks stream events the pipe still writes; `_getBuffer()` returns the finalized zip.

- [ ] **Step 5: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-worksqa-zone-zip && \
  git add pages/api/works-qa/zone-zip.ts pages/api/works-qa/__tests__/zone-zip.test.ts && \
  git commit -m "feat(works-qa): streaming zone photo ZIP endpoint"
```

---

### Task 4: UI — zone ZIP button in the header

**Files:**
- Modify: `src/modules/works-qa/components/WorksQAPageHeader.tsx` (insert after the `p.ponNo !== null` block, ~line 100)

**Interfaces:**
- Consumes: existing props `projectId`, `zoneNo`, `ponNo`; existing `Download` icon import; endpoint from Task 3.

- [ ] **Step 1: Add the zone-level links** (shown only at zone level: a zone selected, no PON)

```tsx
        {p.zoneNo !== null && p.ponNo === null && (
          <>
            <a
              href={`/api/works-qa/zone-zip?project_id=${encodeURIComponent(p.projectId)}&zone_no=${p.zoneNo}`}
              className="inline-flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs px-3 py-2 rounded-md font-medium transition-colors"
              title="Download all approved poles in this zone as one ZIP (Zone → PON → Pole). Large zones can be several GB — keep this tab open until it finishes."
              aria-label={`Download ZIP of approved poles in zone ${p.zoneNo}`}
            >
              <Download className="h-3.5 w-3.5" />
              Zone ZIP
            </a>
            <a
              href={`/api/works-qa/zone-zip?project_id=${encodeURIComponent(p.projectId)}&zone_no=${p.zoneNo}&include_unapproved=true`}
              className="text-xs text-zinc-400 hover:text-zinc-200 underline underline-offset-2"
              title="Download every pole in this zone (including in-progress) plus unassigned photos"
              aria-label={`Download ZIP of all poles in zone ${p.zoneNo} including in-progress`}
            >
              + in-progress
            </a>
          </>
        )}
```

- [ ] **Step 2: Typecheck the component**

Run: `cd /home/hein/Workspace/FF_Next.js-worksqa-zone-zip && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i worksqapageheader || echo "no header type errors"`
Expected: `no header type errors`.

- [ ] **Step 3: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-worksqa-zone-zip && \
  git add src/modules/works-qa/components/WorksQAPageHeader.tsx && \
  git commit -m "feat(works-qa): zone ZIP download button in header"
```

---

### Task 5: Verify, CI gate, deploy to dev, PR

- [ ] **Step 1: Run the full works-qa test slice**

Run: `cd /home/hein/Workspace/FF_Next.js-worksqa-zone-zip && npx vitest run src/modules/works-qa pages/api/works-qa`
Expected: all pass, including the untouched `pon-zip-unassigned.test.ts`.

- [ ] **Step 2: Lint gate**

Run: `cd /home/hein/Workspace/FF_Next.js-worksqa-zone-zip && npm run ci:quick`
Expected: PASS (no new lint regressions; no `console.log`; files within size limits).

- [ ] **Step 3: Real-data manual verification on dev** (proves the streaming + memory behaviour the tests can't)

Deploy the branch to dev, then against Tonga Zone 1:
```bash
# on Velo, watch the dev service RSS while a zone download runs:
#   watch -n2 'ps -o rss= -p $(pgrep -f fibreflow-dev) | awk "{print \$1/1024 \" MB\"}"'
# trigger download (authenticated) and confirm the tree + size:
curl -s -b "<ff_auth_token cookie>" \
  "https://dev.fibreflow.app/api/works-qa/zone-zip?project_id=ce3bf310-d6ba-4ede-ab36-a8c902a5efc6&zone_no=1" \
  -o /tmp/tonga-zone1.zip
unzip -l /tmp/tonga-zone1.zip | head -20
unzip -l /tmp/tonga-zone1.zip | tail -3   # total size + file count
```
Expected: entries `Zone_1/PON_*/…/civil|optical|unassigned/*.jpg`; total ≈ 4.5 GB; **dev RSS stays flat (no multi-GB spike)** throughout.

- [ ] **Step 4: Push, open PR, run CI on the self-hosted runner**

```bash
cd /home/hein/Workspace/FF_Next.js-worksqa-zone-zip && git push -u origin feat/works-qa-zone-zip
gh pr create --fill --base master --title "feat(works-qa): download whole-zone photo ZIP"
```
Then `/review` (blind reviewer) + `gh run watch <id> --exit-status`. Merge only after both green.

## Self-Review

**Spec coverage:** streaming endpoint (Task 3) ✓; layout helper + drift guard (Task 2) ✓; UI at zone level (Task 4) ✓; `archiver` dep (Task 1) ✓; missing-photo skip + `_manifest.txt` (Task 3 impl + test) ✓; no `pon-zip` change ✓; no index/migration ✓; RSS-flat verification (Task 5) ✓. All spec success criteria mapped.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `poleToZipEntries(pole, prefix)` / `ZipEntry { path, storageKey }` / `slotFilename(stepNumber, label)` used identically in Tasks 2 and 3. `photoUrl` local to Task 3. Endpoint path `/api/works-qa/zone-zip` consistent in Tasks 3 and 4.
