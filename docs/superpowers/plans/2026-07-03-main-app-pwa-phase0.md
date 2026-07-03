# Main App PWA — Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the main FibreFlow app (`/`) an installable, offline-capable PWA and ship a reusable offline-write queue library, proven by one pilot field workflow (snag step-completion).

**Architecture:** Three independent, separately-testable layers — (A) installability (manifest + maskable icons + install prompt), (B) a hand-rolled root service worker (`public/sw-app.js`, scope `/`) that provides an offline shell + runtime read-cache and *early-returns* for the `/my`, field-stock, and fleet sub-scopes so the three existing service workers keep owning their pages, and (C) a generic offline-write queue library (`src/lib/offline-queue/`) generalised from the proven `/my` attendance clock-event queue (page-context flush on reconnect, NOT the flaky SW Background Sync API). A single pilot consumer wires Layer C onto a real field mutation.

**Tech Stack:** Next.js 14 (Pages Router), TypeScript, React, IndexedDB (raw, no wrapper lib), vitest + fake-indexeddb, react-hot-toast, `@/lib/logger`.

**Spec:** `docs/superpowers/specs/2026-07-03-main-app-pwa-phase0-design.md`

## Global Constraints

- **Package manager:** npm only (never bun). Verify with `npm run ci:quick` before any PR.
- **File size:** files < 300 lines, components < 200 lines.
- **Logging:** never `console.log`; use `import { log } from '@/lib/logger'`.
- **Types:** 100% type coverage; no `any` leaking across public interfaces.
- **No empty catch blocks** — every catch logs or handles.
- **The three existing service workers (`sw-my.js`, `sw-stock.js`, `sw-fleet.js`), `manifest-my.json`, and the three existing offline modules MUST remain byte-for-byte untouched.**
- **Offline-write policy (load-bearing, ported verbatim in intent):** conservative draining — keep by default, only drain on an explicit allowlist of unrecoverable reasons; permanently-failed items move to a `dropped` store (never silently deleted); attempts cap + queue-depth cap are safety valves; flush from the page context, not SW Background Sync.
- **TDD:** every task writes the failing test first. Commit at the end of every task.
- **Reuse the shared hook** `useOnlineStatus` from `@/lib/hooks/useOnlineStatus` — do not write a new online-status hook.

---

## File Structure

**New — Layer C (offline-write queue library):**
- `src/lib/offline-queue/types.ts` — shared types (`QueuedItem`, `SubmitResult`, `FlushReport`, `OfflineQueueConfig`, `QueueFullError`).
- `src/lib/offline-queue/store.ts` — generic IndexedDB store (pending + dropped), one DB per `queueName`.
- `src/lib/offline-queue/flush.ts` — pure flush engine + generic error classifier helper.
- `src/lib/offline-queue/useOfflineQueue.ts` — React hook owning the queue lifecycle.
- `src/lib/offline-queue/index.ts` — barrel export.
- `src/lib/offline-queue/__tests__/store.test.ts`, `flush.test.ts`, `useOfflineQueue.test.ts`.

**New — Layer A/B:**
- `src/hooks/useAppServiceWorker.ts` — root SW registration hook (port of `useServiceWorker.ts`).
- `public/sw-app.js` — root service worker.
- `public/icons/icon-192.png`, `icon-512.png`, `icon-192-maskable.png`, `icon-512-maskable.png`.
- `src/components/pwa/InstallPrompt.tsx` — `beforeinstallprompt` UI.
- `src/components/pwa/UpdatePrompt.tsx` — "new version — reload" UI.

**Modified:**
- `public/manifest.json` — proper icons/metadata.
- `pages/_document.tsx` — add `<link rel="manifest">` + PWA meta.
- `pages/_app.tsx` — register root SW, render `InstallPrompt` + `UpdatePrompt`.
- Pilot: `src/modules/noc/snag-resolve/useSnagResolve.ts` — route `complete_step` through the offline queue.

**Untouched (guaranteed):** `sw-my.js`, `sw-stock.js`, `sw-fleet.js`, `manifest-my.json`, `src/modules/attendance/portal/client/offline/*`, `src/modules/field-stock/offline/*`, `src/modules/fleet/offline/*`.

---

## Task 1: Offline-queue types

**Files:**
- Create: `src/lib/offline-queue/types.ts`
- Test: `src/lib/offline-queue/__tests__/types.test.ts`

**Interfaces:**
- Produces: `QueuedItem<TPayload>`, `DroppedItem<TPayload>`, `SubmitResult`, `FlushReport`, `FlushHooks`, `OfflineQueueConfig<TPayload>`, `QueueFullError`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/offline-queue/__tests__/types.test.ts
import { describe, expect, it } from 'vitest';
import { QueueFullError } from '../types';

