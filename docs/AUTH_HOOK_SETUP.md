# Pre-Commit Auth Vulnerability Hook Setup

**Purpose:** Prevent commits containing `req.body.userId` auth vulnerability pattern  
**Status:** Ready to deploy  
**Effort:** 2 minutes per developer  

---

## Quick Install

```bash
# In the FibreFlow repository root
cp /home/hein/.openclaw/flow/workspace/scripts/pre-commit-auth-check.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

## Verify Installation

```bash
ls -la .git/hooks/pre-commit
# Should show: -rwxr-xr-x (executable)

# Test the hook (will pass if no violations)
git commit --allow-empty -m "test: auth hook verification"
```

## How It Works

### On Every Commit

The hook:
1. Scans all staged API files (`pages/api/**/*.ts`)
2. Checks for dangerous patterns:
   - `req.body.userId`
   - `req.body.user`
   - `req.body.uid`
   - `req.body.id`
3. **Blocks commit if violations found** with helpful error message
4. **Allows commit if clean** (silent success)

### Example: Blocked Commit

```
🔒 Auth vulnerability check (pre-commit)
Scanning staged API files for dangerous patterns...

❌ SECURITY VIOLATIONS DETECTED

File: pages/api/accounting/credit-notes.ts
Lines: 50
Pattern: 'req\.body\.userId'

🚨 SECURITY RULE: User identity must ALWAYS come from req.user (JWT),
                never from request body (req.body.userId, req.body.user, etc.)

✅ SECURE PATTERN:
   const userId = req.user.id;  // From AuthenticatedNextApiRequest

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ COMMIT BLOCKED: 1 auth violation(s) found
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Example: Clean Commit

```
🔒 Auth vulnerability check (pre-commit)
Scanning staged API files for dangerous patterns...

✅ Auth check passed (6 API file(s) scanned)
```

## Fixing a Violation

If the hook blocks your commit:

1. **Read the error message** — it tells you exactly which file and line
2. **Update the code:**
   ```typescript
   // BEFORE (blocked)
   const userId = req.body.userId || req.user?.id;
   
   // AFTER (allowed)
   const userId = req.user.id;
   ```
3. **Stage the fix:**
   ```bash
   git add pages/api/accounting/credit-notes.ts
   ```
4. **Commit again:**
   ```bash
   git commit -m "fix: use req.user.id for user identity"
   ```

## Bypass (Not Recommended)

If you need to bypass the hook (for emergency/testing only):

```bash
git commit --no-verify
```

**⚠️ WARNING:** This bypasses security checks. Only use if:
- You understand the risk
- You're testing the hook itself
- You'll fix the violation immediately after

## Troubleshooting

### "Permission denied" when committing

The hook isn't executable:
```bash
chmod +x .git/hooks/pre-commit
```

### Hook not running at all

Check if hook is installed:
```bash
ls -la .git/hooks/pre-commit
```

If missing or wrong permissions, re-install:
```bash
cp /home/hein/.openclaw/flow/workspace/scripts/pre-commit-auth-check.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

### False positives (hook blocking valid code)

The hook checks for `req.body.userId` in strings, comments, etc.

If you have a false positive:
1. Report it to Flow (@flow)
2. Include the false positive pattern
3. Bypass with `--no-verify` and fix it in the next commit

## Architecture

### Why This Pattern Matters

The `req.body.userId` pattern allows clients to impersonate any user:

```typescript
// Attacker sends:
POST /api/accounting/credit-notes HTTP/1.1
{
  "userId": "1234",  // Spoofed identity
  "type": "debit",
  "amount": 10000
}

// If code uses req.body.userId:
const userId = req.body.userId;  // ❌ Uses spoofed ID!

// Correct code uses JWT:
const userId = req.user.id;  // ✅ From cryptographically signed JWT
```

### Single Source of Truth

FibreFlow uses this model:
1. **Client sends request** (untrusted)
2. **Middleware validates JWT** (withAuth)
3. **Attaches req.user** (from signed token)
4. **Handler uses req.user.id** (single source of truth)
5. **Never checks request body for identity**

## Related Documentation

- **Vulnerability Details:** proposals/2026-03-06-auth-audit-patterns.md
- **Secure Pattern:** GUARDRAILS.md — "AUTH: User Identity ALWAYS from JWT"
- **Code Audit:** metrics/code-quality-audit-2026-03-06.md

---

**Setup by:** Flow  
**Date:** 2026-03-06  
**Status:** Ready for team-wide deployment  
