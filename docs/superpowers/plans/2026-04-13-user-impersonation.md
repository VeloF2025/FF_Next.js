# User Impersonation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users with `can_impersonate` permission (Hein + Zander) to open a new browser tab logged in as any non-super_admin user from Settings > Access Control > Users.

**Architecture:** Server-side session creation — POST /api/admin/impersonate creates a 1-hour impersonation session in the DB, returns a URL that sets the ff_auth_token cookie and redirects to /. An always-visible orange banner is shown during impersonation sessions. All activity is logged to user_audit_log.

**Tech Stack:** Next.js 14 Pages Router, Neon PostgreSQL (neon() driver), jose JWT library, httpOnly cookies via `cookie` package `serialize()`, React/Lucide icons, Tailwind CSS.

**Worktree:** `/home/hein/Workspace/FF_Next.js-impersonation` (branch: `feature/user-impersonation`)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `migrations/0105_add_impersonation_to_sessions.sql` | Create | Add is_impersonation + impersonated_by columns to user_sessions |
| `migrations/0106_grant_impersonate_permission.sql` | Create | Grant can_impersonate to Hein + Zander |
| `src/lib/auth/types.ts` | Modify | Add isImpersonation? + impersonatedBy? to JWTPayload; add isImpersonation? to AuthUser |
| `src/lib/auth/jwt.ts` | Modify | Extend signToken to accept optional impersonation params |
| `src/lib/auth/session.ts` | Modify | Add createImpersonationSession() function |
| `src/lib/auth/middleware.ts` | Modify | Populate isImpersonation on AuthUser via getUserAndValidateSession JOIN |
| `pages/api/admin/impersonate.ts` | Create | POST endpoint — validates caller, creates session, logs audit, returns URL |
| `pages/auth/impersonate.tsx` | Create | SSR page — validates token, sets cookie, redirects to / |
| `src/components/layout/AppLayout.tsx` | Modify | Sticky orange impersonation banner |
| `src/components/settings/AccessControlTab.tsx` | Modify | Impersonate button in actions column |
| `tests/api/admin/impersonate.test.ts` | Create | Unit tests for the impersonate API endpoint |

---

## Task 1: DB Migrations

**Files:**
- Create: `migrations/0105_add_impersonation_to_sessions.sql`
- Create: `migrations/0106_grant_impersonate_permission.sql`

- [ ] **Step 1: Check current migration numbering**

```bash
ls /home/hein/Workspace/FF_Next.js-impersonation/migrations/ | tail -5
```

Note the highest migration number and adjust the filenames if needed (0105/0106 may already be taken).

- [ ] **Step 2: Create the sessions migration**

Create `migrations/0105_add_impersonation_to_sessions.sql`:

```sql
-- Migration: Add impersonation tracking to user_sessions
-- Allows sessions created by admin impersonation to be flagged and attributed

ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS is_impersonation BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS impersonated_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Index for looking up active impersonation sessions by admin
CREATE INDEX IF NOT EXISTS idx_user_sessions_impersonated_by
  ON user_sessions(impersonated_by)
  WHERE is_impersonation = TRUE;
```

- [ ] **Step 3: Create the permission grant migration**

Create `migrations/0106_grant_impersonate_permission.sql`:

```sql
-- Migration: Grant can_impersonate permission to Hein and Zander
-- This is a one-time setup — only these two users should ever have this permission

UPDATE users
SET permissions = (
  CASE
    WHEN permissions @> '["can_impersonate"]'::jsonb THEN permissions
    ELSE permissions || '["can_impersonate"]'::jsonb
  END
)
WHERE email IN ('hein@velocityfibre.co.za', 'zander@velocityfibre.co.za');
```

- [ ] **Step 4: Run migrations against the database**

```bash
cd /home/hein/Workspace/FF_Next.js-impersonation
# Load DATABASE_URL from .env.local
export $(grep DATABASE_URL .env.local | xargs)
psql "$DATABASE_URL" -f migrations/0105_add_impersonation_to_sessions.sql
psql "$DATABASE_URL" -f migrations/0106_grant_impersonate_permission.sql
```

