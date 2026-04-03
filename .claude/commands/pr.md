# Create Pull Request

Create a pull request for the current branch following FF team standards.

## Pre-flight Checks

1. Verify clean working directory:
   ```bash
   git status
   ```

2. Get commit history for this branch:
   ```bash
   git log master..HEAD --oneline
   ```

3. See changed files:
   ```bash
   git diff master...HEAD --stat
   ```

## Local CI Pipeline (replaces GitHub Actions)

**MANDATORY — run before creating PR. Do not skip.**

Run the local CI pipeline which mirrors the GitHub Actions gates:

```bash
bash scripts/ci-local.sh --quick
```

This runs:
- Accessibility lint gate (jsx-a11y, max 487 warnings)
- Error handling gate (no-silent-catch, max 896 warnings)
- Type safety gate (no-explicit-any, max 2573 warnings)
- TypeScript type check (non-blocking)

If any **blocking** gate fails, fix the issues before creating the PR.

For a full CI run including tests and build (takes longer):
```bash
bash scripts/ci-local.sh
```

## Analyze Changes

- Determine PR type: feat, fix, refactor, docs, test, chore
- Identify key changes and their purpose
- Note any breaking changes
- List what reviewers should focus on

## Create PR

Use gh CLI with FF standards:

```bash
gh pr create \
  --title "<type>(<scope>): <description>" \
  --body "$(cat <<'EOF'
## Summary
<1-3 bullet points explaining the change>

## Changes
- <list key files/components changed>

## Local CI
- [x] Lint gates passed (`bash scripts/ci-local.sh --quick`)
- [ ] Unit tests pass (`npm test -- --run`)
- [ ] Build verified

## Testing
- [ ] Manual testing completed on dev

## Related
Closes #<issue-number> (if applicable)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## Output

Return the PR URL when complete.
