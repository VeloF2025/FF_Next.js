---
name: security-audit
description: Security regression scan for FibreFlow codebase. Checks for eval, unauthenticated endpoints, hardcoded secrets, SQL injection, empty catches. USE WHEN user says 'security audit', 'security scan', 'check security', 'run security checks', '/security-audit'.
disable-model-invocation: true
---

# /security-audit - Security Regression Scan

## Trigger
USE WHEN user says "security audit", "security scan", "check security", "run security checks", or "/security-audit"

## Description
Automated security regression scan for the FibreFlow codebase. Checks for common vulnerabilities and coding violations that were identified in the initial security audit.

## Workflow

Run ALL checks below and produce a JSON report with pass/fail/warn counts.

### Check 1: eval() Detection
```bash
grep -rn "eval(" pages/api/ src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v ".next"
```
**Pass**: No results
**Fail**: Any match found

### Check 2: Unauthenticated API Endpoints
Scan `pages/api/` for handler exports that don't use `withAuth`, `withOptionalAuth`, `withFleetAuth`, or API key validation.
```bash
# Find files with default export that don't reference withAuth
grep -rL "withAuth\|withOptionalAuth\|withFleetAuth\|x-api-key\|X-API-Key\|apiKey" pages/api/ --include="*.ts" | grep -v __tests__
```
Cross-reference against known public endpoints: `health.ts`, `auth/login.ts`, `auth/check-email.ts`, `auth/forgot-password.ts`, `auth/reset-password.ts`, `auth/setup-password.ts`, `wa-monitor-*.ts`, `qfield/webhook.ts`.

**Pass**: Only known public endpoints
**Warn**: New unauth endpoint found

### Check 3: Hardcoded Secrets
```bash
grep -rn "password.*=.*['\"]" pages/api/ src/ --include="*.ts" --include="*.tsx" | grep -v "password:" | grep -v "\.test\." | grep -v "type\|interface\|placeholder\|label\|hint"
grep -rn "|| ['\"][A-Za-z0-9]" pages/api/ src/ --include="*.ts" --include="*.tsx" | grep -i "key\|pass\|secret\|token"
```
**Pass**: No hardcoded fallbacks
**Fail**: Any hardcoded credential found

### Check 4: console.log Violations
```bash
grep -rn "console\.\(log\|error\|warn\|info\)" pages/api/ src/ --include="*.ts" --include="*.tsx" | grep -v "// eslint-disable" | grep -v middleware.ts | grep -v "node_modules"
```
**Pass**: No active console.* calls (comments OK)
**Warn**: Found in comment blocks only
**Fail**: Active console.* usage

### Check 5: SQL String Concatenation
```bash
grep -rn "query += \|query = query \+" pages/api/ src/ --include="*.ts"
grep -rn '\$\{.*\}.*sql`\|sql`.*\$\{' pages/api/ src/ --include="*.ts" | grep -v "tagged template"
```
**Pass**: No string-built SQL
**Fail**: String concatenation in SQL queries

### Check 6: Math.random() in Security Code
```bash
grep -rn "Math\.random()" src/lib/auth/ pages/api/auth/ --include="*.ts"
```
**Pass**: No results
**Fail**: Math.random used in auth code

### Check 7: Empty Catch Blocks
```bash
grep -rn "catch.*{.*}" pages/api/ src/ --include="*.ts" --include="*.tsx" | grep -v "log\.\|console\.\|throw\|return"
```
**Pass**: All catches have logging or handling
**Warn**: Comment-only catch blocks found

### Check 8: Localhost in CORS
```bash
grep -rn "localhost" src/lib/apiResponse.ts | grep -v "NODE_ENV.*development\|process.env"
```
**Pass**: Localhost only in dev mode
**Fail**: Unconditional localhost CORS

### Check 9: Hardcoded IPs
```bash
grep -rn "[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}" pages/api/ src/ --include="*.ts" --include="*.tsx" | grep -v "0\.0\.0\.0\|127\.0\.0\.1\|node_modules\|\.test\."
```
**Warn**: Each hardcoded IP should be from env or service registry

### Check 10: File Size Compliance
```bash
# Files over 300 lines
find pages/api/ src/ -name "*.ts" -o -name "*.tsx" | xargs wc -l | sort -rn | head -20
```
**Warn**: Files over 300 lines

### Check 11: Dependency Audit
```bash
npm audit --json 2>/dev/null | jq '.metadata.vulnerabilities'
```
**Warn/Fail**: Based on severity counts

## Output Format
```json
{
  "timestamp": "ISO date",
  "summary": { "pass": N, "warn": N, "fail": N },
  "checks": [
    { "name": "eval_detection", "status": "pass|warn|fail", "details": "..." },
    ...
  ]
}
```
