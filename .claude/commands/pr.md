# Create Pull Request

Create a pull request for the current branch following FF team standards.

## Pre-flight Checks

1. Verify clean working directory:
   ```bash
   git status
   ```

2. Get commit history for this branch:
   ```bash
   git log main..HEAD --oneline 2>/dev/null || git log develop..HEAD --oneline
   ```

3. See changed files:
   ```bash
   git diff main...HEAD --stat 2>/dev/null || git diff develop...HEAD --stat
   ```

## TDD Validation

Before creating PR, validate TDD compliance:

1. Check for test coverage:
   ```bash
   npm run test:coverage 2>/dev/null || npm test
   ```

2. Verify new code has tests:
   - For each new file in `src/modules/`, confirm test exists
   - Check `tests/specs/` for feature specification

## Analyze Changes

- Determine PR type: feat, fix, refactor, docs, test, chore
- Identify key changes and their purpose
- Note any breaking changes
- List what reviewers should focus on

## Create PR

Use gh CLI with FF standards:

```bash
gh pr create \
  --title "<type>: <description>" \
  --body "## Summary
<1-3 bullet points explaining the change>

## Changes
- <list key files/components changed>

## Testing
- [ ] Unit tests pass (\`npm test\`)
- [ ] Type check passes (\`npm run type-check\`)
- [ ] Lint passes (\`npm run lint\`)
- [ ] Manual testing completed

## TDD Compliance
- [ ] Test spec exists: tests/specs/<feature>.spec.md
- [ ] Tests written before/during implementation
- [ ] Coverage maintained or improved

## Related
Closes #<issue-number> (if applicable)

---
Generated with Claude Code"
```

## Output

Return the PR URL when complete.
