# User Impersonation Feature — Design Spec

**Date:** 2026-04-13  
**Status:** Approved  
**Author:** Hein van Vuuren (via brainstorming session)

---

## Overview

Allow privileged users (Hein and Zander) to impersonate any non-super_admin user from the Settings > Access Control > Users page. Opens a new browser tab logged in as the target user for debugging access and permission issues. Session is flagged as impersonation, time-limited to 1 hour, and fully audited.

---

## Approach

**Server-generated impersonation session.** The backend creates a real but short-lived session token for the target user, flagged as an impersonation session in the database. A one-time URL is returned, which the frontend opens in a new tab. That tab sets the auth cookie and redirects to `/`. No passwords are involved.

---

## Database Changes

### Migration: `user_sessions` table

```sql
ALTER TABLE user_sessions
  ADD COLUMN is_impersonation BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN impersonated_by UUID REFERENCES users(id);
```

- Impersonation sessions get a **1-hour TTL** (vs 24-hour normal sessions).
- `impersonated_by` stores the ID of the admin who initiated the session.
- All other session infrastructure (token hashing, validation, cleanup) is reused unchanged.

### Permission grant migration

One-time migration to grant `can_impersonate` permission to Hein and Zander by email:

```sql
UPDATE users
SET permissions = permissions || '["can_impersonate"]'::jsonb
WHERE email IN ('hein@velocityfibre.co.za', 'zander@velocityfibre.co.za');
```

---

## API

### `POST /api/admin/impersonate`

**Request body:**
```json
{ "targetUserId": "<uuid>" }
```

**Guards (in order):**
1. Caller must be authenticated (`withAuth`)
2. Caller must have `can_impersonate` in their permissions
3. Cannot impersonate yourself (`targetUserId !== callerId`)
4. Cannot impersonate a `super_admin` (prevents privilege escalation)

**Success flow:**
1. Fetch target user from DB — verify active, not super_admin
2. Create session in `user_sessions`:
   - `user_id = targetUserId`
   - `is_impersonation = true`
   - `impersonated_by = callerId`
   - `expires_at = NOW() + 1 hour`
3. Log to `user_audit_log`:
   - `action = 'impersonation_started'`
   - `target_user_id = targetUserId`
   - `performed_by = callerId`
4. Return: `{ url: '/auth/impersonate?token=<rawToken>' }`

**Error responses:**
- `403` — missing `can_impersonate` permission
- `400` — cannot impersonate yourself
- `400` — cannot impersonate a super_admin
- `404` — target user not found or inactive

---

## New Page: `/auth/impersonate`

**File:** `pages/auth/impersonate.tsx`

Server-side rendered (getServerSideProps). On load:
1. Reads `token` query param
2. Validates token against `user_sessions` (must exist, not expired, `is_impersonation=true`)
3. Sets `ff_auth_token` cookie (same flags as normal login: httpOnly, secure, sameSite=lax)
4. Redirects to `/`

If token is invalid/expired: redirect to `/login?error=invalid_impersonation_token`

---

## UI Changes

### `src/components/settings/AccessControlTab.tsx`

**Impersonate button:**
- Added to the far right of the Actions column: `Full Access` | `Permissions` | `Impersonate`
- Styled: indigo/purple ghost button, user-swap icon
- **Only renders** when the current user has `can_impersonate` in their permissions
- On click: POST to `/api/admin/impersonate`, then `window.open(url, '_blank')`
- Disabled + spinner while request is in-flight
- Hidden for super_admin rows (cannot impersonate super_admins)

### Impersonation banner

A sticky orange warning bar rendered in the main `AppLayout` component when the active session has `isImpersonation=true` (read from JWT payload):

```
⚠ Impersonating: John Smith (john@velocityfibre.co.za) — Close this tab to end session
```

- Always visible, non-dismissable
- Reads name + email from JWT fields
- No "end session" button — closing the tab is sufficient; the 1-hour TTL handles DB cleanup

---

## JWT Payload Changes

Add two fields to the token generated for impersonation sessions:

```typescript
{
  sub: targetUserId,
  email: targetEmail,
  role: targetRole,
  sessionId: sessionId,
  isImpersonation: true,         // new
  impersonatedBy: callerUserId,  // new
  iat: ...,
  exp: NOW + 3600
}
```

The banner reads `isImpersonation` from the decoded JWT via the existing session context.

---

## Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Privilege escalation | Cannot impersonate super_admins |
| Self-impersonation | Blocked at API level |
| Token reuse | Token is a real session — valid for 1 hour, then expires |
| Auditability | Every impersonation start logged to `user_audit_log` |
| Accidental confusion | Banner always visible during impersonation |
| Broad access | `can_impersonate` permission required; granted to 2 users only |

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `pages/api/admin/impersonate.ts` | Create — new API endpoint |
| `pages/auth/impersonate.tsx` | Create — token-to-cookie redirect page |
| `src/components/settings/AccessControlTab.tsx` | Modify — add Impersonate button |
| `src/components/AppLayout.tsx` | Modify — add impersonation banner |
| `src/lib/auth/jwt.ts` | Modify — add `isImpersonation` + `impersonatedBy` to token payload type |
| `src/lib/auth/session.ts` | Modify — support creating impersonation sessions |
| `migrations/XXX_add_impersonation_to_sessions.sql` | Create — DB migration |
| `migrations/XXX_grant_impersonate_permission.sql` | Create — permission grant |

---

## Out of Scope

- Ending an impersonation session mid-session (close tab = end session)
- Listing active impersonation sessions in the UI
- Impersonating super_admins under any circumstance
- Time extension beyond 1 hour