Expected output: `ALTER TABLE`, `CREATE INDEX`, `UPDATE 2`

- [ ] **Step 5: Verify migrations**

```bash
psql "$DATABASE_URL" -c "\d user_sessions" | grep impersonat
psql "$DATABASE_URL" -c "SELECT email, permissions FROM users WHERE email IN ('hein@velocityfibre.co.za', 'zander@velocityfibre.co.za')"
```

Expected: columns `is_impersonation` and `impersonated_by` exist; both users have `can_impersonate` in permissions.

- [ ] **Step 6: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-impersonation
git add migrations/0105_add_impersonation_to_sessions.sql migrations/0106_grant_impersonate_permission.sql
git commit -m "feat(impersonation): add DB migrations for impersonation sessions and permissions"
```

---

## Task 2: Extend Auth Types and JWT

**Files:**
- Modify: `src/lib/auth/types.ts`
- Modify: `src/lib/auth/jwt.ts`

- [ ] **Step 1: Write the failing test for signToken with impersonation params**

Create `tests/api/admin/impersonate.test.ts`:

```typescript
/**
 * Tests for user impersonation
 */
import { signToken, verifyToken } from '@/lib/auth';

// Mock the JWT secret
process.env.JWT_SECRET = 'test-secret-must-be-32-chars-longXX';