describe('QueueFullError', () => {
  it('is an Error with a typed name and the size in the message', () => {
    const err = new QueueFullError(50);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('QueueFullError');
    expect(err.message).toContain('50');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/offline-queue/__tests__/types.test.ts`
Expected: FAIL — cannot find module `../types`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/offline-queue/types.ts
/**
 * Generic offline-write queue types. Generalised from the proven /my
 * attendance clock-event queue (src/modules/attendance/portal/client/offline/).
 * The load-bearing policies (conservative draining, dropped-record retention,
 * attempts + depth caps) live in store.ts / flush.ts; this file is the shared
 * vocabulary those modules and every consumer speak.
 */

/** One item awaiting sync. `payload` is the workflow-specific body. */
export interface QueuedItem<TPayload> {
  id: string;
  payload: TPayload;
  queuedAt: string;
  attempts: number;
  lastError?: string;
}

/** A permanently-dropped item, retained on-device for user visibility/dispute. */
export interface DroppedItem<TPayload> extends QueuedItem<TPayload> {
  droppedAt: string;
  dropReason: string;
}

/** Result of trying to submit one item. */
export interface SubmitResult {
  /** True → remove from pending (success OR permanent failure). */
  drain: boolean;
  /** Shown to the user AND persisted on the dropped row when `drain` is true. */
  errorMessage?: string;
}

export interface FlushReport {
  attempted: number;
  drained: number;
  kept: number;
  failures: Array<{ id: string; message: string }>;
}

export interface FlushHooks {
  onDrain: (id: string, reason: string) => Promise<void>;
  onTransient: (id: string, message: string) => Promise<void>;
  onAbandon: (id: string, reason: string) => Promise<void>;
}

/** Per-workflow configuration. One config == one IndexedDB database. */
export interface OfflineQueueConfig<TPayload> {
  /** Unique per workflow — becomes the IndexedDB database name. */
  queueName: string;
  /** Upper bound on pending depth. Default 50. */
  maxQueueSize?: number;
  /** Attempts before an item is abandoned to the dropped store. Default 10. */
  maxAttemptsBeforeDrain?: number;
  /** The network call. Return normally on success; throw on failure. */
  submit: (payload: TPayload) => Promise<void>;
  /** Map a thrown error to drain-vs-keep. Default: keep unless it's a known
   *  permanent failure (see defaultClassify in flush.ts). */
  classify?: (err: unknown, payload: TPayload) => SubmitResult;
}

export class QueueFullError extends Error {
  constructor(size: number) {
    super(`Offline queue is full (${size} items). Reconnect to sync before adding more.`);
    this.name = 'QueueFullError';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/offline-queue/__tests__/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/offline-queue/types.ts src/lib/offline-queue/__tests__/types.test.ts
git commit -m "feat(offline-queue): add generic queue types"
```

---

## Task 2: Generic IndexedDB store

**Files:**
- Create: `src/lib/offline-queue/store.ts`
- Test: `src/lib/offline-queue/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `QueuedItem`, `DroppedItem`, `QueueFullError` from `./types`.
- Produces: class `OfflineQueueStore<TPayload>` with methods `enqueue(item)`, `listPending()`, `countPending()`, `deletePending(id)`, `bumpAttempts(id, lastError)`, `drop(item, reason)`, `listDropped()`, `acknowledgeDropped(id)`, and test helper `__resetForTests()`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/offline-queue/__tests__/store.test.ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfflineQueueStore } from '../store';
import { QueueFullError, type QueuedItem } from '../types';

interface P { note: string }

function item(id: string, attempts = 0): QueuedItem<P> {
  return { id, payload: { note: id }, queuedAt: `2026-07-03T00:00:0${id}Z`, attempts };
}

describe('OfflineQueueStore', () => {
  let store: OfflineQueueStore<P>;

  beforeEach(async () => {
    store = new OfflineQueueStore<P>('TestQueueDB', 3);
    await store.__resetForTests();
    store = new OfflineQueueStore<P>('TestQueueDB', 3);
  });

  it('enqueues and lists pending in queuedAt order', async () => {
    await store.enqueue(item('2'));
    await store.enqueue(item('1'));
    const pending = await store.listPending();
    expect(pending.map((p) => p.id)).toEqual(['1', '2']);
  });

  it('throws QueueFullError at capacity', async () => {
    await store.enqueue(item('1'));
    await store.enqueue(item('2'));
    await store.enqueue(item('3'));
    await expect(store.enqueue(item('4'))).rejects.toBeInstanceOf(QueueFullError);
  });

  it('bumpAttempts increments and records lastError', async () => {
    await store.enqueue(item('1'));
    await store.bumpAttempts('1', 'boom');
    const [row] = await store.listPending();
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('boom');
  });

  it('drop moves an item from pending to dropped', async () => {
    await store.enqueue(item('1'));
    await store.drop(item('1'), 'permanent');
    expect(await store.countPending()).toBe(0);
    const dropped = await store.listDropped();
    expect(dropped[0].dropReason).toBe('permanent');
  });

  it('acknowledgeDropped clears a dropped row', async () => {
    await store.enqueue(item('1'));
    await store.drop(item('1'), 'permanent');
    await store.acknowledgeDropped('1');
    expect(await store.listDropped()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/offline-queue/__tests__/store.test.ts`
Expected: FAIL — cannot find module `../store`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/offline-queue/store.ts
/**
 * Generic IndexedDB queue store: pending + dropped object stores, one database
 * per queueName. A direct generalisation of
 * src/modules/attendance/portal/client/offline/db.ts — same transaction
 * discipline (race-safe attempts bump, drop = write-dropped-then-delete-pending),
 * same safety caps, made generic over the payload type.
 */

import { QueueFullError, type DroppedItem, type QueuedItem } from './types';

const PENDING = 'pending';
const DROPPED = 'dropped';
const DB_VERSION = 1;

export class OfflineQueueStore<TPayload> {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly dbName: string,
    private readonly maxQueueSize = 50
  ) {}

  private openDb(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB unavailable in this environment'));
    }
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PENDING)) {
          db.createObjectStore(PENDING, { keyPath: 'id' }).createIndex('queuedAt', 'queuedAt');
        }
        if (!db.objectStoreNames.contains(DROPPED)) {
          db.createObjectStore(DROPPED, { keyPath: 'id' }).createIndex('droppedAt', 'droppedAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
      req.onblocked = () => reject(new Error('IDB open blocked — another tab holds an older version'));
    });
    return this.dbPromise;
  }

  private tx<T>(
    storeName: string,
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => Promise<T> | T
  ): Promise<T> {
    return this.openDb().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const transaction = db.transaction(storeName, mode);
          const store = transaction.objectStore(storeName);
          let result: T;
          Promise.resolve(fn(store)).then((r) => { result = r; }).catch(reject);
          transaction.oncomplete = () => resolve(result);
          transaction.onerror = () => reject(transaction.error ?? new Error('IDB tx failed'));
          transaction.onabort = () => reject(transaction.error ?? new Error('IDB tx aborted'));
        })
    );
  }

  private req<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
    });
  }

  async enqueue(item: QueuedItem<TPayload>): Promise<void> {
    const count = await this.countPending();
    if (count >= this.maxQueueSize) throw new QueueFullError(count);
    await this.tx(PENDING, 'readwrite', (s) => this.req(s.add(item)));
  }

  async listPending(): Promise<QueuedItem<TPayload>[]> {
    return this.tx(PENDING, 'readonly', async (s) => {
      const rows = await this.req(s.getAll() as IDBRequest<QueuedItem<TPayload>[]>);
      return rows.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
    });
  }

  async countPending(): Promise<number> {
    return this.tx(PENDING, 'readonly', (s) => this.req(s.count()));
  }

  async deletePending(id: string): Promise<void> {
    await this.tx(PENDING, 'readwrite', (s) => this.req(s.delete(id)));
  }

  /** Read-modify-write in one transaction so concurrent flushes can't race. */
  async bumpAttempts(id: string, lastError: string): Promise<void> {
    await this.tx(PENDING, 'readwrite', async (s) => {
      const row = await this.req(s.get(id) as IDBRequest<QueuedItem<TPayload> | undefined>);
      if (!row) return;
      await this.req(s.put({ ...row, attempts: row.attempts + 1, lastError }));
    });
  }

  /** Move pending → dropped. Write dropped first, then delete pending, so
   *  nothing silently vanishes if a step fails. */
  async drop(item: QueuedItem<TPayload>, dropReason: string): Promise<void> {
    const dropped: DroppedItem<TPayload> = {
      ...item,
      droppedAt: new Date().toISOString(),
      dropReason,
    };
    await this.tx(DROPPED, 'readwrite', (s) => this.req(s.put(dropped)));
    await this.deletePending(item.id);
  }

  async listDropped(): Promise<DroppedItem<TPayload>[]> {
    return this.tx(DROPPED, 'readonly', async (s) => {
      const rows = await this.req(s.getAll() as IDBRequest<DroppedItem<TPayload>[]>);
      return rows.sort((a, b) => b.droppedAt.localeCompare(a.droppedAt));
    });
  }

  async acknowledgeDropped(id: string): Promise<void> {
    await this.tx(DROPPED, 'readwrite', (s) => this.req(s.delete(id)));
  }

  /** Test-only: drop and recreate the DB so each test starts clean. */
  async __resetForTests(): Promise<void> {
    if (this.dbPromise) {
      (await this.dbPromise).close();
      this.dbPromise = null;
    }
    if (typeof indexedDB === 'undefined') return;
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(this.dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('delete failed'));
      req.onblocked = () => reject(new Error('IDB delete blocked — close other handles first'));
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/offline-queue/__tests__/store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/offline-queue/store.ts src/lib/offline-queue/__tests__/store.test.ts
git commit -m "feat(offline-queue): add generic IndexedDB store"
```

---

## Task 3: Pure flush engine

**Files:**
- Create: `src/lib/offline-queue/flush.ts`
- Test: `src/lib/offline-queue/__tests__/flush.test.ts`

**Interfaces:**
- Consumes: `QueuedItem`, `SubmitResult`, `FlushReport`, `FlushHooks` from `./types`.
- Produces: `MAX_ATTEMPTS_BEFORE_DRAIN` (const, 10), `flushQueue(items, submit, hooks, maxAttempts?)`, `defaultClassify(err)`. `type SubmitOne<TPayload> = (item: QueuedItem<TPayload>) => Promise<SubmitResult>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/offline-queue/__tests__/flush.test.ts
import { describe, expect, it, vi } from 'vitest';
import { flushQueue, MAX_ATTEMPTS_BEFORE_DRAIN } from '../flush';
import type { QueuedItem, FlushHooks } from '../types';

function item(id: string, attempts = 0): QueuedItem<{ n: string }> {
  return { id, payload: { n: id }, queuedAt: id, attempts };
}
function hooks(): FlushHooks & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    onDrain: async (id) => { calls.push(`drain:${id}`); },
    onTransient: async (id) => { calls.push(`transient:${id}`); },
    onAbandon: async (id) => { calls.push(`abandon:${id}`); },
  };
}

