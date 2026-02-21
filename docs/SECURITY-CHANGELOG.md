# Security Changelog

> Track security-related changes, hardening measures, and vulnerability fixes

**Last Updated:** 2026-02-21

---

## [2026-02-21] Auth Isolation Sweep — 11 Endpoints Fixed

### User Identity Isolation
- **Reminders (5 endpoints):** `/api/reminders`, `/api/reminders-update`, `/api/reminders-delete`, `/api/reminder-preferences`, `/api/user-sidebar-preferences` — all were hardcoding `userId = 'dev-user-1'` despite `withAuth` being present. All authenticated users shared a single preference/reminder row. Fixed to use `req.user.id` from JWT auth context.
- **Suppliers — Privilege Escalation (4 endpoints):** `/api/suppliers`, `/api/suppliers/[supplierId]` (PUT+DELETE), `/api/suppliers/[supplierId]/ratings`, `/api/suppliers/[supplierId]/compliance` — `userId` was accepted from `req.body`, allowing any authenticated user to act as any other user in supplier CRUD. Fixed to use `req.user.id` only.
- **Supplier Ratings:** `userName` also accepted from body — now uses `req.user.name`.
- **Staff Document Audit Trail (2 endpoints):** `/api/staff-documents-upload`, `/api/staff-documents-download` — audit log was recording `'System'` as actor. Fixed to use `req.user.name`.

### Root Cause
All affected endpoints used `withAuth` correctly for authentication enforcement but ignored the attached `req.user` context inside the handler body.

### Commits
- `c20d5899` — reminders + sidebar preferences (3 files)
- `eee9f624` — reminders list/delete + suppliers (6 files)
- `bdd29cc6` — staff document audit names (2 files)

---

## [2026-02-20] Security Hardening Phase 1 & 2

### Authentication Hardening
- **User Enumeration Prevention:** Disabled accounts now return same 401 response as invalid credentials (prevents account discovery)
- **Default Role Security:** New users default to `viewer` role instead of elevated permissions
- **Bootstrap Protection:** First-user admin elevation requires explicit `BOOTSTRAP_SUPER_ADMIN=true` environment flag
- **JWT Payload Reduction:** Removed permissions from JWT tokens; now fetched from DB via middleware (prevents stale permission abuse)
- **Crypto Upgrade:** Password generation uses `crypto.randomInt()` instead of `Math.random()` (cryptographically secure)
- **Role Hierarchy:** Added `storeman` role to RBAC system

### CORS Hardening
- **Development-Only Localhost:** Restricted `localhost` origins to development mode only (prevents local proxy attacks in production)

### API Security
- **Chat Access Control:** `/api/chat/access` now uses `withAuth` middleware instead of query param `userId` (prevents parameter injection)
- **QField Auth Enforcement:** `/api/qfield/validate-photo` requires `QFIELD_PLUGIN_API_KEY` environment variable with no fallback (enforces API key usage)
- **Import Safety:** Forgot-password route uses dynamic import instead of `eval('require')` (prevents code injection)

### Transport Security
- **SMTP TLS Default:** `rejectUnauthorized` now defaults to `true` for SMTP connections (prevents MITM attacks; opt-out via env)

### Database Security
- **Query Safety:** Procurement cost-center allocations use explicit query branches instead of string concatenation (prevents SQL injection)

### Code Quality
- **Empty Catch Blocks:** Removed or logged empty catch blocks across codebase (prevents silent failures)
- **HMAC Portal Tokens:** Field portal tokens now use HMAC signing
- **CSP Headers:** Added Content Security Policy headers
- **Secrets Rotation:** OneMap API secrets rotated and stored securely

---

## Auth Isolation Sweep — Feb 21, 2026

### Hardcoded userId / Privilege Escalation Fixes
**Severity:** High — clients could pass arbitrary userId in request body

**Affected endpoints (now fixed):**
- `GET/POST/DELETE /api/reminders` — hardcoded `'dev-user-1'` removed
- `POST/PUT/DELETE /api/suppliers` — userId from `req.body` replaced with `req.user.id`
- `PUT/DELETE /api/suppliers/ratings` — same fix
- `POST /api/suppliers/compliance` — same fix
- Sidebar and other reminder endpoints — userId wired from `withAuth` context

**Root cause:** During development, `userId` was read from `req.body` (caller-supplied) instead of from the authenticated session. An authenticated user could supply any userId to act on behalf of others.

**Fix:** All affected routes now use `(req as any).user?.id` from `withAuth` middleware. The client can no longer influence which user's data is modified.

---

## Related Commits
- `397caa84` - fix: security hardening — auth, CORS, RBAC, and API safety improvements
- `d811f17f` - fix: security hardening phase 2 — empty catches, HMAC portal tokens, CSP, OneMap secrets
- `cf219ca5` - fix: procurement audit — critical security, SQL, and link fixes
- `19a8361d` - Merge pull request #47 from VelocityFibre/fix/security-hardening
- `c20d5899` - fix(auth): wire real user ID into sidebar/reminder endpoints
- `eee9f624` - fix(auth): remove hardcoded userId from supplier + reminder endpoints

---

## Security Contacts
- **Security Lead:** Hein (CEO)
- **CTO:** Elon
- **DevOps:** Forge

For security issues, report immediately via Mission Control (type: urgent, to: jarvis).