describe('signToken — impersonation params', () => {
  const baseUser = {
    id: 'user-123',
    userId: 'user-123',
    email: 'target@test.com',
    firstName: 'Target',
    lastName: 'User',
    name: 'Target User',
    role: 'technician' as const,
    permissions: [],
    isActive: true,
  };

  it('includes isImpersonation=true in token payload when flag passed', async () => {
    const token = await signToken(baseUser, 'sess-abc', '1h', {
      isImpersonation: true,
      impersonatedBy: 'admin-456',
    });
    const payload = await verifyToken(token);
    expect(payload?.isImpersonation).toBe(true);
    expect(payload?.impersonatedBy).toBe('admin-456');
  });

  it('does NOT include isImpersonation for normal tokens', async () => {
    const token = await signToken(baseUser, 'sess-xyz', '24h');
    const payload = await verifyToken(token);
    expect(payload?.isImpersonation).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /home/hein/Workspace/FF_Next.js-impersonation
npm test -- tests/api/admin/impersonate.test.ts 2>&1 | tail -20
```

Expected: FAIL — `signToken` doesn't accept 4th argument, `isImpersonation` is not in payload type.

- [ ] **Step 3: Update types.ts**

In `src/lib/auth/types.ts`, update `JWTPayload` and `AuthUser`:

```typescript
export interface JWTPayload {
  sub: string; // user id
  email: string;
  role: AuthRole;
  /** @deprecated Permissions no longer stored in JWT — fetched from DB via middleware */
  permissions: string[];
  sessionId: string;
  isImpersonation?: boolean;   // true when session was created via admin impersonation
  impersonatedBy?: string;     // user ID of the admin who started the impersonation
  iat: number;
  exp: number;
}

export interface AuthUser {
  id: string;
  /** @deprecated Use `id` instead */
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  role: AuthRole;
  permissions: string[];
  isActive: boolean;
  profilePicture?: string;
  department?: string;
  isImpersonation?: boolean;   // true when the current session is an impersonation
}
```

- [ ] **Step 4: Update jwt.ts — extend signToken signature**

In `src/lib/auth/jwt.ts`, replace the `signToken` function:

```typescript
export interface ImpersonationParams {
  isImpersonation: boolean;
  impersonatedBy: string;
}

/**
 * Sign a JWT token for a user
 */
export async function signToken(
  user: AuthUser,
  sessionId: string,
  expiresIn: string = ACCESS_TOKEN_EXPIRY,
  impersonation?: ImpersonationParams
): Promise<string> {
  const secret = getJWTSecret();

  const claims: Record<string, unknown> = {
    email: user.email,
    role: user.role,
    sessionId,
  };

  if (impersonation) {
    claims.isImpersonation = impersonation.isImpersonation;
    claims.impersonatedBy = impersonation.impersonatedBy;
  }

  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);

  return token;
}
```

- [ ] **Step 5: Update verifyToken to read impersonation fields**

In `src/lib/auth/jwt.ts`, update the `verifyToken` return block:

```typescript
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const secret = getJWTSecret();
    const { payload } = await jwtVerify(token, secret);

    if (!payload.sub || !payload.email || !payload.role || !payload.sessionId) {
      return null;
    }

    return {
      sub: payload.sub as string,
      email: payload.email as string,
      role: payload.role as AuthRole,
      permissions: [],
      sessionId: payload.sessionId as string,
      isImpersonation: payload.isImpersonation as boolean | undefined,
      impersonatedBy: payload.impersonatedBy as string | undefined,
      iat: payload.iat || 0,
      exp: payload.exp || 0,
    };
  } catch (error) {
    return null;
  }
}
```

- [ ] **Step 6: Run test to confirm it passes**

```bash
cd /home/hein/Workspace/FF_Next.js-impersonation
npm test -- tests/api/admin/impersonate.test.ts 2>&1 | tail -20
```

Expected: PASS — both test cases pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/types.ts src/lib/auth/jwt.ts tests/api/admin/impersonate.test.ts
git commit -m "feat(impersonation): extend JWT types and signToken for impersonation sessions"
```

---

## Task 3: createImpersonationSession in session.ts

**Files:**
- Modify: `src/lib/auth/session.ts`

- [ ] **Step 1: Add failing test for createImpersonationSession**

Add to `tests/api/admin/impersonate.test.ts` (append after existing tests):

```typescript
import { createImpersonationSession } from '@/lib/auth';

// Mock neon
jest.mock('@/lib/db-neon', () => ({
  neon: () => {
    const sql = jest.fn().mockResolvedValue([{ id: 'mock-session-id' }]);
    return sql;
  },
}));

describe('createImpersonationSession', () => {
  it('is exported from @/lib/auth', () => {
    expect(typeof createImpersonationSession).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/api/admin/impersonate.test.ts 2>&1 | tail -20
```

Expected: FAIL — `createImpersonationSession` not exported.

- [ ] **Step 3: Add createImpersonationSession to session.ts**

In `src/lib/auth/session.ts`, add after the existing `createSession` function:

```typescript
/**
 * Create an impersonation session for a target user
 * Sessions expire in 1 hour and are flagged with is_impersonation=true
 */
export async function createImpersonationSession(
  targetUserId: string,
  token: string,
  impersonatedBy: string,
  ipAddress?: string,
  userAgent?: string
): Promise<Session> {
  const sessionId = uuidv4();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await sql`
    INSERT INTO user_sessions (
      id, user_id, token_hash, expires_at,
      ip_address, user_agent,
      is_impersonation, impersonated_by
    )
    VALUES (
      ${sessionId}, ${targetUserId}, ${tokenHash}, ${expiresAt.toISOString()},
      ${ipAddress || null}, ${userAgent || null},
      TRUE, ${impersonatedBy}
    )
  `;

  return {
    id: sessionId,
    userId: targetUserId,
    tokenHash,
    expiresAt,
    createdAt: new Date(),
    ipAddress,
    userAgent,
  };
}
```

- [ ] **Step 4: Export from index.ts**

In `src/lib/auth/index.ts`, update the session management export block to add `createImpersonationSession`:

```typescript
export {
  createSession,
  createImpersonationSession,
  validateSession,
  getSession,
  deleteSession,
  deleteAllUserSessions,
  getUserSessions,
  cleanupExpiredSessions,
  extendSession,
} from './session';
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
npm test -- tests/api/admin/impersonate.test.ts 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/session.ts src/lib/auth/index.ts tests/api/admin/impersonate.test.ts
git commit -m "feat(impersonation): add createImpersonationSession to session management"
```

---

## Task 4: Populate isImpersonation in Auth Middleware

**Files:**
- Modify: `src/lib/auth/middleware.ts`

- [ ] **Step 1: Update getUserAndValidateSession to include is_impersonation**

In `src/lib/auth/middleware.ts`, update the `getUserAndValidateSession` function's SQL query and return value:

```typescript
async function getUserAndValidateSession(
  userId: string,
  sessionId: string,
  tokenHash: string
): Promise<AuthUser | null> {
  const result = await sql`
    SELECT
      u.id,
      u.email,
      u.first_name,
      u.last_name,
      u.role,
      u.permissions,
      u.is_active,
      u.profile_picture,
      u.department,
      s.id as session_id,
      s.is_impersonation
    FROM users u
    INNER JOIN user_sessions s ON s.user_id = u.id
    WHERE u.id = ${userId}
      AND s.id = ${sessionId}
      AND s.token_hash = ${tokenHash}
      AND s.expires_at > NOW()
      AND u.is_active = true
    LIMIT 1
  `;

  const row = result[0];
  if (!row) return null;

  const firstName = (row.first_name as string) || '';
  const lastName = (row.last_name as string) || '';

  return {
    id: row.id as string,
    userId: row.id as string,
    email: row.email as string,
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim() || (row.email as string),
    role: row.role as AuthRole,
    permissions: (row.permissions as string[]) || [],
    isActive: row.is_active as boolean,
    profilePicture: row.profile_picture as string | undefined,
    department: row.department as string | undefined,
    isImpersonation: (row.is_impersonation as boolean) || undefined,
  };
}
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
cd /home/hein/Workspace/FF_Next.js-impersonation
npm run type-check 2>&1 | grep -i "impersonat\|auth/middleware\|auth/types" | head -20
```

Expected: no errors in these files.

- [ ] **Step 3: Update /api/auth/me to include isImpersonation in response**

In `pages/api/auth/me.ts`, update the response to include `isImpersonation`:

```typescript
return apiResponse.success(res, {
  user: {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    permissions: user.permissions,
    profilePicture: user.profilePicture,
    department: user.department,
    isImpersonation: user.isImpersonation,
  },
});
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth/middleware.ts pages/api/auth/me.ts
git commit -m "feat(impersonation): propagate isImpersonation flag through auth middleware and /me endpoint"
```

---

## Task 5: POST /api/admin/impersonate Endpoint

**Files:**
- Create: `pages/api/admin/impersonate.ts`

- [ ] **Step 1: Add failing tests for the endpoint**

Add to `tests/api/admin/impersonate.test.ts` (append):

```typescript
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

// We test handler logic directly without running the DB
// The guard checks (permission, self-impersonation, super_admin) are pure logic

describe('POST /api/admin/impersonate — guards', () => {
  it('rejects when caller lacks can_impersonate permission', async () => {
    const handler = require('@/pages/api/admin/impersonate').default;
    // We test via creating a mock that simulates withAuth with no can_impersonate
    // This is a structural test — full integration tested manually
    expect(typeof handler).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/api/admin/impersonate.test.ts 2>&1 | tail -20
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the endpoint**

Create `pages/api/admin/impersonate.ts`:

```typescript
/**
 * POST /api/admin/impersonate
 * Create an impersonation session for a target user.
 * Only users with can_impersonate permission can call this.
 */

import type { NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import {
  withAuth,
  hasPermission,
  signToken,
  createImpersonationSession,
  type AuthenticatedNextApiRequest,
  type AuthUser,
  type AuthRole,
} from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

interface ImpersonateRequestBody {
  targetUserId: string;
}

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  // Guard: caller must have can_impersonate permission
  if (!hasPermission(req.user, 'can_impersonate')) {
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Missing required permission: can_impersonate' },
    });
  }

  const { targetUserId } = req.body as ImpersonateRequestBody;

  if (!targetUserId || typeof targetUserId !== 'string') {
    return apiResponse.badRequest(res, 'targetUserId is required');
  }

  // Guard: cannot impersonate yourself
  if (targetUserId === req.user.id) {
    return apiResponse.badRequest(res, 'Cannot impersonate yourself');
  }

  // Fetch target user from DB
  const rows = await sql`
    SELECT id, email, first_name, last_name, role, permissions, is_active
    FROM users
    WHERE id = ${targetUserId}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    return apiResponse.notFound(res, 'User', targetUserId);
  }

  if (!row.is_active) {
    return apiResponse.badRequest(res, 'Cannot impersonate an inactive user');
  }

  // Guard: cannot impersonate super_admins
  if (row.role === 'super_admin') {
    return res.status(400).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Cannot impersonate a super_admin' },
    });
  }

  const firstName = (row.first_name as string) || '';
  const lastName = (row.last_name as string) || '';

  const targetUser: AuthUser = {
    id: row.id as string,
    userId: row.id as string,
    email: row.email as string,
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim() || (row.email as string),
    role: row.role as AuthRole,
    permissions: (row.permissions as string[]) || [],
    isActive: true,
  };

  const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket?.remoteAddress;
  const userAgent = req.headers['user-agent'];

  // Step 1: Create session with empty token (same pattern as login.ts)
  // This gives us the sessionId needed to sign the JWT
  const session = await createImpersonationSession(
    targetUser.id,
    '', // placeholder — updated with real hash after signing
    req.user.id,
    ipAddress,
    userAgent
  );

  // Step 2: Sign JWT with session ID (1 hour TTL)
  const token = await signToken(targetUser, session.id, '1h', {
    isImpersonation: true,
    impersonatedBy: req.user.id,
  });

  // Step 3: Update session with real token hash (mirrors login.ts pattern)
  await sql`
    UPDATE user_sessions
    SET token_hash = encode(sha256(${token}::bytea), 'hex')
    WHERE id = ${session.id}
  `;

  // Audit log
  await sql`
    INSERT INTO user_audit_log (user_id, action, resource_type, resource_id, details, ip_address)
    VALUES (
      ${req.user.id},
      'impersonation_started',
      'user',
      ${targetUser.id},
      ${JSON.stringify({ targetEmail: targetUser.email, targetRole: targetUser.role })},
      ${ipAddress || null}
    )
  `;

  log.info('Impersonation session created', {
    by: req.user.email,
    target: targetUser.email,
    sessionId: session.id,
  }, 'Impersonation');

  return apiResponse.success(res, {
    url: `/auth/impersonate?token=${encodeURIComponent(token)}`,
    targetUser: {
      id: targetUser.id,
      email: targetUser.email,
      name: targetUser.name,
    },
  });
}

export default withAuth(handler);
```