describe('flushQueue', () => {
  it('drains a successful item', async () => {
    const h = hooks();
    const report = await flushQueue([item('1')], async () => ({ drain: true }), h);
    expect(report.drained).toBe(1);
    expect(h.calls).toEqual(['drain:1']);
  });

  it('keeps a transient failure and early-exits the rest', async () => {
    const h = hooks();
    const submit = vi.fn(async () => ({ drain: false, errorMessage: '5xx' }));
    const report = await flushQueue([item('1'), item('2')], submit, h);
    expect(report.kept).toBe(1);
    expect(submit).toHaveBeenCalledTimes(1); // early exit — item 2 not attempted
    expect(h.calls).toEqual(['transient:1']);
  });

  it('abandons an item past the attempts cap without calling submit', async () => {
    const h = hooks();
    const submit = vi.fn(async () => ({ drain: true }));
    const report = await flushQueue([item('1', MAX_ATTEMPTS_BEFORE_DRAIN)], submit, h);
    expect(submit).not.toHaveBeenCalled();
    expect(h.calls).toEqual(['abandon:1']);
    expect(report.drained).toBe(1);
  });

  it('treats a thrown error as transient (keep)', async () => {
    const h = hooks();
    const report = await flushQueue([item('1')], async () => { throw new Error('net'); }, h);
    expect(report.kept).toBe(1);
    expect(h.calls).toEqual(['transient:1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/offline-queue/__tests__/flush.test.ts`
Expected: FAIL — cannot find module `../flush`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/offline-queue/flush.ts
/**
 * Pure flush engine for the generic offline queue. Generalised from
 * src/modules/attendance/portal/client/offline/sync.ts.
 *
 * Policy is CONSERVATIVE: keep by default, drain only on an explicit
 * permanent-failure signal from the consumer's classify(). An item that keeps
 * failing transiently is abandoned to the dropped store after the attempts cap
 * — so a corrupt row can't wedge the queue forever, and a new/unknown server
 * error can't silently delete a field submission.
 */

import type { FlushHooks, FlushReport, QueuedItem, SubmitResult } from './types';

export const MAX_ATTEMPTS_BEFORE_DRAIN = 10;

export type SubmitOne<TPayload> = (item: QueuedItem<TPayload>) => Promise<SubmitResult>;

export async function flushQueue<TPayload>(
  items: QueuedItem<TPayload>[],
  submit: SubmitOne<TPayload>,
  hooks: FlushHooks,
  maxAttempts: number = MAX_ATTEMPTS_BEFORE_DRAIN
): Promise<FlushReport> {
  const report: FlushReport = { attempted: 0, drained: 0, kept: 0, failures: [] };

  for (const item of items) {
    report.attempted++;

    if (item.attempts >= maxAttempts) {
      const reason = `Abandoned after ${item.attempts} failed attempts. Last error: ${
        item.lastError ?? 'unknown'
      }`;
      await hooks.onAbandon(item.id, reason);
      report.drained++;
      report.failures.push({ id: item.id, message: reason });
      continue;
    }

    try {
      const result = await submit(item);
      if (result.drain) {
        await hooks.onDrain(item.id, result.errorMessage ?? 'Dropped by server response');
        report.drained++;
        if (result.errorMessage) report.failures.push({ id: item.id, message: result.errorMessage });
      } else {
        const message = result.errorMessage ?? 'Transient failure';
        await hooks.onTransient(item.id, message);
        report.kept++;
        report.failures.push({ id: item.id, message });
        break; // don't burn the rest of the queue against a broken backend
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await hooks.onTransient(item.id, message);
      report.kept++;
      report.failures.push({ id: item.id, message });
      break;
    }
  }

  return report;
}

/**
 * Default classifier used when a consumer config omits `classify`. Conservative:
 * only an explicit HTTP status carried on the error drains; everything else is
 * kept and retried. Consumers with richer server-reason codes pass their own.
 */
export function defaultClassify(err: unknown): SubmitResult {
  const status = (err as { status?: number } | undefined)?.status;
  // 400/409 are the only "user can't fix by retrying" defaults; keep the rest.
  if (status === 400 || status === 409) {
    return { drain: true, errorMessage: (err as Error)?.message || `Rejected (${status}).` };
  }
  return { drain: false, errorMessage: err instanceof Error ? err.message : 'Will retry.' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/offline-queue/__tests__/flush.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/offline-queue/flush.ts src/lib/offline-queue/__tests__/flush.test.ts
git commit -m "feat(offline-queue): add pure flush engine + default classifier"
```

---

## Task 4: useOfflineQueue hook

**Files:**
- Create: `src/lib/offline-queue/useOfflineQueue.ts`
- Test: `src/lib/offline-queue/__tests__/useOfflineQueue.test.ts`

**Interfaces:**
- Consumes: `OfflineQueueStore` (Task 2), `flushQueue`/`defaultClassify` (Task 3), `OfflineQueueConfig`/`QueuedItem`/`DroppedItem`/`FlushReport` (Task 1), `useOnlineStatus` from `@/lib/hooks/useOnlineStatus`.
- Produces: `useOfflineQueue<TPayload>(config): UseOfflineQueueResult<TPayload>` where the result exposes `enqueue(payload)`, `pendingCount`, `syncing`, `online`, `queueUnavailable`, `dropped`, `lastReport`, `syncNow()`, `acknowledgeDropped(id)`, `refresh()`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/offline-queue/__tests__/useOfflineQueue.test.ts
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOfflineQueue } from '../useOfflineQueue';

// Force the "online" branch deterministically.
vi.mock('@/lib/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

interface P { note: string }

describe('useOfflineQueue', () => {
  beforeEach(() => {
    // Fresh DB name per test via a counter so runs don't bleed into each other.
    (globalThis as { __q?: number }).__q = ((globalThis as { __q?: number }).__q ?? 0) + 1;
  });

  it('enqueues then flushes successfully on sync', async () => {
    const submit = vi.fn(async (_p: P) => {});
    const { result } = renderHook(() =>
      useOfflineQueue<P>({ queueName: `Q${(globalThis as { __q?: number }).__q}`, submit })
    );

    await act(async () => { await result.current.enqueue({ note: 'a' }); });
    await waitFor(() => expect(result.current.pendingCount).toBe(1));

    await act(async () => { await result.current.syncNow(); });
    await waitFor(() => expect(result.current.pendingCount).toBe(0));
    expect(submit).toHaveBeenCalledWith({ note: 'a' });
  });

  it('keeps the item when submit throws a transient error', async () => {
    const submit = vi.fn(async (_p: P) => { throw new Error('network'); });
    const { result } = renderHook(() =>
      useOfflineQueue<P>({ queueName: `Q${(globalThis as { __q?: number }).__q}`, submit })
    );
    await act(async () => { await result.current.enqueue({ note: 'b' }); });
    await act(async () => { await result.current.syncNow(); });
    await waitFor(() => expect(result.current.pendingCount).toBe(1));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/offline-queue/__tests__/useOfflineQueue.test.ts`
Expected: FAIL — cannot find module `../useOfflineQueue`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/offline-queue/useOfflineQueue.ts
/**
 * React hook owning the offline-queue lifecycle for one workflow. Generalised
 * from src/modules/attendance/portal/client/offline/useAttendanceSync.ts.
 *
 * Flush triggers: transition to online, mount-while-online, manual syncNow(),
 * and a 60s poll whenever there is work AND we are online (covers the case
 * where the browser never fires an `online` edge after a brief signal blip).
 * Deliberately page-context driven — NOT the SW Background Sync API.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { log } from '@/lib/logger';
import { useOnlineStatus } from '@/lib/hooks/useOnlineStatus';
import { OfflineQueueStore } from './store';
import { defaultClassify, flushQueue } from './flush';
import type {
  DroppedItem,
  FlushReport,
  OfflineQueueConfig,
  QueuedItem,
} from './types';

const POLL_INTERVAL_MS = 60_000;

export interface UseOfflineQueueResult<TPayload> {
  online: boolean;
  pendingCount: number;
  syncing: boolean;
  queueUnavailable: boolean;
  dropped: DroppedItem<TPayload>[];
  lastReport: FlushReport | null;
  enqueue: (payload: TPayload) => Promise<void>;
  syncNow: () => Promise<void>;
  acknowledgeDropped: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useOfflineQueue<TPayload>(
  config: OfflineQueueConfig<TPayload>
): UseOfflineQueueResult<TPayload> {
  const online = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [queueUnavailable, setQueueUnavailable] = useState(false);
  const [dropped, setDropped] = useState<DroppedItem<TPayload>[]>([]);
  const [lastReport, setLastReport] = useState<FlushReport | null>(null);
  const inFlight = useRef(false);
  const pendingReflush = useRef(false);

  const store = useMemo(
    () => new OfflineQueueStore<TPayload>(config.queueName, config.maxQueueSize ?? 50),
    [config.queueName, config.maxQueueSize]
  );
  const classify = config.classify ?? ((err: unknown) => defaultClassify(err));
  const maxAttempts = config.maxAttemptsBeforeDrain;

  const refresh = useCallback(async () => {
    try {
      const [count, droppedRows] = await Promise.all([store.countPending(), store.listDropped()]);
      setPendingCount(count);
      setDropped(droppedRows);
      setQueueUnavailable(false);
    } catch (err) {
      // IDB genuinely unreachable (private mode / quota / Safari lockdown).
      // Surface it so the UI can warn — never let it look like "empty queue".
      log.error('[offline-queue] refresh failed', { queue: config.queueName, err });
      setPendingCount(0);
      setQueueUnavailable(true);
    }
  }, [store, config.queueName]);

  const enqueue = useCallback(
    async (payload: TPayload) => {
      const item: QueuedItem<TPayload> = {
        id: newId(),
        payload,
        queuedAt: new Date().toISOString(),
        attempts: 0,
      };
      await store.enqueue(item);
      await refresh();
    },
    [store, refresh]
  );

  const syncNow = useCallback(async () => {
    if (inFlight.current) {
      pendingReflush.current = true;
      return;
    }
    inFlight.current = true;
    setSyncing(true);
    try {
      do {
        pendingReflush.current = false;
        const items = await store.listPending();
        if (items.length === 0) {
          setLastReport({ attempted: 0, drained: 0, kept: 0, failures: [] });
          break;
        }
        const report = await flushQueue(
          items,
          async (item) => {
            try {
              await config.submit(item.payload);
              return { drain: true };
            } catch (err) {
              return classify(err, item.payload);
            }
          },
          {
            onDrain: (id, reason) => {
              const it = items.find((i) => i.id === id);
              return it ? store.drop(it, reason) : store.deletePending(id);
            },
            onTransient: (id, message) => store.bumpAttempts(id, message),
            onAbandon: (id, reason) => {
              const it = items.find((i) => i.id === id);
              return it ? store.drop(it, reason) : store.deletePending(id);
            },
          },
          maxAttempts
        );
        setLastReport(report);
      } while (pendingReflush.current);
    } catch (err) {
      log.error('[offline-queue] sync failed', { queue: config.queueName, err });
      setQueueUnavailable(true);
    } finally {
      await refresh();
      setSyncing(false);
      inFlight.current = false;
    }
    // config.submit/classify are stable per render for typical callers; the
    // queueName-keyed store memo bounds re-creation.
  }, [store, refresh, config, classify, maxAttempts]);

  const acknowledgeDropped = useCallback(
    async (id: string) => {
      await store.acknowledgeDropped(id);
      await refresh();
    },
    [store, refresh]
  );

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (online) void syncNow(); }, [online, syncNow]);
  useEffect(() => {
    if (!online || pendingCount === 0) return;
    const id = window.setInterval(() => { void syncNow(); }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [online, pendingCount, syncNow]);

  return {
    online,
    pendingCount,
    syncing,
    queueUnavailable,
    dropped,
    lastReport,
    enqueue,
    syncNow,
    acknowledgeDropped,
    refresh,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/offline-queue/__tests__/useOfflineQueue.test.ts`
Expected: PASS (2 tests). If `@testing-library/react`'s `renderHook` is unavailable, confirm it is a devDependency (`grep '@testing-library/react' package.json`) — it is used elsewhere in the repo; do not add it if already present.

- [ ] **Step 5: Commit**

```bash
git add src/lib/offline-queue/useOfflineQueue.ts src/lib/offline-queue/__tests__/useOfflineQueue.test.ts
git commit -m "feat(offline-queue): add useOfflineQueue lifecycle hook"
```

---

## Task 5: Barrel export

**Files:**
- Create: `src/lib/offline-queue/index.ts`

**Interfaces:**
- Produces: re-exports of the public surface from types/store/flush/useOfflineQueue.

- [ ] **Step 1: Write the barrel**

```ts
// src/lib/offline-queue/index.ts
export { OfflineQueueStore } from './store';
export { flushQueue, defaultClassify, MAX_ATTEMPTS_BEFORE_DRAIN } from './flush';
export { useOfflineQueue } from './useOfflineQueue';
export type { UseOfflineQueueResult } from './useOfflineQueue';
export type { SubmitOne } from './flush';
export {
  QueueFullError,
} from './types';
export type {
  QueuedItem,
  DroppedItem,
  SubmitResult,
  FlushReport,
  FlushHooks,
  OfflineQueueConfig,
} from './types';
```

- [ ] **Step 2: Verify it type-checks and re-exports resolve**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "offline-queue" || echo "no offline-queue type errors"`
Expected: `no offline-queue type errors`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/offline-queue/index.ts
git commit -m "feat(offline-queue): add barrel export"
```

---

## Task 6: Root service-worker registration hook

**Files:**
- Create: `src/hooks/useAppServiceWorker.ts`

**Interfaces:**
- Produces: `useAppServiceWorker(): { isSupported, isRegistered, updateAvailable, updateServiceWorker }`. Registers `/sw-app.js` at scope `/`. Port of `src/modules/attendance/portal/client/useServiceWorker.ts`, with the `/sw-app.js` path and `/` scope.

- [ ] **Step 1: Write the hook** (no unit test — this is a thin DOM-registration wrapper verified via the integration/regression check in Task 14; it mirrors the already-tested `useMyServiceWorker`)

```ts
// src/hooks/useAppServiceWorker.ts
/**
 * Root service-worker registration for the main app. Mirrors
 * src/modules/attendance/portal/client/useServiceWorker.ts, but registers
 * /sw-app.js at scope '/'. Exposes updateAvailable so the app can render a
 * "new version — reload" prompt. Registration is a no-op during SSR and where
 * Service Workers are unsupported.
 */

import { useCallback, useEffect, useState } from 'react';

import { log } from '@/lib/logger';

interface State {
  isSupported: boolean;
  isRegistered: boolean;
  registration: ServiceWorkerRegistration | null;
  updateAvailable: boolean;
  error: string | null;
}

export function useAppServiceWorker() {
  const [state, setState] = useState<State>({
    isSupported: false,
    isRegistered: false,
    registration: null,
    updateAvailable: false,
    error: null,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isSupported = 'serviceWorker' in navigator;
    setState((prev) => ({ ...prev, isSupported }));
    if (!isSupported) {
      log.info('[SW-app] Service Workers not supported');
      return;
    }

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw-app.js', { scope: '/' });
        log.info('[SW-app] registered', { scope: registration.scope });
        setState((prev) => ({ ...prev, isRegistered: true, registration }));
        registration.addEventListener('updatefound', () => {
          const nw = registration.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              log.info('[SW-app] new version available');
              setState((prev) => ({ ...prev, updateAvailable: true }));
            }
          });
        });
      } catch (error) {
        log.error('[SW-app] registration failed', { error });
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Registration failed',
        }));
      }
    };
    void register();
  }, []);

  const updateServiceWorker = useCallback(() => {
    if (state.registration?.waiting) {
      state.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    }
  }, [state.registration]);

  return { ...state, updateServiceWorker };
}
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "useAppServiceWorker" || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAppServiceWorker.ts
git commit -m "feat(pwa): add root service-worker registration hook"
```

---

## Task 7: Root service worker (`public/sw-app.js`)

**Files:**
- Create: `public/sw-app.js`

**Interfaces:**
- Produces: a service worker scoped to `/` that (a) precaches the shell + `/offline.html`, (b) serves navigations network-first → cache → `/offline.html`, (c) cache-first for `/_next/static` + images, (d) **early-returns for `/my`, field-stock (`/stock`, `/field-stock`), and fleet (`/fleet`) sub-scopes**, and (e) handles `SKIP_WAITING`.

> **Scope arbitration is the load-bearing safety property.** The browser routes each page to its most-specific SW registration, so `/my` is already controlled by `sw-my.js`. The early-return is defence-in-depth so that even if `sw-app.js` sees a sub-scope request, it never caches or rewrites it.

- [ ] **Step 1: Write the offline-fallback assertion test** (JSDOM can't run a SW; assert the reserved-scope guard as a pure function extracted for testability)

Create `public/sw-app.js` with the guard also exported for test via a tiny sibling module:

```js
// public/sw-app.js
/**
 * Root service worker for the main FibreFlow app (scope '/').
 *
 * Provides: installable offline shell + runtime read-cache (stale-while-
 * revalidate for navigations, cache-first for static assets). Deliberately
 * NEVER touches the sub-scopes that already own a service worker
 * (/my → sw-my.js, field-stock → sw-stock.js, fleet → sw-fleet.js) nor any
 * non-GET request (mutations go to the network or the app's offline queue).
 */

const SHELL_CACHE = 'app-shell-v1';
const RUNTIME_CACHE = 'app-runtime-v1';

const SHELL_ASSETS = ['/offline.html', '/manifest.json'];

// Requests under these prefixes belong to another SW or must never be cached.
const RESERVED_PREFIXES = ['/my', '/stock', '/field-stock', '/fleet'];
const RESERVED_ASSETS = ['/sw-my.js', '/sw-stock.js', '/sw-fleet.js', '/manifest-my.json'];

function isReserved(pathname) {
  if (RESERVED_ASSETS.includes(pathname)) return true;
  return RESERVED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => (n.startsWith('app-shell-') || n.startsWith('app-runtime-')) &&
            n !== SHELL_CACHE && n !== RUNTIME_CACHE)
          .map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never intercept mutations

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin
  if (isReserved(url.pathname)) return; // hands off — another SW owns this

  // Navigations: network-first, fall back to cache, then the offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/offline.html')))
    );
    return;
  }

  // Static build assets + images: cache-first with background refresh.
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|ico|webp|woff|woff2)$/)
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(RUNTIME_CACHE).then((c) => c.put(request, clone));
            }
            return response;
          })
      )
    );
  }
  // Everything else (incl. /api/*): pass through to the network untouched.
  // A GET-API read-cache allowlist is deliberately empty in Phase 0.
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
```

Create the extracted guard + its test so the reserved-scope logic is unit-covered:

```js
// public/sw-app-guard.js  (CommonJS, imported only by the test)
function isReserved(pathname) {
  const RESERVED_PREFIXES = ['/my', '/stock', '/field-stock', '/fleet'];
  const RESERVED_ASSETS = ['/sw-my.js', '/sw-stock.js', '/sw-fleet.js', '/manifest-my.json'];
  if (RESERVED_ASSETS.includes(pathname)) return true;
  return RESERVED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}
