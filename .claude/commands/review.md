# Review Pull Request

Review a pull request thoroughly following FF standards.

## Input

- PR number (ask if not provided): $ARGUMENTS

## Gather Information

1. Get PR metadata:
   ```bash
   gh pr view <number> --json title,body,author,files,additions,deletions,reviewDecision,statusCheckRollup
   ```

2. Get the full diff:
   ```bash
   gh pr diff <number>
   ```

3. Check CI status:
   ```bash
   gh pr checks <number>
   ```

## Review Checklist

Analyze the changes for:

### Code Quality
- [ ] Code is readable and well-organized
- [ ] Functions are focused and not too long
- [ ] Variable names are descriptive
- [ ] No commented-out code

### FF Standards (Zero Tolerance)
- [ ] No `console.log` - uses `log` from `@/lib/logger`
- [ ] No empty catch blocks - errors logged and handled
- [ ] No implicit `any` types - all types explicit
- [ ] Uses `apiResponse` helpers, not raw `res.json()`

### Security (OWASP Top 10)
- [ ] No SQL injection (parameterized queries)
- [ ] No XSS vulnerabilities (sanitized output)
- [ ] Auth checks in place for protected routes
- [ ] No sensitive data in logs

### TypeScript
- [ ] Proper interfaces defined
- [ ] No type assertions (`as any`)
- [ ] Error types handled correctly (`error: unknown`)

### Testing (TDD Compliance)
- [ ] New code has corresponding tests
- [ ] Test spec exists for new features
- [ ] Tests are meaningful (not trivial)
- [ ] Edge cases covered

### Architecture
- [ ] Follows module structure pattern
- [ ] No circular dependencies
- [ ] Proper separation of concerns
- [ ] Changes don't break existing functionality

## Output Format

```markdown
## Review: PR #<number>

**Overall**: [APPROVE / REQUEST_CHANGES / COMMENT]

### Summary
<1-2 sentence summary of the PR>

### Strengths
- <positive aspects>

### Issues Found
| Severity | File:Line | Issue | Suggestion |
|----------|-----------|-------|------------|
| HIGH | src/x.ts:42 | ... | ... |
| MEDIUM | ... | ... | ... |

### TDD Compliance
- Test spec: [EXISTS / MISSING]
- Test coverage: [ADEQUATE / NEEDS_IMPROVEMENT]

### Suggestions
- <optional improvements>

### Verdict
<Final recommendation>
```

## Actions

If approving:
```bash
gh pr review <number> --approve --body "LGTM! <summary>"
```

If requesting changes:
```bash
gh pr review <number> --request-changes --body "<issues found>"
```

If just commenting:
```bash
gh pr review <number> --comment --body "<feedback>"
```