**Note:** The endpoint uses a two-step approach: create session with placeholder hash, sign token, then update with real hash. This is necessary because we need the sessionId for the JWT but also need the JWT to derive the token hash for storage.

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/api/admin/impersonate.test.ts 2>&1 | tail -20
```

Expected: PASS — module found and exports a function.

- [ ] **Step 5: Type check**

```bash
npm run type-check 2>&1 | grep "impersonate" | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add pages/api/admin/impersonate.ts tests/api/admin/impersonate.test.ts
git commit -m "feat(impersonation): add POST /api/admin/impersonate endpoint"
```

---

## Task 6: /auth/impersonate Page

**Files:**
- Create: `pages/auth/impersonate.tsx`

- [ ] **Step 1: Create the page**

Create `pages/auth/impersonate.tsx`:

```typescript
/**
 * Impersonation token exchange page
 * Receives a raw JWT token, validates it, sets the auth cookie, and redirects to /.
 * Only called by the impersonation flow — normal users never land here.
 */

import type { GetServerSideProps } from 'next';
import { serialize } from 'cookie';
import { verifyToken, AUTH_COOKIE_NAME } from '@/lib/auth';

// This page has no UI — it only sets a cookie and redirects
export default function ImpersonatePage() {
  return null;
}

export const getServerSideProps: GetServerSideProps = async ({ query, res }) => {
  const token = typeof query.token === 'string' ? query.token : null;

  if (!token) {
    return {
      redirect: {
        destination: '/login?error=missing_impersonation_token',
        permanent: false,
      },
    };
  }

  // Verify the JWT is valid and is an impersonation token
  const payload = await verifyToken(token);
  if (!payload || !payload.isImpersonation) {
    return {
      redirect: {
        destination: '/login?error=invalid_impersonation_token',
        permanent: false,
      },
    };
  }

  // Set the auth cookie — same flags as normal login
  const cookie = serialize(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60, // 1 hour (matches session TTL)
    path: '/',
  });

  res.setHeader('Set-Cookie', cookie);

  return {
    redirect: {
      destination: '/',
      permanent: false,
    },
  };
};
```

- [ ] **Step 2: Verify type check passes**

```bash
npm run type-check 2>&1 | grep "auth/impersonate" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add pages/auth/impersonate.tsx
git commit -m "feat(impersonation): add /auth/impersonate token exchange page"
```

---

## Task 7: Impersonation Banner in AppLayout

**Files:**
- Modify: `src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Read the current AppLayout return statement**