module.exports = { isReserved };
```

> Keep `isReserved` identical in both files. If this duplication is objectionable at review, the guard file can be the source of truth and `sw-app.js` can inline a copy with a `// keep in sync with sw-app-guard.js` comment — SWs cannot `import` from `src/`.

```js
// src/lib/offline-queue/__tests__/sw-app-guard.test.ts
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isReserved } = require('../../../../public/sw-app-guard.js');

describe('sw-app isReserved (scope arbitration)', () => {
  it.each(['/my', '/my/attendance', '/stock/portal', '/field-stock/x', '/fleet/check-in', '/sw-my.js', '/manifest-my.json'])(
    'reserves %s for the owning SW', (p) => expect(isReserved(p)).toBe(true)
  );
  it.each(['/', '/projects', '/works-qa/poles', '/snag/resolve/abc', '/manifest.json', '/api/foo'])(
    'does NOT reserve %s', (p) => expect(isReserved(p)).toBe(false)
  );
});
```

- [ ] **Step 2: Run the guard test to verify it fails**

Run: `npx vitest run src/lib/offline-queue/__tests__/sw-app-guard.test.ts`
Expected: FAIL — cannot find `public/sw-app-guard.js`.

- [ ] **Step 3: Create both files** (as written in Step 1).

- [ ] **Step 4: Run the guard test to verify it passes**

