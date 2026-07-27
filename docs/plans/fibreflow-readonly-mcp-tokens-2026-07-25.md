# FibreFlow Read-Only MCP Tokens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every FibreFlow user self-serve a long-lived, **read-only** bearer token that an MCP client (Claude) uses to call FibreFlow's existing HTTP API, with FibreFlow's own auth and RBAC doing all the authorization.

**Architecture:** An MCP token is an ordinary FibreFlow JWT (`JWT_SECRET`, `signToken`) bound to a `user_sessions` row tagged `kind='mcp'` with a caller-chosen expiry. No new verification path, no new secret: `withAuth` (Pages Router) and `requireAuth` (App Router) already resolve `users ⋈ user_sessions` on every request, so `is_active`, session expiry, per-token revocation and fresh `permissions` all work unchanged. The only new enforcement is a read-only gate applied **inside the two auth wrappers**, so every existing and future route inherits it without being touched.

**Tech Stack:** TypeScript, Next.js (Pages + App Router both in use), `jose` for JWT, Postgres (Supabase on Velocity) via `pg.Pool`, vitest.

**Worktree:** `/home/hein/Workspace/FF_Next.js-mcp-tokens`, branch `feat/readonly-mcp-tokens` off `origin/master`. All work happens here — never in `/home/hein/Workspace/FF_Next.js`.

## Global Constraints

- **Read-only, enforced server-side.** An `mcp` session may only issue `GET`/`HEAD`/`OPTIONS`. Enforcement lives in `withAuth`/`requireAuth`, never in individual routes and never in the MCP client.
- **Sign with `JWT_SECRET`, never `BRIDGE_JWT_SECRET`.** `BRIDGE_JWT_SECRET` is the server-only Cortex gateway secret (`src/lib/cortex/bridgeAuth.ts`) — it must never authenticate against FibreFlow itself and must never reach a browser.
- **The token is shown once and never logged.** No token material in `log.*` calls, no token in error messages.
- **Owner lifetime cap: 90 days.** Mirrors the Cortex super-admin cap in `bridgeAuth.ts::isSuperAdmin`. `1y` is rejected for the owner identity.
- **Tests:** vitest. Run one file with `npx vitest run <path>`. Test files live beside their subject in `__tests__/`. Mirror the mocking style already used in `src/lib/cortex/__tests__/mcpToken.test.ts`.
- **Migrations:** one `.sql` file in `migrations/`, named `YYYY-MM-DD-<slug>.sql`, idempotent (`IF NOT EXISTS`).
- **No `console.log`** — use `log` from `@/lib/logger`. No empty catch blocks. 100% type coverage. Max 300 lines per file.
- **Never deploy manually.** Use `bash scripts/deploy-local.sh dev`. Never edit anything under `/home/velo/fibreflow-*/`.
- **Feature flag:** the whole surface sits behind `FF_MCP_TOKEN_UI_ENABLED`; when unset the endpoints 404 (hides the feature rather than advertising it).

## Out of Scope (separate plan)

The MCP server itself. This plan ends when a user can mint a token and `curl -H "Authorization: Bearer <token>" https://dev.fibreflow.app/api/projects` succeeds while the same token is refused on `POST`. Building the MCP tool surface is a follow-on plan against a working credential.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/lib/auth/owner.ts` | **Create** | Single source of truth for the owner-bypass identity. Pure, no DB. |
| `scripts/migrations/sql/463_mcp_sessions.sql` | **Create** | `kind`, `label`, `last_used_at` columns + index on `user_sessions`. |
| `src/lib/auth/types.ts` | Modify | Add `SessionKind`; add `sessionKind` to `AuthUser`; extend `Session`. |
| `src/lib/auth/session.ts` | Modify | `createSession` gains an options bag (`kind`, `expiryDays`, `label`); extract `setSessionTokenHash`; `getUserSessions`/`getSession` return the new columns. |
| `src/lib/auth/readOnly.ts` | **Create** | Pure predicate: is this (user, method) pair a read-only violation? |
| `src/lib/auth/app-router.ts` | Modify | Select `s.kind`; enforce read-only in `requireAuth`; align the token-hash check with the Pages path. |
| `src/lib/auth/middleware.ts` | Modify | Select `s.kind`; enforce read-only in `withAuth`. |
| `src/lib/auth/sessionUsage.ts` | **Create** | Best-effort, never-throwing `last_used_at` touch. |
| `src/lib/auth/mcpToken.ts` | **Create** | `mintFfMcpToken` — lifetimes, owner cap, the create→sign→bind dance. |
| `pages/api/me/mcp-tokens.ts` | **Create** | `POST` mint, `GET` list. |
| `pages/api/me/mcp-tokens/[id].ts` | **Create** | `DELETE` revoke one. |
| `pages/api/auth/login.ts`, `setup-password.ts` | Modify | Use the extracted `setSessionTokenHash` (DRY). |
| `pages/api/meetings.ts`, `meetings/[id]/{transcript,recording,notes}.ts` | Modify | Replace the four inline owner literals with `isOwner(user)`. |
| Connections page (located in Task 9) | Modify | Add a FibreFlow card beside the existing Cortex card. |

## PR / Task DAG

- **PR A — Task 1** (`isOwner`). Foundation, no behaviour change.
- **PR B — Tasks 2–3** (migration + `createSession` options). Independent of A; can run in parallel.
- **PR C — Task 4** (read-only enforcement + token-hash alignment). Depends on B. **Touches both auth wrappers — mandatory blind review via `/review`.**
- **PR D — Tasks 5–6** (mint lib + endpoints). Depends on A, B, C.
- **PR E — Task 7** (`last_used_at`). Depends on C.
- **PR F — Tasks 8–9** (login DRY + UI). Depends on D.

Recommended sequence: A ∥ B → C → D → E → F.

---

### Task 1: `isOwner()` helper

Four route handlers each hardcode `userEmail === 'hein@velocityfibre.co.za'` as an unrestricted-access bypass. One helper, one env var, one place to audit — and one place for Task 5's lifetime cap to consult.

**Scoping note for the implementer:** `grep` also finds this string in `pages/api/odoo/sync/attachments.ts`, `src/services/onemap/oneMapClient.ts` and `src/modules/system/services/oneMapApiService.ts` (env-var **defaults for external integrations**, not auth), in `pages/api/procurement/requisitions/[id]/create-rfq.ts` (an **approver allowlist**, a different concept), and in a test fixture. **Leave all of those alone.** Only the four owner-bypass call sites below change.

**Files:**
- Create: `src/lib/auth/owner.ts`
- Test: `src/lib/auth/__tests__/owner.test.ts`
- Modify: `pages/api/meetings.ts:18`, `pages/api/meetings/[id]/transcript.ts:47`, `pages/api/meetings/[id]/recording.ts:43`, `pages/api/meetings/[id]/notes.ts:22`
- Modify: `src/lib/auth/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `isOwner(user: { email?: string | null } | null | undefined): boolean`, `ownerEmails(): string[]`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/auth/__tests__/owner.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { isOwner, ownerEmails } from '../owner';