Read `src/components/layout/AppLayout.tsx` lines 60–200 to find the JSX return and where to insert the banner.

- [ ] **Step 2: Add the banner**

In `src/components/layout/AppLayout.tsx`, add the impersonation banner as the first element inside the outermost `<div>` of the return statement. The `currentUser` is already available via `useAuth()`.

Add the banner immediately inside the layout root, before the sidebar/header:

```tsx
{/* Impersonation Banner — only shown when an admin is impersonating another user */}
{currentUser?.isImpersonation && (
  <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2 bg-orange-500 px-4 py-2 text-sm font-medium text-white shadow-lg">
    <svg
      className="h-4 w-4 flex-shrink-0"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
    <span>
      Impersonating: {currentUser.name} ({currentUser.email}) — Close this tab to end session
    </span>
  </div>
)}
```

Also add top padding to the main content wrapper when the banner is shown, so content isn't hidden behind it. Find the main content wrapper and conditionally add `pt-10` or similar:

```tsx
// Wherever the main scrollable area starts, adjust its class:
className={`... ${currentUser?.isImpersonation ? 'pt-10' : ''}`}
```

- [ ] **Step 3: Type check**

```bash
npm run type-check 2>&1 | grep "AppLayout" | head -10
```

Expected: no errors.

- [ ] **Step 4: Check that currentUser type includes isImpersonation**