Run: `npx vitest run src/lib/offline-queue/__tests__/sw-app-guard.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add public/sw-app.js public/sw-app-guard.js src/lib/offline-queue/__tests__/sw-app-guard.test.ts
git commit -m "feat(pwa): add root service worker with scope arbitration"
```

---

## Task 8: Maskable PWA icons

**Files:**
- Create: `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/icon-192-maskable.png`, `public/icons/icon-512-maskable.png`

**Interfaces:**
- Produces: four PNG icons referenced by `manifest.json` in Task 9.

- [ ] **Step 1: Confirm a source logo exists**

Run: `ls -la public/favicon.svg public/icon.png public/apple-touch-icon.png`
Expected: at least `favicon.svg` (vector, best source) present.

- [ ] **Step 2: Generate the icons from the SVG**

If `rsvg-convert` or ImageMagick `convert` is available, render `any` icons at 192/512, and `maskable` icons with ~20% safe-area padding on the brand background (`#5B8DEF` per current manifest theme). Example with ImageMagick:

```bash
mkdir -p public/icons
# 'any' purpose — full-bleed
convert -background none -resize 192x192 public/favicon.svg public/icons/icon-192.png
convert -background none -resize 512x512 public/favicon.svg public/icons/icon-512.png
# 'maskable' purpose — logo centred in an 80% safe area on the theme colour
convert -background '#5B8DEF' -resize 154x154 public/favicon.svg -gravity center -extent 192x192 public/icons/icon-192-maskable.png
convert -background '#5B8DEF' -resize 410x410 public/favicon.svg -gravity center -extent 512x512 public/icons/icon-512-maskable.png
```

