# Security Changelog

> Track security-related changes, hardening measures, and vulnerability fixes

**Last Updated:** 2026-02-20

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

## Related Commits
- `397caa84` - fix: security hardening — auth, CORS, RBAC, and API safety improvements
- `d811f17f` - fix: security hardening phase 2 — empty catches, HMAC portal tokens, CSP, OneMap secrets
- `cf219ca5` - fix: procurement audit — critical security, SQL, and link fixes
- `19a8361d` - Merge pull request #47 from VelocityFibre/fix/security-hardening

---

## Security Contacts
- **Security Lead:** Hein (CEO)
- **CTO:** Elon
- **DevOps:** Forge

For security issues, report immediately via Mission Control (type: urgent, to: jarvis).