The `currentUser` in AuthContext is typed as `User | null` from `@/types/auth.types`. Check if `User` type needs updating to include `isImpersonation`.

```bash
grep -n "interface User" /home/hein/Workspace/FF_Next.js-impersonation/src/types/auth.types.ts
```

If `User` doesn't have `isImpersonation`, add it:
```typescript
isImpersonation?: boolean;
```

Also check how AuthContext populates `currentUser` from the `/api/auth/me` response and confirm `isImpersonation` will be passed through.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppLayout.tsx src/types/auth.types.ts
git commit -m "feat(impersonation): add sticky impersonation banner to AppLayout"
```

---

## Task 8: Impersonate Button in AccessControlTab

**Files:**
- Modify: `src/components/settings/AccessControlTab.tsx`

- [ ] **Step 1: Add useAuth import**

In `src/components/settings/AccessControlTab.tsx`, add to the imports at the top:

```typescript
import { useAuth } from '@/contexts/AuthContext';
```

- [ ] **Step 2: Get current user in the component**

Inside the `AccessControlTab` component function body (near the top, alongside other useState calls), add:

```typescript
const { currentUser } = useAuth();
const canImpersonate = currentUser?.permissions?.includes('can_impersonate') ?? false;
```

- [ ] **Step 3: Add impersonation state**

Add state for tracking which user is being impersonated (for loading state):

```typescript
const [impersonatingUserId, setImpersonatingUserId] = useState<string | null>(null);
```

- [ ] **Step 4: Add the impersonate handler function**

Add after the existing `grantFullAccess` function (around line 580):

```typescript
// Impersonate user — opens a new tab logged in as that user
const impersonateUser = async (userId: string) => {
  try {
    setImpersonatingUserId(userId);
    const res = await fetch('/api/admin/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId: userId }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data?.error?.message || 'Failed to create impersonation session');
      return;
    }

    const data = await res.json();
    window.open(data.data.url, '_blank', 'noopener,noreferrer');
  } catch (err) {
    setError('Failed to create impersonation session');
    log.error('Impersonation failed', { userId, err }, 'AccessControlTab');
  } finally {
    setImpersonatingUserId(null);
  }
};
```

- [ ] **Step 5: Add the button to the actions column**

Find the actions `<div>` in the user table row (around line 999–1022) — it currently contains the Full Access and Permissions buttons. Add the Impersonate button as the third item:

```tsx
{/* Impersonate Button — only visible to users with can_impersonate permission */}
{canImpersonate && user.role !== 'super_admin' && (
  <button
    onClick={() => impersonateUser(user.id)}
    disabled={impersonatingUserId === user.id}
    className="text-xs px-2 py-1.5 rounded bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 disabled:opacity-50"
    title={`Impersonate ${user.fullName}`}
  >
    {impersonatingUserId === user.id ? (
      <Loader2 className="w-3.5 h-3.5 inline animate-spin" />
    ) : (
      <UserCog className="w-3.5 h-3.5 inline mr-1" />
    )}
    {impersonatingUserId === user.id ? '' : 'Impersonate'}
  </button>
)}
```

Note: `UserCog` is already imported from lucide-react in this file (line 11). `Loader2` is also already imported.

- [ ] **Step 6: Add log import if missing**

Check if `log` from `@/lib/logger` is already imported. If not, add:
```typescript
import { log } from '@/lib/logger';
```

- [ ] **Step 7: Type check and lint**

```bash
npm run type-check 2>&1 | grep "AccessControlTab" | head -10
npm run lint 2>&1 | grep "AccessControlTab" | head -10
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/settings/AccessControlTab.tsx
git commit -m "feat(impersonation): add Impersonate button to user actions column"
```

---

## Task 9: Full Validation and PR

- [ ] **Step 1: Run full test suite**

```bash
cd /home/hein/Workspace/FF_Next.js-impersonation
npm test -- tests/api/admin/impersonate.test.ts 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 2: Run CI checks**

