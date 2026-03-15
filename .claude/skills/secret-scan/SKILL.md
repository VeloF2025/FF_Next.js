---
name: secret-scan
description: Secret and credential scanner for FibreFlow codebase. Scans for API keys, passwords, connection strings, private keys, env fallbacks. USE WHEN user says 'secret scan', 'scan for secrets', 'check for leaked secrets', 'credential scan', '/secret-scan'.
disable-model-invocation: true
---

# /secret-scan - Secret & Credential Scanner

## Trigger
USE WHEN user says "secret scan", "scan for secrets", "check for leaked secrets", "credential scan", or "/secret-scan"

## Description
Scans the FibreFlow codebase for accidentally committed secrets, API keys, passwords, connection strings, and other sensitive data. Pre-commit hook compatible.

## Workflow

Run ALL pattern checks below and produce a report.

### Pattern 1: API Keys
```bash
grep -rn "AKIA[0-9A-Z]\{16\}" . --include="*.ts" --include="*.tsx" --include="*.js" --include="*.json" --include="*.env*" | grep -v node_modules | grep -v .next
grep -rn "sk-[a-zA-Z0-9]\{20,\}" . --include="*.ts" --include="*.tsx" --include="*.js" | grep -v node_modules | grep -v .next
grep -rn "sk_live_\|pk_live_\|rk_live_" . --include="*.ts" --include="*.tsx" --include="*.js" | grep -v node_modules | grep -v .next
```

### Pattern 2: Passwords & Connection Strings
```bash
grep -rn "password\s*[:=]\s*['\"][^'\"]\{8,\}['\"]" . --include="*.ts" --include="*.tsx" --include="*.env*" | grep -v node_modules | grep -v .next | grep -v "type\|interface\|placeholder\|label\|hint\|example\|test\|mock\|\.md"
grep -rn "postgres://\|mysql://\|mongodb://\|redis://" . --include="*.ts" --include="*.tsx" --include="*.js" --include="*.json" | grep -v node_modules | grep -v .next | grep -v "process\.env\|\.example"
```

### Pattern 3: JWT Secrets
```bash
grep -rn "jwt_secret\|JWT_SECRET\s*=\s*['\"]" . --include="*.ts" --include="*.tsx" --include="*.env*" | grep -v node_modules | grep -v .next | grep -v "process\.env"
```

### Pattern 4: IP + Port Patterns (Hardcoded Service URLs)
```bash
grep -rn "http://[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}:[0-9]\+" . --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v .next | grep -v "process\.env\|\.example\|\.md\|test"
```

### Pattern 5: Private Keys
```bash
grep -rn "BEGIN.*PRIVATE KEY\|BEGIN RSA\|BEGIN EC\|BEGIN DSA" . --include="*.ts" --include="*.tsx" --include="*.pem" --include="*.key" | grep -v node_modules | grep -v .next
```

### Pattern 6: Env Fallbacks with Literals
```bash
grep -rn "process\.env\.\w\+ || ['\"]" . --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v .next | grep -i "key\|pass\|secret\|token\|auth"
```

### Allowlist (False Positives to Ignore)
- `CLAUDE.md` and `.claude/` documentation files (contain examples)
- `*.test.ts` and `*.spec.ts` files
- `*.example` and `*.sample` files
- Lines with `process.env.` references (reading from env is OK)
- Type definitions and interfaces
- Placeholder values: `xxx`, `your-key-here`, `changeme`
- `node_modules/`, `.next/`, `dist/`

## Output Format
```
SECRET SCAN RESULTS
===================
Timestamp: {ISO date}
Files scanned: {count}

FINDINGS:
  [CRITICAL] {file}:{line} - {pattern_type}: {preview}
  [WARNING]  {file}:{line} - {pattern_type}: {preview}

SUMMARY: {critical} critical, {warning} warnings, {clean} patterns clean
STATUS: {PASS|FAIL}
```

## Pre-commit Integration
To use as a pre-commit hook, add to `.husky/pre-commit`:
```bash
claude -p "Run /secret-scan on staged files only: $(git diff --cached --name-only)"
```