If no SVG rasteriser is installed, STOP and ask the human to supply the four PNGs (do not ship a stretched favicon as a 512 icon — Android installers reject low-res icons and the install prompt won't appear).

- [ ] **Step 3: Verify dimensions**

Run: `file public/icons/*.png`
Expected: reports `192 x 192` and `512 x 512` PNGs.

- [ ] **Step 4: Commit**

```bash
git add public/icons/
git commit -m "feat(pwa): add 192/512 any+maskable app icons"
```

---

## Task 9: Rewrite the app manifest

**Files:**
- Modify: `public/manifest.json`

**Interfaces:**
- Produces: a manifest referencing the Task 8 icons with `any` + `maskable` purposes.

- [ ] **Step 1: Replace `public/manifest.json` with**

```json
{
  "name": "FibreFlow",
  "short_name": "FibreFlow",
  "description": "Fiber Network Project Management System powered by Velocity Fibre",
  "theme_color": "#5B8DEF",
  "background_color": "#1a1d23",
  "display": "standalone",
  "orientation": "portrait",
  "scope": "/",
  "start_url": "/",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-192-maskable.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "categories": ["business", "productivity"]
}
```

> `screenshots`/`shortcuts` from the old manifest are dropped (the screenshot file may not exist; the shortcut is stale). Re-add deliberately later if wanted — not a Phase 0 requirement.

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('public/manifest.json','utf8')); console.log('valid')"`
Expected: `valid`.

- [ ] **Step 3: Commit**

```bash
git add public/manifest.json
git commit -m "feat(pwa): rewrite app manifest with proper maskable icons"
```

---

## Task 10: Wire manifest + PWA meta into `_document.tsx`

**Files:**
- Modify: `pages/_document.tsx` (the `<Head>` block, currently lines ~59-76)

**Interfaces:**
- Consumes: `public/manifest.json` (Task 9), icons (Task 8).
- Produces: a `<link rel="manifest">` + theme-color + apple PWA meta in the document head.

- [ ] **Step 1: Add the PWA head tags** — inside `<Head>`, immediately after the existing `apple-touch-icon` link (`<link rel="apple-touch-icon" href="/icon.png" />`), insert:

```tsx
        {/* PWA: manifest + install metadata */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#5B8DEF" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="FibreFlow" />
        <link rel="apple-touch-icon" sizes="192x192" href="/icons/icon-192.png" />
```