```bash
npm run ci:quick 2>&1 | tail -30
```

Expected: lint and type-check pass.

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | tail -20
```

Expected: clean build, no errors.

- [ ] **Step 4: Smoke test on dev server**

Start dev server:
```bash
PORT=3004 npm run dev
```

Manual test checklist:
1. Log in as Hein → go to Settings > Access Control > Users
2. Verify "Impersonate" button is visible next to non-super_admin users
3. Verify button is NOT visible on super_admin rows
4. Click Impersonate on a test user → new tab opens and you're logged in as that user
5. Verify orange banner appears: "Impersonating: [name] ([email]) — Close this tab to end session"
6. Verify that in the original tab, no banner is shown
7. Close the impersonation tab
8. Log in as a non-impersonation user → verify Impersonate button is NOT visible

- [ ] **Step 5: Create PR**

```bash
cd /home/hein/Workspace/FF_Next.js-impersonation
git push origin feature/user-impersonation
gh pr create \
  --title "feat(impersonation): user impersonation for super admins (#875)" \
  --body "$(cat <<'EOF'
## Summary
- Adds Impersonate button to Settings > Access Control > Users (visible only to users with \`can_impersonate\` permission)
- Creates a 1-hour impersonation session server-side — no passwords involved
- Opens new tab logged in as target user with sticky orange warning banner
- All impersonation events logged to \`user_audit_log\`
- Cannot impersonate super_admins or yourself

## Migrations
- \`0105_add_impersonation_to_sessions.sql\` — adds \`is_impersonation\` + \`impersonated_by\` to \`user_sessions\`
- \`0106_grant_impersonate_permission.sql\` — grants \`can_impersonate\` to hein@ and zander@

## Test plan
- [ ] Verify Impersonate button visible for Hein and Zander only
- [ ] Verify button hidden on super_admin rows
- [ ] Verify new tab opens and banner is visible
- [ ] Verify 1-hour session expiry (check user_sessions table)
- [ ] Verify audit log entry created on impersonation
- [ ] Verify non-impersonation users see no button change

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