describe('isOwner', () => {
  beforeEach(() => {
    process.env.FF_OWNER_EMAILS = 'hein@velocityfibre.co.za';
  });

  it('matches the configured owner, case-insensitively and trimmed', () => {
    expect(isOwner({ email: 'hein@velocityfibre.co.za' })).toBe(true);
    expect(isOwner({ email: 'HEIN@VelocityFibre.CO.ZA' })).toBe(true);
    expect(isOwner({ email: '  hein@velocityfibre.co.za  ' })).toBe(true);
  });

  it('rejects everyone else and every empty shape', () => {
    expect(isOwner({ email: 'lew@velocityfibre.co.za' })).toBe(false);
    expect(isOwner({ email: '' })).toBe(false);
    expect(isOwner({ email: null })).toBe(false);
    expect(isOwner(null)).toBe(false);
    expect(isOwner(undefined)).toBe(false);
  });

  it('supports a comma-separated list and is read at call time', () => {
    process.env.FF_OWNER_EMAILS = 'a@x.co, b@x.co';
    expect(ownerEmails()).toEqual(['a@x.co', 'b@x.co']);
    expect(isOwner({ email: 'b@x.co' })).toBe(true);
  });

  it('falls back to the historical owner when the env var is unset', () => {
    delete process.env.FF_OWNER_EMAILS;
    expect(isOwner({ email: 'hein@velocityfibre.co.za' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/__tests__/owner.test.ts`
Expected: FAIL — `Failed to resolve import "../owner"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/auth/owner.ts
/**
 * Owner identity — the unrestricted-access bypass used by the meeting endpoints.
 *
 * Historically inlined as a string literal in four route handlers. Centralised here so
 * there is exactly one place to audit, one place to rotate, and one place for the
 * MCP-token lifetime cap to consult (see src/lib/auth/mcpToken.ts).
 *
 * Read at CALL time, not module load, so the value can be rotated without a restart —
 * matching the convention in src/lib/cortex/bridgeAuth.ts::isSuperAdmin.
 */

/** Historical owner, kept as the default so behaviour is unchanged when the env var is unset. */
const DEFAULT_OWNER_EMAILS = 'hein@velocityfibre.co.za';

export function ownerEmails(): string[] {
  return (process.env.FF_OWNER_EMAILS ?? DEFAULT_OWNER_EMAILS)
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isOwner(user: { email?: string | null } | null | undefined): boolean {
  const email = user?.email?.trim().toLowerCase();
  if (!email) return false;
  return ownerEmails().includes(email);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth/__tests__/owner.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Export from the auth barrel**

In `src/lib/auth/index.ts`, after the `// Session management` export block, add:

```ts
// Owner identity
export { isOwner, ownerEmails } from './owner';
```

- [ ] **Step 6: Replace the four call sites**

In each of `pages/api/meetings.ts`, `pages/api/meetings/[id]/transcript.ts`, `pages/api/meetings/[id]/recording.ts`, `pages/api/meetings/[id]/notes.ts`, add `isOwner` to the existing `@/lib/auth` import, then replace the literal comparison. For example in `pages/api/meetings/[id]/recording.ts:43`:

```ts
// before
const isHein = userEmail === 'hein@velocityfibre.co.za';

// after
const isHein = isOwner(authReq.user);
```

Keep the local variable name `isHein` — renaming it touches every branch in these files for no behavioural gain, and this task must stay a pure refactor.

In `pages/api/meetings.ts:18` the surrounding code uses `authReq.user`; pass that. Do **not** change the super-admin role check further down that file — it is a separate rule.

Also update the two docstrings that name the email directly (`transcript.ts:31`, `recording.ts:28`) to read:

```
 *   - Owner identity (see src/lib/auth/owner.ts): unrestricted access
```

- [ ] **Step 7: Run the affected tests**

Run: `npx vitest run src/lib/auth && npx vitest run pages/api/works-qa/__tests__/photo-snag-api.test.ts`
Expected: PASS. Also check for meeting-specific tests with `ls pages/api/meetings/__tests__/ 2>/dev/null` and run any that exist.

- [ ] **Step 8: Commit**

```bash
git add src/lib/auth/owner.ts src/lib/auth/__tests__/owner.test.ts src/lib/auth/index.ts \
        pages/api/meetings.ts 'pages/api/meetings/[id]/transcript.ts' \
        'pages/api/meetings/[id]/recording.ts' 'pages/api/meetings/[id]/notes.ts'
git commit -m "refactor(auth): centralise owner bypass in isOwner() helper"
```

---

### Task 2: `user_sessions` migration

**Files:**
- Create: `scripts/migrations/sql/463_mcp_sessions.sql` (+ `rollback_463_mcp_sessions.sql`)

**Interfaces:**
- Consumes: nothing.
- Produces: columns `user_sessions.kind` (`'browser'|'mcp'`, NOT NULL, default `'browser'`), `user_sessions.label` (nullable text), `user_sessions.last_used_at` (nullable timestamptz); constraint `user_sessions_kind_chk`; index `idx_user_sessions_user_kind`.

- [ ] **Step 1: Write the migration**

```sql
-- scripts/migrations/sql/463_mcp_sessions.sql
-- Read-only MCP tokens: tag sessions by kind so (a) "log out everywhere" can sweep
-- browser sessions without silently killing every user's MCP connection, and (b) the
-- auth wrappers can apply the read-only gate. Idempotent; safe to re-run.

ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'browser';
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

-- ADD CONSTRAINT has no IF NOT EXISTS form, so guard it explicitly.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_sessions_kind_chk') THEN
    ALTER TABLE user_sessions
      ADD CONSTRAINT user_sessions_kind_chk CHECK (kind IN ('browser', 'mcp'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_kind
  ON user_sessions (user_id, kind);
```

- [ ] **Step 2: Apply to dev and verify the shape**

```bash
bash scripts/run-pending-migrations.sh   # the canonical runner; records it in schema_migrations
psql "$DATABASE_URL" -c "\d user_sessions"
```
Expected: `kind`, `label`, `last_used_at` present; `user_sessions_kind_chk` listed under Check constraints; `idx_user_sessions_user_kind` under Indexes.

- [ ] **Step 3: Verify existing rows are unaffected**

```bash
psql "$DATABASE_URL" -c "SELECT kind, count(*) FROM user_sessions GROUP BY kind;"
```
Expected: one row, `browser`, with the pre-existing session count.

- [ ] **Step 4: Verify idempotency**

Run the migration a second time. Expected: completes with no error and no change.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrations/sql/463_mcp_sessions.sql scripts/migrations/sql/rollback_463_mcp_sessions.sql
git commit -m "feat(db): add kind/label/last_used_at to user_sessions for MCP tokens"
```

---

### Task 3: `createSession` options bag + `setSessionTokenHash`

`createSession` currently hardcodes `SESSION_EXPIRY_DAYS = 30`, so a 90-day or 1-year JWT would stop working at day 30 when its session row expires. It also cannot set `kind`. And `pages/api/auth/login.ts` performs the token-hash `UPDATE` inline, which the mint would otherwise duplicate.

**Files:**
- Modify: `src/lib/auth/types.ts`
- Modify: `src/lib/auth/session.ts`
- Modify: `src/lib/auth/index.ts`
- Test: `src/lib/auth/__tests__/session.mcp.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type SessionKind = 'browser' | 'mcp'`
  - `createSession(userId: string, token: string, ipAddress?: string, userAgent?: string, options?: CreateSessionOptions): Promise<Session>` where `CreateSessionOptions = { kind?: SessionKind; expiryDays?: number; label?: string }`
  - `setSessionTokenHash(sessionId: string, token: string): Promise<void>`
  - `getUserSessions(userId: string, kind?: SessionKind): Promise<Session[]>`
  - `deleteAllUserSessions(userId: string, kind?: SessionKind): Promise<void>`
  - `Session` gains `kind: SessionKind`, `label?: string`, `lastUsedAt?: Date`

- [ ] **Step 1: Write the failing test**

**Before writing this test, open `src/lib/auth/session.ts` and note which module its `sql` tagged-template binding is imported from.** Point `vi.mock` at that exact specifier — the mock below assumes `@/lib/db-neon`; correct it if the file imports from elsewhere.

```ts
// src/lib/auth/__tests__/session.mcp.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ text: string; values: unknown[] }> = [];

// The module under test uses a tagged-template `sql` binding. Capture the interpolated
// values so we can assert on what would be written, without touching a database.
vi.mock('@/lib/db-neon', () => ({
  neon: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve([]);
  },
}));

import { createSession, setSessionTokenHash } from '../session';

describe('createSession with MCP options', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('defaults to a browser session expiring in 30 days', async () => {
    const before = Date.now();
    const session = await createSession('user-1', '');
    expect(session.kind).toBe('browser');
    const days = (session.expiresAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it('honours kind, expiryDays and label', async () => {
    const before = Date.now();
    const session = await createSession('user-1', '', undefined, undefined, {
      kind: 'mcp',
      expiryDays: 90,
      label: 'Claude desktop',
    });
    expect(session.kind).toBe('mcp');
    expect(session.label).toBe('Claude desktop');
    const days = (session.expiresAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
    expect(calls[0].values).toContain('mcp');
    expect(calls[0].values).toContain('Claude desktop');
  });

  it('setSessionTokenHash updates the row for that session id', async () => {
    await setSessionTokenHash('sess-1', 'the.jwt.value');
    expect(calls[0].text).toContain('UPDATE user_sessions');
    expect(calls[0].values).toContain('sess-1');
    expect(calls[0].values).toContain('the.jwt.value');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/__tests__/session.mcp.test.ts`
Expected: FAIL — `setSessionTokenHash` is not exported, and `session.kind` is `undefined`.

- [ ] **Step 3: Add the types**

In `src/lib/auth/types.ts`, above the `Session` interface:

```ts
/** Browser sessions are full-access; `mcp` sessions are read-only (see src/lib/auth/readOnly.ts). */
export type SessionKind = 'browser' | 'mcp';
```

and replace the `Session` interface with:

```ts
export interface Session {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  ipAddress?: string;
  userAgent?: string;
  kind: SessionKind;
  label?: string;
  lastUsedAt?: Date;
}
```

- [ ] **Step 4: Implement `createSession` and `setSessionTokenHash`**

Add `SessionKind` to the type import at the top of `src/lib/auth/session.ts`, then replace `createSession` (line 27) with:

```ts
export interface CreateSessionOptions {
  /** Defaults to 'browser'. */
  kind?: SessionKind;
  /** Overrides SESSION_EXPIRY_DAYS for this row. */
  expiryDays?: number;
  /** Human label shown in the user's connections list. MCP sessions only. */
  label?: string;
}

/**
 * Create a new session for a user.
 *
 * Callers pass `''` for `token` and then call `setSessionTokenHash` once the JWT has
 * been signed — the JWT embeds the session id, so the row must exist first.
 */
export async function createSession(
  userId: string,
  token: string,
  ipAddress?: string,
  userAgent?: string,
  options?: CreateSessionOptions
): Promise<Session> {
  const sessionId = uuidv4();
  const tokenHash = hashToken(token);
  const kind: SessionKind = options?.kind ?? 'browser';
  const expiryDays = options?.expiryDays ?? SESSION_EXPIRY_DAYS;
  const label = options?.label ?? null;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiryDays);

  await sql`
    INSERT INTO user_sessions (id, user_id, token_hash, expires_at, ip_address, user_agent, kind, label)
    VALUES (${sessionId}, ${userId}, ${tokenHash}, ${expiresAt.toISOString()}, ${ipAddress || null}, ${userAgent || null}, ${kind}, ${label})
  `;

  return {
    id: sessionId,
    userId,
    tokenHash,
    expiresAt,
    createdAt: new Date(),
    ipAddress,
    userAgent,
    kind,
    label: options?.label,
  };
}

/**
 * Bind a signed JWT to its session row. Extracted from pages/api/auth/login.ts so the
 * login flow and the MCP mint share one implementation.
 */
export async function setSessionTokenHash(sessionId: string, token: string): Promise<void> {
  await sql`
    UPDATE user_sessions
    SET token_hash = encode(sha256(${token}::bytea), 'hex')
    WHERE id = ${sessionId}
  `;
}
```

- [ ] **Step 5: Return the new columns from `getSession` and `getUserSessions`**

Replace `getUserSessions` (line 161) with:

```ts
export async function getUserSessions(userId: string, kind?: SessionKind): Promise<Session[]> {
  const result = kind
    ? await sql`
        SELECT id, user_id, token_hash, expires_at, created_at, ip_address, user_agent,
               kind, label, last_used_at
        FROM user_sessions
        WHERE user_id = ${userId} AND expires_at > NOW() AND kind = ${kind}
        ORDER BY created_at DESC
      `
    : await sql`
        SELECT id, user_id, token_hash, expires_at, created_at, ip_address, user_agent,
               kind, label, last_used_at
        FROM user_sessions
        WHERE user_id = ${userId} AND expires_at > NOW()
        ORDER BY created_at DESC
      `;

  return result.map((row) => ({
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: new Date(row.expires_at),
    createdAt: new Date(row.created_at),
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    kind: (row.kind ?? 'browser') as SessionKind,
    label: row.label ?? undefined,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : undefined,
  }));
}
```

Then open `getSession` (line 116). If it selects an explicit column list, add `kind, label, last_used_at` to it and map them into the returned `Session` exactly as above. Task 6's revoke endpoint depends on `getSession(...).kind` being populated.

- [ ] **Step 6: Scope `deleteAllUserSessions` to browser sessions**

"Log out everywhere" must not silently kill a user's MCP connections. Replace it (line 151):

```ts
/**
 * Delete a user's sessions of one kind (logout everywhere).
 * Defaults to 'browser': MCP sessions are deliberately NOT swept by a logout — they
 * are revoked explicitly from the connections page.
 */
export async function deleteAllUserSessions(
  userId: string,
  kind: SessionKind = 'browser'
): Promise<void> {
  await sql`
    DELETE FROM user_sessions
    WHERE user_id = ${userId} AND kind = ${kind}
  `;
}
```

- [ ] **Step 7: Export the new symbol**

In `src/lib/auth/index.ts`, add `setSessionTokenHash` to the existing session-management export block.

- [ ] **Step 8: Run tests**

Run: `npx vitest run src/lib/auth && npx tsc --noEmit`
Expected: PASS, including the three new tests. `tsc` catches any caller broken by the `Session` shape change.

- [ ] **Step 9: Commit**

```bash
git add src/lib/auth/session.ts src/lib/auth/types.ts src/lib/auth/index.ts \
        src/lib/auth/__tests__/session.mcp.test.ts
git commit -m "feat(auth): session kind/expiry options and setSessionTokenHash"
```

---

### Task 4: Read-only enforcement in both auth wrappers

This is the security core. Both routers resolve users independently, so both must gate. Enforcement goes in the wrappers so no route can forget it.

While editing the App Router query, also add the `token_hash` check it is currently missing — the Pages Router path already verifies it, and leaving two different security postures for the same credential is a defect a reviewer will correctly reject.

**Files:**
- Create: `src/lib/auth/readOnly.ts`
- Test: `src/lib/auth/__tests__/readOnly.test.ts`
- Modify: `src/lib/auth/types.ts`
- Modify: `src/lib/auth/app-router.ts` (`getUserFromRequest`, `requireAuth`)
- Modify: `src/lib/auth/middleware.ts` (`getUserAndValidateSession`, `withAuth`)

**Interfaces:**
- Consumes: `SessionKind` (Task 3).
- Produces: `isReadOnlyViolation(user: AuthUser, method: string | undefined): boolean`, `MCP_READ_ONLY_CODE`, `MCP_READ_ONLY_MESSAGE`; `AuthUser.sessionKind?: SessionKind`; HTTP 403 with error code `MCP_READ_ONLY`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/auth/__tests__/readOnly.test.ts
import { describe, expect, it } from 'vitest';
import { isReadOnlyViolation } from '../readOnly';
import type { AuthUser, SessionKind } from '../types';

const user = (kind?: SessionKind): AuthUser =>
  ({
    id: 'u1', userId: 'u1', email: 'a@x.co', firstName: 'A', lastName: 'B', name: 'A B',
    role: 'viewer', permissions: [], isActive: true, sessionKind: kind,
  }) as AuthUser;

describe('isReadOnlyViolation', () => {
  it('allows safe methods on an mcp session', () => {
    for (const m of ['GET', 'get', 'HEAD', 'OPTIONS']) {
      expect(isReadOnlyViolation(user('mcp'), m)).toBe(false);
    }
  });

  it('blocks every mutating method on an mcp session', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
      expect(isReadOnlyViolation(user('mcp'), m)).toBe(true);
    }
  });

  it('never blocks a browser session or a user with no session kind', () => {
    expect(isReadOnlyViolation(user('browser'), 'DELETE')).toBe(false);
    expect(isReadOnlyViolation(user(undefined), 'POST')).toBe(false);
  });

  it('treats a missing method as GET', () => {
    expect(isReadOnlyViolation(user('mcp'), undefined)).toBe(false);
  });

  it('fails closed on an unrecognised method', () => {
    expect(isReadOnlyViolation(user('mcp'), 'TRACE')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/__tests__/readOnly.test.ts`
Expected: FAIL — `Failed to resolve import "../readOnly"`

- [ ] **Step 3: Implement the predicate**

```ts
// src/lib/auth/readOnly.ts
/**
 * Read-only gate for MCP sessions.
 *
 * An MCP token is a long-lived credential pasted into a third-party client, so it is
 * restricted to safe methods. The gate lives in withAuth/requireAuth rather than in
 * individual routes: every existing and future endpoint inherits it, and no route can
 * forget to apply it.
 *
 * Fails closed — anything not explicitly a safe method is a violation.
 */
import type { AuthUser } from './types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const MCP_READ_ONLY_CODE = 'MCP_READ_ONLY';
export const MCP_READ_ONLY_MESSAGE =
  'This token is read-only. Mutating requests require an interactive FibreFlow session.';

export function isReadOnlyViolation(user: AuthUser, method: string | undefined): boolean {
  if (user.sessionKind !== 'mcp') return false;
  return !SAFE_METHODS.has((method ?? 'GET').toUpperCase());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth/__tests__/readOnly.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Add `sessionKind` to `AuthUser`**

In `src/lib/auth/types.ts`, inside the `AuthUser` interface, after `isImpersonation`:

```ts
  /** Kind of session that authenticated this request. Absent for users not derived from a request. */
  sessionKind?: SessionKind;
```

- [ ] **Step 6: Wire the App Router path**

In `src/lib/auth/app-router.ts`, add `import { createHash } from 'crypto';`, add `SessionKind` to the type imports, and add `isReadOnlyViolation, MCP_READ_ONLY_CODE, MCP_READ_ONLY_MESSAGE` from `./readOnly`. Then replace the body of `getUserFromRequest` after `verifyToken`:

```ts
  const tokenHash = createHash('sha256').update(token).digest('hex');

  try {
    const result = await pool.query<AuthUser & { kind: string }>(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.permissions,
              u.is_active, u.profile_picture, u.department, s.kind
       FROM users u
       INNER JOIN user_sessions s ON s.user_id = u.id
       WHERE u.id = $1
         AND s.id = $2
         AND s.token_hash = $3
         AND u.is_active = true
         AND s.expires_at > NOW()
       LIMIT 1`,
      [payload.sub, payload.sessionId, tokenHash]
    );

    const row = result.rows[0];
    if (!row) return null;
    return { ...row, sessionKind: (row.kind ?? 'browser') as SessionKind };
  } catch {
    return null;
  }
```

Then replace `requireAuth`:

```ts
export async function requireAuth(
  req: NextRequest
): Promise<[AuthUser, null] | [null, NextResponse]> {
  const user = await getUserFromRequest(req);
  if (!user) {
    return [null, NextResponse.json({ error: 'Unauthorized' }, { status: 401 })];
  }
  if (isReadOnlyViolation(user, req.method)) {
    return [
      null,
      NextResponse.json(
        { success: false, error: { code: MCP_READ_ONLY_CODE, message: MCP_READ_ONLY_MESSAGE } },
        { status: 403 }
      ),
    ];
  }
  return [user, null];
}
```

`requirePermission` composes `requireAuth`, so it inherits the gate with no change.

- [ ] **Step 7: Wire the Pages Router path**

In `src/lib/auth/middleware.ts::getUserAndValidateSession`, add `s.kind` to the `SELECT` list (after `s.is_impersonation`) and add `sessionKind: (row.kind as SessionKind) ?? 'browser'` to the returned object.

Then in `withAuth`, immediately after the `if (!user)` block:

```ts
      if (isReadOnlyViolation(user, req.method)) {
        return res.status(403).json({
          success: false,
          error: { code: MCP_READ_ONLY_CODE, message: MCP_READ_ONLY_MESSAGE },
        });
      }
```

`withRole` and `withPermission` wrap `withAuth`, so they inherit it.

- [ ] **Step 8: Verify nothing regressed**

There is no MCP token to test with until Task 5 — this step confirms browser sessions are unaffected.

```bash
npx vitest run src/lib/auth
npx tsc --noEmit
npm run lint
```
Expected: clean. Then deploy to dev (`bash scripts/deploy-local.sh dev`), log in through the browser on `dev.fibreflow.app`, and load a page backed by each router — a projects page (Pages Router API) and an assets page (App Router API). Both must work. **The token-hash addition in Step 6 is the risk here: if App Router routes start 401ing for a valid browser session, `setup-password.ts` is issuing sessions without writing a token hash — fix that in Task 8 Step 2 before proceeding.**

- [ ] **Step 9: Commit and request blind review**

```bash
git add src/lib/auth/readOnly.ts src/lib/auth/__tests__/readOnly.test.ts \
        src/lib/auth/app-router.ts src/lib/auth/middleware.ts src/lib/auth/types.ts
git commit -m "feat(auth): read-only gate for mcp sessions in both auth wrappers"
```

Then run `/review` on this diff. Do not self-review — this changes the authorization path for every route in the application.

---

### Task 5: The mint library

**Files:**
- Create: `src/lib/auth/mcpToken.ts`
- Test: `src/lib/auth/__tests__/mcpToken.test.ts`

**Interfaces:**
- Consumes: `isOwner` (Task 1); `createSession`, `setSessionTokenHash` (Task 3); `signToken` from `./jwt`.
- Produces:
  - `export type McpLifetime = '30d' | '90d' | '1y'`
  - `export const MCP_LIFETIME_DAYS: Record<McpLifetime, number>`
  - `export const OWNER_MAX_DAYS = 90`
  - `export class McpLifetimeCapError extends Error`
  - `mintFfMcpToken(user: AuthUser, lifetime: McpLifetime, opts?: MintOptions): Promise<MintedToken>` where `MintOptions = { label?: string; ipAddress?: string; userAgent?: string }` and `MintedToken = { token: string; expiresAt: Date; sessionId: string }`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/auth/__tests__/mcpToken.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSession = vi.fn();
const setSessionTokenHash = vi.fn();
const signToken = vi.fn();

vi.mock('../session', () => ({ createSession, setSessionTokenHash }));
vi.mock('../jwt', () => ({ signToken }));

import { McpLifetimeCapError, MCP_LIFETIME_DAYS, mintFfMcpToken } from '../mcpToken';
import type { AuthUser } from '../types';

const asUser = (email: string): AuthUser =>
  ({
    id: 'u1', userId: 'u1', email, firstName: 'A', lastName: 'B', name: 'A B',
    role: 'viewer', permissions: [], isActive: true,
  }) as AuthUser;

describe('mintFfMcpToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FF_OWNER_EMAILS = 'owner@x.co';
    createSession.mockResolvedValue({ id: 'sess-1', expiresAt: new Date('2026-10-23T00:00:00Z') });
    signToken.mockResolvedValue('signed.jwt.token');
  });

  it('creates an mcp session with the requested lifetime, signs, then binds the hash', async () => {
    const result = await mintFfMcpToken(asUser('lew@x.co'), '90d', { label: 'Claude desktop' });

    expect(createSession).toHaveBeenCalledWith('u1', '', undefined, undefined, {
      kind: 'mcp',
      expiryDays: 90,
      label: 'Claude desktop',
    });
    expect(signToken).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), 'sess-1', '90d');
    expect(setSessionTokenHash).toHaveBeenCalledWith('sess-1', 'signed.jwt.token');
    expect(result.token).toBe('signed.jwt.token');
    expect(result.sessionId).toBe('sess-1');
  });

  it('orders the calls create -> sign -> bind', async () => {
    const order: string[] = [];
    createSession.mockImplementation(async () => {
      order.push('create');
      return { id: 'sess-1', expiresAt: new Date() };
    });
    signToken.mockImplementation(async () => {
      order.push('sign');
      return 'jwt';
    });
    setSessionTokenHash.mockImplementation(async () => {
      order.push('bind');
    });

    await mintFfMcpToken(asUser('lew@x.co'), '30d');
    expect(order).toEqual(['create', 'sign', 'bind']);
  });

  it('caps the owner at 90 days and creates nothing when rejected', async () => {
    await expect(mintFfMcpToken(asUser('owner@x.co'), '1y')).rejects.toBeInstanceOf(McpLifetimeCapError);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('allows the owner 90d', async () => {
    await expect(mintFfMcpToken(asUser('owner@x.co'), '90d')).resolves.toBeDefined();
  });

  it('allows a non-owner 1y', async () => {
    await expect(mintFfMcpToken(asUser('lew@x.co'), '1y')).resolves.toBeDefined();
    expect(createSession).toHaveBeenCalledWith(
      'u1', '', undefined, undefined,
      expect.objectContaining({ expiryDays: MCP_LIFETIME_DAYS['1y'] })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/__tests__/mcpToken.test.ts`
Expected: FAIL — `Failed to resolve import "../mcpToken"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/auth/mcpToken.ts
/**
 * FibreFlow read-only MCP tokens.
 *
 * An MCP token is an ordinary FibreFlow JWT (JWT_SECRET) bound to a `user_sessions`
 * row tagged kind='mcp'. That gives us, for free and with no new verification path:
 *   - offboarding      — getUserFromRequest checks `u.is_active` on every request
 *   - per-token revoke — delete the session row
 *   - live permissions — `u.permissions` is read per request, never from the JWT
 * The read-only restriction is enforced in withAuth/requireAuth (see ./readOnly).
 *
 * NOT to be confused with src/lib/cortex/bridgeAuth.ts::mintMcpToken, which signs with
 * the server-only BRIDGE_JWT_SECRET gateway secret to assert an identity TO Cortex.
 * This module signs with JWT_SECRET to authenticate a user TO FibreFlow.
 */
import { createSession, setSessionTokenHash } from './session';
import { signToken } from './jwt';
import { isOwner } from './owner';
import type { AuthUser } from './types';

export type McpLifetime = '30d' | '90d' | '1y';

export const MCP_LIFETIME_DAYS: Record<McpLifetime, number> = {
  '30d': 30,
  '90d': 90,
  '1y': 365,
};

/**
 * The owner identity bypasses participant scoping on the meeting endpoints, so a lost
 * owner token has tenant-wide read blast radius. Capped at 90 days, mirroring the
 * Cortex super-admin cap in src/lib/cortex/bridgeAuth.ts.
 */
export const OWNER_MAX_DAYS = 90;

export class McpLifetimeCapError extends Error {
  constructor(maxDays: number = OWNER_MAX_DAYS) {
    super(`Owner MCP tokens are capped at ${maxDays} days`);
    this.name = 'McpLifetimeCapError';
  }
}

export interface MintOptions {
  label?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface MintedToken {
  token: string;
  expiresAt: Date;
  sessionId: string;
}

/**
 * Mint a read-only MCP token for an already-verified user.
 *
 * The caller MUST pass a server-verified `AuthUser` (i.e. `req.user`), never a
 * client-supplied identity. The token is returned exactly once and is not recoverable.
 */
export async function mintFfMcpToken(
  user: AuthUser,
  lifetime: McpLifetime,
  opts?: MintOptions
): Promise<MintedToken> {
  const days = MCP_LIFETIME_DAYS[lifetime];
  if (isOwner(user) && days > OWNER_MAX_DAYS) {
    throw new McpLifetimeCapError();
  }

  // create -> sign -> bind: the JWT embeds the session id, so the row must exist first,
  // and the row's token_hash can only be written once the JWT exists. Same three-step
  // dance as pages/api/auth/login.ts.
  const session = await createSession(user.id, '', opts?.ipAddress, opts?.userAgent, {
    kind: 'mcp',
    expiryDays: days,
    label: opts?.label,
  });
  const token = await signToken(user, session.id, `${days}d`);
  await setSessionTokenHash(session.id, token);

  return { token, expiresAt: session.expiresAt, sessionId: session.id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth/__tests__/mcpToken.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/mcpToken.ts src/lib/auth/__tests__/mcpToken.test.ts
git commit -m "feat(auth): mintFfMcpToken with owner lifetime cap"
```

---

### Task 6: Self-serve endpoints

**Files:**
- Create: `pages/api/me/mcp-tokens.ts`
- Create: `pages/api/me/mcp-tokens/[id].ts`
- Test: `pages/api/me/__tests__/mcp-tokens.test.ts`

**Interfaces:**
- Consumes: `mintFfMcpToken`, `McpLifetimeCapError`, `MCP_LIFETIME_DAYS`, `McpLifetime` (Task 5); `getUserSessions`, `getSession`, `deleteSession` (Task 3).
- Produces:
  - `POST /api/me/mcp-tokens` body `{ lifetime?: '30d'|'90d'|'1y', label?: string }` → `{ token, expiresAt }`
  - `GET /api/me/mcp-tokens` → `{ tokens: Array<{ id, label, createdAt, expiresAt, lastUsedAt }> }`
  - `DELETE /api/me/mcp-tokens/:id` → `{ revoked: true }`

`POST` and `DELETE` are mutating, so Task 4's gate means an MCP token can never mint or revoke another MCP token. That is intentional — minting requires an interactive login.

- [ ] **Step 1: Write the failing test**

```ts
// pages/api/me/__tests__/mcp-tokens.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mintFfMcpToken = vi.fn();
const getUserSessions = vi.fn();

vi.mock('@/lib/auth/mcpToken', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/mcpToken')>('@/lib/auth/mcpToken');
  return { ...actual, mintFfMcpToken };
});
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/auth');
  return {
    ...actual,
    getUserSessions,
    // withAuth is exercised separately; here it passes the handler through so the test
    // can supply an already-verified req.user, matching the real wrapper's contract.
    withAuth: (h: unknown) => h,
  };
});

import handler from '../mcp-tokens';

type MockRes = { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };

const makeRes = (): MockRes => {
  const r = {} as MockRes;
  r.status = vi.fn().mockReturnValue(r);
  r.json = vi.fn().mockReturnValue(r);
  return r;
};

const makeReq = (method: string, body?: unknown) =>
  ({ method, body, query: {}, headers: {}, user: { id: 'u1', email: 'lew@x.co' } }) as never;

describe('/api/me/mcp-tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FF_MCP_TOKEN_UI_ENABLED = 'true';
  });

  it('404s when the feature flag is off', async () => {
    process.env.FF_MCP_TOKEN_UI_ENABLED = '';
    const res = makeRes();
    await handler(makeReq('POST', {}), res as never);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mintFfMcpToken).not.toHaveBeenCalled();
  });

  it('rejects an unknown lifetime without minting', async () => {
    const res = makeRes();
    await handler(makeReq('POST', { lifetime: '10y' }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mintFfMcpToken).not.toHaveBeenCalled();
  });

  it('defaults to 30d and passes the verified user through', async () => {
    mintFfMcpToken.mockResolvedValue({
      token: 'jwt', expiresAt: new Date('2026-08-24'), sessionId: 's1',
    });
    const res = makeRes();
    await handler(makeReq('POST', {}), res as never);
    expect(mintFfMcpToken).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1' }),
      '30d',
      expect.objectContaining({ label: undefined })
    );
  });

  it('lists only mcp sessions and never leaks token_hash', async () => {
    getUserSessions.mockResolvedValue([
      {
        id: 's1', kind: 'mcp', label: 'Claude', tokenHash: 'SECRETHASH',
        createdAt: new Date(), expiresAt: new Date(), lastUsedAt: undefined,
      },
    ]);
    const res = makeRes();
    await handler(makeReq('GET'), res as never);
    expect(getUserSessions).toHaveBeenCalledWith('u1', 'mcp');
    const payload = JSON.stringify(res.json.mock.calls);
    expect(payload).not.toContain('SECRETHASH');
    expect(payload).toContain('s1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run pages/api/me/__tests__/mcp-tokens.test.ts`
Expected: FAIL — cannot resolve `../mcp-tokens`

- [ ] **Step 3: Implement the collection endpoint**

Before writing this, open `pages/api/cortex/mcp-token.ts` and confirm the exact helper names on `apiResponse` (`success`, `badRequest`, `forbidden`, `methodNotAllowed`, and whatever it uses for 404). Use the same ones.

```ts
// pages/api/me/mcp-tokens.ts
/**
 * FibreFlow read-only MCP tokens — self-serve mint + list.
 *
 *   POST /api/me/mcp-tokens  { lifetime?, label? } -> { token, expiresAt }
 *   GET  /api/me/mcp-tokens                        -> { tokens: [...] }
 *
 * Identity is ALWAYS req.user (server-verified by withAuth), never client-supplied.
 * The minted token is returned once and never logged. Available to every authenticated
 * user — the token grants no privilege beyond what that user already has, and is
 * read-only regardless (src/lib/auth/readOnly.ts).
 *
 * POST is mutating, so an MCP token cannot mint another one: minting requires an
 * interactive browser session.
 */
import type { NextApiResponse } from 'next';
import { withAuth, getUserSessions } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { McpLifetimeCapError, MCP_LIFETIME_DAYS, mintFfMcpToken } from '@/lib/auth/mcpToken';
import type { McpLifetime } from '@/lib/auth/mcpToken';

const LOGGER = 'MeMcpTokens';
const MAX_LABEL_LENGTH = 60;

function uiEnabled(): boolean {
  return (process.env.FF_MCP_TOKEN_UI_ENABLED ?? '').trim().toLowerCase() === 'true';
}

function isLifetime(v: unknown): v is McpLifetime {
  return typeof v === 'string' && Object.keys(MCP_LIFETIME_DAYS).includes(v);
}

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse): Promise<void> {
  if (!uiEnabled()) {
    return apiResponse.notFound(res, 'Not found');
  }

  if (req.method === 'GET') {
    const sessions = await getUserSessions(req.user.id, 'mcp');
    return apiResponse.success(res, {
      tokens: sessions.map((s) => ({
        id: s.id,
        label: s.label ?? null,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        lastUsedAt: s.lastUsedAt ?? null,
      })),
    });
  }

  if (req.method === 'POST') {
    const rawLifetime: unknown = req.body?.lifetime ?? '30d';
    if (!isLifetime(rawLifetime)) {
      return apiResponse.badRequest(
        res,
        `lifetime must be one of ${Object.keys(MCP_LIFETIME_DAYS).join(', ')}`
      );
    }

    const rawLabel: unknown = req.body?.label;
    const label =
      typeof rawLabel === 'string' && rawLabel.trim()
        ? rawLabel.trim().slice(0, MAX_LABEL_LENGTH)
        : undefined;

    try {
      const { token, expiresAt, sessionId } = await mintFfMcpToken(req.user, rawLifetime, {
        label,
        ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0],
        userAgent: req.headers['user-agent'],
      });
      // sessionId is safe to log; the token is not.
      log.info(LOGGER, 'minted read-only mcp token', {
        userId: req.user.id,
        sessionId,
        lifetime: rawLifetime,
      });
      return apiResponse.success(res, { token, expiresAt });
    } catch (err) {
      if (err instanceof McpLifetimeCapError) {
        return apiResponse.badRequest(res, err.message);
      }
      throw err;
    }
  }

  return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(handler);
```

- [ ] **Step 4: Implement the revoke endpoint**

```ts
// pages/api/me/mcp-tokens/[id].ts
/**
 * DELETE /api/me/mcp-tokens/:id -> { revoked: true }
 *
 * Revokes ONE of the caller's own MCP sessions. Ownership is re-checked against the
 * verified user before deletion, so a user can never revoke someone else's token, and
 * a browser session id passed here is refused rather than silently deleted.
 */
import type { NextApiResponse } from 'next';
import { withAuth, getSession, deleteSession } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const LOGGER = 'MeMcpTokenRevoke';

function uiEnabled(): boolean {
  return (process.env.FF_MCP_TOKEN_UI_ENABLED ?? '').trim().toLowerCase() === 'true';
}

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse): Promise<void> {
  if (!uiEnabled()) {
    return apiResponse.notFound(res, 'Not found');
  }
  if (req.method !== 'DELETE') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['DELETE']);
  }

  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id) {
    return apiResponse.badRequest(res, 'Invalid token id');
  }

  const session = await getSession(id);
  // One message for "not yours", "not an mcp session" and "does not exist" — do not let
  // a caller probe for other users' session ids.
  if (!session || session.userId !== req.user.id || session.kind !== 'mcp') {
    return apiResponse.forbidden(res, 'Token not found or not yours');
  }

  await deleteSession(id);
  log.info(LOGGER, 'revoked mcp token', { userId: req.user.id, sessionId: id });
  return apiResponse.success(res, { revoked: true });
}

export default withAuth(handler);
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run pages/api/me/__tests__/mcp-tokens.test.ts && npx vitest run src/lib/auth && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Deploy to dev and verify the read/write split**

```bash
# add FF_MCP_TOKEN_UI_ENABLED=true to the dev env first
bash scripts/deploy-local.sh dev

# log in through the browser, copy the auth cookie value, then:
TOKEN=$(curl -s -X POST https://dev.fibreflow.app/api/me/mcp-tokens \
  -H "Cookie: <auth-cookie>" -H 'Content-Type: application/json' \
  -d '{"lifetime":"30d","label":"plan smoke test"}' | jq -r .data.token)

curl -s -o /dev/null -w "GET  /api/projects -> %{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" https://dev.fibreflow.app/api/projects

curl -s -o /dev/null -w "POST /api/projects -> %{http_code}\n" -X POST \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}' \
  https://dev.fibreflow.app/api/projects
```
Expected: `GET -> 200`, `POST -> 403`. **If POST returns anything other than 403, stop and fix Task 4 before continuing.**

- [ ] **Step 7: Verify participant scoping survives the token**

```bash
curl -s -H "Authorization: Bearer $TOKEN" https://dev.fibreflow.app/api/meetings | jq '.data | length'
```
Expected: `200`, and the count reflects only meetings that user attended. Mint a second token as a different test user and confirm the two counts differ.

- [ ] **Step 8: Commit**

```bash
git add pages/api/me/
git commit -m "feat(api): self-serve read-only MCP token mint/list/revoke"
```

---

### Task 7: `last_used_at` tracking

Without this the connections list cannot show whether a token is live, and stale tokens cannot be identified. The write path runs on every authenticated request, so it must never raise and must not turn every read into a write.

**Files:**
- Create: `src/lib/auth/sessionUsage.ts`
- Test: `src/lib/auth/__tests__/sessionUsage.test.ts`
- Modify: `src/lib/auth/app-router.ts`, `src/lib/auth/middleware.ts`

**Interfaces:**
- Consumes: `SessionKind` (Task 3).
- Produces: `touchSessionUsage(sessionId: string, kind: SessionKind): void` — fire-and-forget, returns `void`, never throws, never leaves an unhandled rejection.

- [ ] **Step 1: Write the failing test**

Check which db binding `src/lib/auth/app-router.ts` already imports (it uses a `pg.Pool`) and mock that same specifier — the mock below assumes `@/lib/db` exporting `db`.

```ts
// src/lib/auth/__tests__/sessionUsage.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query } }));

import { touchSessionUsage } from '../sessionUsage';

describe('touchSessionUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.mockResolvedValue({ rows: [] });
  });

  it('does nothing for browser sessions', () => {
    touchSessionUsage('s1', 'browser');
    expect(query).not.toHaveBeenCalled();
  });

  it('issues a throttled update for mcp sessions', () => {
    touchSessionUsage('s1', 'mcp');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('last_used_at');
    expect(query.mock.calls[0][0]).toContain('INTERVAL');
    expect(query.mock.calls[0][1]).toEqual(['s1']);
  });

  it('never throws and leaves no unhandled rejection when the database fails', async () => {
    query.mockRejectedValue(new Error('db down'));
    expect(() => touchSessionUsage('s1', 'mcp')).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/__tests__/sessionUsage.test.ts`
Expected: FAIL — `Failed to resolve import "../sessionUsage"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/auth/sessionUsage.ts
/**
 * Best-effort `last_used_at` tracking for MCP sessions.
 *
 * Fire-and-forget by design: this runs on the hot path of every authenticated request
 * and must NEVER raise into request handling or add latency. Throttled in SQL to at
 * most one write per session per 5 minutes, so a chatty MCP client does not turn every
 * read into a write.
 *
 * Reuses the existing pool — the Supabase connection budget is ~61 slots shared across
 * all fibreflow_user pools, so this module must not create its own.
 */
import { db } from '@/lib/db';
import { log } from '@/lib/logger';
import type { SessionKind } from './types';

const LOGGER = 'SessionUsage';

export function touchSessionUsage(sessionId: string, kind: SessionKind): void {
  if (kind !== 'mcp') return;

  void db
    .query(
      `UPDATE user_sessions
          SET last_used_at = NOW()
        WHERE id = $1
          AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '5 minutes')`,
      [sessionId]
    )
    .catch((err: unknown) => {
      log.debug(LOGGER, 'last_used_at update failed (ignored)', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth/__tests__/sessionUsage.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Call it from both auth paths**

In `src/lib/auth/app-router.ts::getUserFromRequest`, replace the final return with:

```ts
    const sessionKind = (row.kind ?? 'browser') as SessionKind;
    touchSessionUsage(payload.sessionId, sessionKind);
    return { ...row, sessionKind };
```

In `src/lib/auth/middleware.ts::getUserAndValidateSession`, add the same `touchSessionUsage(sessionId, kind)` call immediately before the object return, using the `sessionId` parameter and the kind resolved in Task 4 Step 7. Add the import to both files.

- [ ] **Step 6: Verify the throttle on dev**

```bash
bash scripts/deploy-local.sh dev
for i in 1 2 3; do curl -s -o /dev/null -H "Authorization: Bearer $TOKEN" \
  https://dev.fibreflow.app/api/projects; done
psql "$DATABASE_URL" -c "SELECT id, label, last_used_at FROM user_sessions WHERE kind='mcp';"
```
Expected: `last_used_at` is populated, and running the loop again immediately does **not** advance it (same 5-minute window).

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/sessionUsage.ts src/lib/auth/__tests__/sessionUsage.test.ts \
        src/lib/auth/app-router.ts src/lib/auth/middleware.ts
git commit -m "feat(auth): best-effort last_used_at tracking for mcp sessions"
```

---

### Task 8: DRY the login token-hash write

**Files:**
- Modify: `pages/api/auth/login.ts` (around lines 144–153)
- Modify: `pages/api/auth/setup-password.ts` (around lines 313–314)

**Interfaces:**
- Consumes: `setSessionTokenHash` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Replace the inline UPDATE in `login.ts`**

```ts
// before
    await sql`
      UPDATE user_sessions
      SET token_hash = encode(sha256(${finalToken}::bytea), 'hex')
      WHERE id = ${session.id}
    `;

// after
    await setSessionTokenHash(session.id, finalToken);
```

Add `setSessionTokenHash` to the existing `@/lib/auth` import.

- [ ] **Step 2: Fix `setup-password.ts`**

Read lines 305–325. It calls `createSession(user.id, '', ...)` then `signToken(user, session.id, '24h')`. Confirm whether it also writes the token hash. **If it does not, every session it issues is unusable by `withAuth` (which requires `s.token_hash` to match) — and, after Task 4, by the App Router too.** Make it:

```ts
    const session = await createSession(user.id, '', ipAddress, userAgent);
    const token = await signToken(user, session.id, '24h');
    await setSessionTokenHash(session.id, token);
```

If it already writes the hash inline, replace that block with the helper instead.

- [ ] **Step 3: Verify both flows on dev**

```bash
bash scripts/deploy-local.sh dev
```
Log out, log in through the browser on `dev.fibreflow.app`, and load one Pages Router page and one App Router page. Both must work with no 401. Then run a password-setup flow in dev and confirm the resulting session authenticates against both routers.

- [ ] **Step 4: Commit**

```bash
git add pages/api/auth/login.ts pages/api/auth/setup-password.ts
git commit -m "refactor(auth): use setSessionTokenHash in login and setup-password"
```

---

### Task 9: Connections UI

**Files:**
- Modify: the page and component currently hosting the Cortex MCP connect panel (located in Step 1)

**Interfaces:**
- Consumes: `POST/GET /api/me/mcp-tokens`, `DELETE /api/me/mcp-tokens/:id` (Task 6).

- [ ] **Step 1: Locate the existing panel**

```bash
grep -rn "mcp-token" --include="*.tsx" src/ app/ pages/ | grep -v node_modules
grep -rln "CortexConnect" --include="*.tsx" src/ app/ pages/ | grep -v node_modules
```
Note the file path and the component that renders the Cortex lifetime `<select>` and the show-once token display. Reuse its markup, styling and copy conventions rather than inventing new ones.

- [ ] **Step 2: Add a FibreFlow card beside the Cortex card**

Duplicate the Cortex card's structure with these differences:

- **Title:** `FibreFlow (read-only)`
- **Body copy:** *"Gives Claude read-only access to FibreFlow as you — the same projects, meetings and data you can see in the app, and nothing more. It cannot change anything."*
- **Lifetime `<select>`:** values `30d` / `90d` / `1y`, labelled `30 days` / `90 days` / `1 year`
- **Label input:** optional free text, `maxLength={60}`, placeholder `Claude desktop`
- **Mint:** `POST /api/me/mcp-tokens` with `{ lifetime, label }`
- **List:** `GET /api/me/mcp-tokens` on mount and after each mint/revoke
- **Table columns:** Label · Created · Last used · Expires · Revoke
- **Revoke:** `DELETE /api/me/mcp-tokens/${id}`, then refresh the list
- **Show-once banner:** *"Copy this now — it will not be shown again."*
- **Owner hint:** when the signed-in user's email is in `FF_OWNER_EMAILS`, render below the select: *"Owner tokens are capped at 90 days."* (The server enforces this regardless; the hint just avoids a confusing 400.)

- [ ] **Step 3: Verify the full flow on dev**

```bash
bash scripts/deploy-local.sh dev
```
In the browser: mint a token; confirm it displays once; reload and confirm the token value is gone but the row is listed; check `Last used` populates after a `curl`; revoke it; confirm a `curl` with that token now returns 401.

- [ ] **Step 4: Commit**

```bash
git add <the modified page and component>
git commit -m "feat(ui): FibreFlow read-only MCP token card on connections page"
```

---

## Definition of Done

- [ ] `GET /api/projects` with an MCP token → `200`
- [ ] `POST /api/projects` with the same token → `403` with code `MCP_READ_ONLY`
- [ ] `GET /api/meetings` with two different users' tokens → different result sets (participant scoping intact)
- [ ] Setting `users.is_active = false` → that user's MCP token 401s on the next request
- [ ] Deleting one session row → that token 401s; the user's other MCP tokens still work
- [ ] Browser "log out everywhere" → MCP sessions survive
- [ ] Owner requesting `1y` → `400` with the cap message, and no session row created
- [ ] `FF_MCP_TOKEN_UI_ENABLED` unset → all three endpoints `404`
- [ ] `npm run ci:quick` clean
- [ ] Task 4's diff reviewed via `/review` by a fresh reviewer with no session context

## Follow-on Work (not this plan)

1. **The MCP server** — tool surface over the read-only API; OAuth device flow so users never paste tokens by hand. Copy the flow from `Cortex/apps/cortex_mcp/server.py`.
2. **Admin token dashboard** — list and revoke MCP sessions across all users, mirroring `Cortex/docs/plans/cortex-mcp-token-lifetime-2026-07-11.md`.
3. **Narrow Cortex's SharePoint ingestion** — `SHAREPOINT_SITE_FILTER=velocity` currently matches `Velocity Finance`; the index holds named salary lines and cash-flow detail under path-derived channel keys with no Entra linkage. Unrelated to this plan, higher urgency.