- [ ] **Step 2: Build to confirm the document compiles**

Run: `npm run build 2>&1 | tail -20`
Expected: build succeeds (no errors referencing `_document`).

- [ ] **Step 3: Commit**

```bash
git add pages/_document.tsx
git commit -m "feat(pwa): link manifest + apple PWA meta in document head"
```

---

## Task 11: InstallPrompt + UpdatePrompt components

**Files:**
- Create: `src/components/pwa/InstallPrompt.tsx`
- Create: `src/components/pwa/UpdatePrompt.tsx`
- Test: `src/components/pwa/__tests__/InstallPrompt.test.tsx`

**Interfaces:**
- Consumes: `useAppServiceWorker` (Task 6) — `UpdatePrompt` reads `updateAvailable` + `updateServiceWorker`.
- Produces: `<InstallPrompt />` (self-contained, listens for `beforeinstallprompt`, `localStorage` dismiss flag) and `<UpdatePrompt />` (banner shown when a new SW is waiting).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/pwa/__tests__/InstallPrompt.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { InstallPrompt } from '../InstallPrompt';

function fireBeforeInstall() {
  const e = new Event('beforeinstallprompt') as Event & { prompt?: () => Promise<void>; userChoice?: Promise<{ outcome: string }> };
  e.prompt = async () => {};
  e.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(e);
}

describe('InstallPrompt', () => {
  beforeEach(() => localStorage.clear());

  it('is hidden until beforeinstallprompt fires', () => {
    render(<InstallPrompt />);
    expect(screen.queryByText(/install fibreflow/i)).toBeNull();
  });

  it('shows after beforeinstallprompt and hides after dismiss (persisted)', () => {
    render(<InstallPrompt />);
    fireBeforeInstall();
    expect(screen.getByText(/install fibreflow/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /not now/i }));
    expect(screen.queryByText(/install fibreflow/i)).toBeNull();
    expect(localStorage.getItem('ff-install-dismissed')).toBe('1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/pwa/__tests__/InstallPrompt.test.tsx`
Expected: FAIL — cannot find module `../InstallPrompt`.

- [ ] **Step 3: Write the components**

```tsx
// src/components/pwa/InstallPrompt.tsx
/**
 * Dismissible "Install FibreFlow" affordance. Captures the browser's
 * beforeinstallprompt event, offers a native install, and remembers a
 * dismissal in localStorage so we don't nag. Renders nothing until the event
 * fires (so it never shows on desktop browsers that don't offer install, or
 * when already installed).
 */

import { useEffect, useState } from 'react';

import { log } from '@/lib/logger';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'ff-install-dismissed';

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!deferred) return null;

  const install = async () => {
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      log.info('[pwa] install prompt outcome', { outcome });
    } catch (err) {
      log.error('[pwa] install prompt failed', { err });
    } finally {
      setDeferred(null);
    }
  };

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDeferred(null);
  };

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-gray-700 bg-[#1e2128] px-4 py-3 text-sm text-gray-100 shadow-lg">
      <span>Install FibreFlow for a faster, offline-ready experience.</span>
      <button onClick={install} className="rounded bg-[#5B8DEF] px-3 py-1 font-medium text-white">
        Install
      </button>
      <button onClick={dismiss} className="px-2 py-1 text-gray-400">
        Not now
      </button>
    </div>
  );
}
```

```tsx
// src/components/pwa/UpdatePrompt.tsx
/**
 * Shown when the root service worker has a new version waiting. Tapping
 * "Reload" activates the waiting worker and reloads. Rendered app-wide from
 * _app.tsx. Uses the root SW registration hook.
 */

import { useAppServiceWorker } from '@/hooks/useAppServiceWorker';

export function UpdatePrompt() {
  const { updateAvailable, updateServiceWorker } = useAppServiceWorker();
  if (!updateAvailable) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-gray-700 bg-[#1e2128] px-4 py-3 text-sm text-gray-100 shadow-lg">
      <span>A new version of FibreFlow is available.</span>
      <button onClick={updateServiceWorker} className="rounded bg-[#5B8DEF] px-3 py-1 font-medium text-white">
        Reload
      </button>
    </div>
  );
}
```

> **Note:** `UpdatePrompt` calls `useAppServiceWorker`, which performs the SW registration. To avoid double-registration, `_app.tsx` renders `UpdatePrompt` (Task 12) and does NOT also call `useAppServiceWorker` directly. Single registration site.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/pwa/__tests__/InstallPrompt.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/pwa/
git commit -m "feat(pwa): add InstallPrompt and UpdatePrompt components"
```

---

## Task 12: Register root SW + render prompts in `_app.tsx`

**Files:**
- Modify: `pages/_app.tsx`

**Interfaces:**
- Consumes: `InstallPrompt`, `UpdatePrompt` (Task 11). `UpdatePrompt` is the single registration site for the root SW (via `useAppServiceWorker`).
- Produces: the root SW registered on every main-app page; install + update affordances rendered app-wide.

- [ ] **Step 1: Add imports** near the other component imports in `pages/_app.tsx`:

```tsx
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { UpdatePrompt } from '@/components/pwa/UpdatePrompt';
```

- [ ] **Step 2: Render the prompts** — inside the top-level `<ErrorBoundary>`, immediately after `<VersionChecker />`:

```tsx
      <VersionChecker />
      <InstallPrompt />
      <UpdatePrompt />
```

- [ ] **Step 3: Build to confirm the app compiles**

Run: `npm run build 2>&1 | tail -20`
Expected: build succeeds.

- [ ] **Step 4: Manual offline smoke** (documented, run by the executor)

Run: `PORT=3004 npm run dev`, open `http://localhost:3004` in Chrome, DevTools → Application → Service Workers shows `sw-app.js` activated; Application → Manifest shows FibreFlow installable with the 512 icon; toggle Network → Offline, reload a visited page → it renders; navigate to an unvisited route → `/offline.html` shows.

- [ ] **Step 5: Commit**

```bash
git add pages/_app.tsx
git commit -m "feat(pwa): register root SW and render install/update prompts app-wide"
```

---

## Task 13: Pilot — route snag `complete_step` through the offline queue

**Files:**
- Modify: `src/modules/noc/snag-resolve/useSnagResolve.ts`
- Test: `src/modules/noc/snag-resolve/__tests__/offlineComplete.test.ts`

**Interfaces:**
- Consumes: `useOfflineQueue` (Task 4).
- Produces: `complete_step` submissions that, when offline or on network error, enqueue and sync on reconnect; a `pendingSteps` count the page can render.

> **Scope note (flagged for the human at plan review):** Phase 0 makes the JSON `complete_step` action offline-capable. Offline **photo upload** (the FormData `upload_photo` action) stays online-only in Phase 0 — offline large-blob capture is explicitly deferred by the spec (§2 Non-Goals, §3.3). If the human wants the photo path offline in the pilot, that becomes an added task here.

**Payload type** (add to `src/modules/noc/snag-resolve/types.ts`):

```ts
export interface QueuedCompleteStep {
  token: string;
  stepId: string;
  actorId?: string;
}
```

- [ ] **Step 1: Write the failing test** (unit-test the submit function, extracted pure)

Create `src/modules/noc/snag-resolve/offlineComplete.ts`:

```ts
// src/modules/noc/snag-resolve/offlineComplete.ts
/**
 * Network call for a queued 'complete_step' action, shaped for useOfflineQueue.
 * Throws with a `.status` on HTTP failure so the queue's default classifier
 * can decide drain-vs-keep (4xx like 400/409 drain; 5xx/network keep).
 */

import type { QueuedCompleteStep } from './types';

export async function submitCompleteStep(payload: QueuedCompleteStep): Promise<void> {
  const res = await fetch(`/api/snags/shared/${payload.token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'complete_step', stepId: payload.stepId, actorId: payload.actorId }),
  });
  if (!res.ok) {
    const err = new Error(`complete_step failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
}
```

```ts
// src/modules/noc/snag-resolve/__tests__/offlineComplete.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitCompleteStep } from '../offlineComplete';

afterEach(() => vi.restoreAllMocks());

describe('submitCompleteStep', () => {
  it('POSTs the complete_step action to the shared token endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await submitCompleteStep({ token: 'tok', stepId: 's1', actorId: 'a1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/snags/shared/tok', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ action: 'complete_step', stepId: 's1', actorId: 'a1' });
  });

  it('throws with a numeric .status on HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 409 })));
    await expect(submitCompleteStep({ token: 'tok', stepId: 's1' })).rejects.toMatchObject({ status: 409 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/noc/snag-resolve/__tests__/offlineComplete.test.ts`
Expected: FAIL — cannot find module `../offlineComplete`.

- [ ] **Step 3: Create `offlineComplete.ts` + the `QueuedCompleteStep` type** (as in Step 1).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/noc/snag-resolve/__tests__/offlineComplete.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the queue into the hook** — in `useSnagResolve.ts`:

Add imports:
```ts
import { useOfflineQueue } from '@/lib/offline-queue';
import { submitCompleteStep } from './offlineComplete';
import type { QueuedCompleteStep } from './types';
```

Inside `useSnagResolve`, after the existing state declarations, add the queue:
```ts
  const completeQueue = useOfflineQueue<QueuedCompleteStep>({
    // One DB per token keeps a device that resolves several snags from mixing queues.
    queueName: tokenStr ? `SnagCompleteDB:${tokenStr}` : 'SnagCompleteDB:none',
    submit: submitCompleteStep,
  });
```

Replace the body of `handleMarkComplete` so it enqueues when offline / on failure and still refreshes on success:
```ts
  const handleMarkComplete = useCallback(
    (stepId: string) => {
      if (!tokenStr) return;
      const payload: QueuedCompleteStep = { token: tokenStr, stepId, actorId: actor?.id };
      if (!completeQueue.online) {
        void completeQueue.enqueue(payload);
        return;
      }
      // Online: keep the existing optimistic server call; on network error the
      // queue is the safety net.
      void performAction('complete_step', { stepId }).catch(() => {
        void completeQueue.enqueue(payload);
      });
    },
    [tokenStr, actor?.id, completeQueue, performAction]
  );
```

Expose the pending count on the result so the page can show "N steps will sync":
```ts
  // add to UseSnagResolveResult interface:
  //   pendingCompleteCount: number;
  // add to the returned object:
  //   pendingCompleteCount: completeQueue.pendingCount,
```

- [ ] **Step 6: Type-check + run the module tests**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "snag-resolve" || echo "clean"` then `npx vitest run src/modules/noc/snag-resolve`
Expected: `clean`; module tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/noc/snag-resolve/
git commit -m "feat(pwa): pilot — queue snag complete_step offline via useOfflineQueue"
```

---

## Task 14: Full verification + regression gate

**Files:** none (verification only).

- [ ] **Step 1: Run the full offline-queue + pilot test suites**

Run: `npx vitest run src/lib/offline-queue src/components/pwa src/modules/noc/snag-resolve`
Expected: all PASS.

- [ ] **Step 2: Confirm the three existing SWs and manifest-my are untouched**

Run: `git diff --name-only origin/master -- public/sw-my.js public/sw-stock.js public/sw-fleet.js public/manifest-my.json src/modules/attendance/portal/client/offline src/modules/field-stock/offline src/modules/fleet/offline`
Expected: **empty output** (nothing changed).

- [ ] **Step 3: Run the project CI gate**

Run: `npm run ci:quick`
Expected: green.

- [ ] **Step 4: Production build**

Run: `npm run build 2>&1 | tail -15`
Expected: build succeeds.

- [ ] **Step 5: Lighthouse / manual installability check** (documented)

With `PORT=3004 npm run dev` running, Chrome DevTools → Lighthouse → Progressive Web App category → confirm "Installable" passes (manifest + icons + SW). Manually toggle offline and confirm the offline page + cached-route behaviour from Task 12 Step 4.

- [ ] **Step 6: Commit any lint fixes, then push the branch**

```bash
git add -A && git commit -m "chore(pwa): phase 0 verification pass" --allow-empty
git push -u origin feat/main-app-pwa
```

---

## Self-Review (author checklist — completed)

**Spec coverage:** Layer A → Tasks 8-12; Layer B → Tasks 6-7, 12; Layer C → Tasks 1-5; pilot → Task 13; update UX → Tasks 6/11/12; non-regression → Task 14 Step 2; testing strategy → each task's tests + Task 14. GET-API allowlist deliberately empty (spec §7.3) → Task 7 comment. Install affordance custom component (spec §7.4) → Task 11.

**Placeholder scan:** no TBD/TODO/"handle edge cases" left; every code step carries complete code. The one flagged open item (offline photo upload in the pilot) is an explicit, spec-backed deferral, not a placeholder.

**Type consistency:** `QueuedItem`/`DroppedItem`/`SubmitResult`/`FlushReport`/`FlushHooks`/`OfflineQueueConfig` defined in Task 1 and consumed unchanged in Tasks 2-4; `flushQueue` signature `(items, submit, hooks, maxAttempts?)` is identical in Task 3 definition and Task 4 usage; `useOfflineQueue` result fields (`enqueue/pendingCount/online/syncNow/...`) match between Task 4 and Task 13 usage; `submitCompleteStep(payload: QueuedCompleteStep)` matches `OfflineQueueConfig.submit` shape.

**Risk note carried forward:** SW scope arbitration is the highest-risk property — covered by the `isReserved` unit test (Task 7) and the untouched-files regression check (Task 14 Step 2).
