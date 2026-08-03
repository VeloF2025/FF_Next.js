# Direct-Database Guard Markdown Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scan the metrics snapshot source for direct database usage while preventing Markdown inline code from masquerading as a tagged SQL template.

**Architecture:** Keep the existing integration scanner and its six detection patterns. Harden only the tagged-template expression, remove the one coarse metrics allowlist entry, and prove both positive detection and negative Markdown behavior in the scanner's own Vitest suite.

**Tech Stack:** TypeScript, Vitest, Node.js regular expressions, npm.

## Global Constraints

- Do not change `src/modules/metrics/snapshot/sources.ts`; its existing Markdown comment is the integration fixture.
- Do not add a parser, comment stripper, dependency, source transformation, or unrelated allowlist cleanup.
- Preserve detection of real `sql` tagged templates with and without whitespace.
- Restore all six existing database-usage checks for `src/modules/metrics/snapshot/sources.ts`.
- Deliver through a pull request only; do not deploy or perform database operations.

---

### Task 1: Harden the direct-database scanner

**Files:**
- Modify and test: `src/tests/no-direct-db-connections.test.ts:16-55`

**Interfaces:**
- Consumes: the existing `dbPatterns: RegExp[]`, `allowedFiles: string[]`, `isExcluded(filePath: string): boolean`, and repository scan.
- Produces: a tagged-template pattern that ignores Markdown inline code and an allowlist that no longer exempts `modules/metrics/snapshot/sources.ts`.

- [ ] **Step 1: Add focused failing behavior tests**

Inside the existing `describe('No Direct Database Connections', ...)` block, after `isExcluded`, add:

```typescript
  it.each([
    ['a direct tagged template', 'const rows = sql`SELECT 1`;', true],
    ['a spaced direct tagged template', 'const rows = sql   `SELECT 1`;', true],
    ['Markdown inline code', 'Every `sql` must return three columns.', false],
  ])('classifies %s correctly', (_name, source, expected) => {
    expect(dbPatterns.some((pattern) => pattern.test(source))).toBe(expected);
  });

  it('scans the metrics snapshot source instead of allowlisting it', () => {
    const metricsSource = join(srcDir, 'modules/metrics/snapshot/sources.ts');
    expect(isExcluded(metricsSource)).toBe(false);
  });
```

- [ ] **Step 2: Run the guard test and verify RED**

Run:

```bash
npx vitest run src/tests/no-direct-db-connections.test.ts --reporter=verbose
```

Expected: two failures for the intended reasons. The Markdown case receives `true` instead of `false`, and the metrics source exclusion receives `true` instead of `false`. The real tagged-template cases remain green.

- [ ] **Step 3: Apply the minimal matcher and allowlist changes**

Change only the tagged-template entry in `dbPatterns`:

```typescript
    /(?<!`)sql\s*`/,
```

Delete this exact allowlist block:

```typescript
    // Server-only metrics snapshot source registry. Imported by the cron API
    // and snapshot writer only; no component or client entry point imports it.
    'modules/metrics/snapshot/sources.ts',
```

- [ ] **Step 4: Run the guard test and verify GREEN**

Run:

```bash
npx vitest run src/tests/no-direct-db-connections.test.ts --reporter=verbose
```

Expected: all seven tests pass. The repository scan reads the unchanged metrics source without reporting its Markdown comment.

- [ ] **Step 5: Run the focused regression set**

Run:

```bash
npx vitest run src/tests/no-direct-db-connections.test.ts src/modules/metrics/snapshot/__tests__/writer.test.ts --reporter=dot
```

Expected: both files pass with zero failed tests.

- [ ] **Step 6: Commit the implementation**

```bash
git add src/tests/no-direct-db-connections.test.ts
git diff --cached --check
git commit -m "test: harden direct DB scan against Markdown"
```

---

### Task 2: Run repository gates and publish the PR

**Files:**
- Verify: `src/tests/no-direct-db-connections.test.ts`
- Verify unchanged: `src/modules/metrics/snapshot/sources.ts`

**Interfaces:**
- Consumes: the committed Task 1 scanner behavior.
- Produces: local CI evidence and a reviewable pull request targeting `master`.

- [ ] **Step 1: Prove the metrics source was not modified**

Run:

```bash
git diff origin/master...HEAD -- src/modules/metrics/snapshot/sources.ts
```

Expected: no output.

- [ ] **Step 2: Run mandatory local CI**

Run:

```bash
npm run ci:quick
```

Expected: exit code 0, zero failed gates, changed-file zero-tolerance checks clean, and secret scan clean. Report repository-baseline warnings separately rather than describing them as new failures.

- [ ] **Step 3: Audit the final branch diff**

Run:

```bash
git diff --check origin/master...HEAD
git status --short
git diff --stat origin/master...HEAD
```

Expected: no whitespace errors, a clean worktree, and changes limited to the design, implementation plan, and direct-database guard test.

- [ ] **Step 4: Push the branch and open a draft pull request**

```bash
git push -u origin fix/direct-db-guard-markdown
gh pr create --draft --base master --head fix/direct-db-guard-markdown \
  --title "test: harden direct DB scan against Markdown" \
  --body-file .superpowers/sdd/direct-db-guard-pr-body.md
```

Before running the command, create the ignored PR body file with these sections: outcome, root cause, exact scanner change, red/green evidence, `ci:quick` evidence, and explicit statements that no deployment or database operation occurred.

Use this exact body after every listed command has passed:

```markdown
## Outcome

Restores full direct-database scanning for the metrics snapshot source without treating Markdown inline code as a tagged SQL template.

## Root cause and fix

- The scanner's tagged-template expression also matched Markdown inline code.
- PR #2351 restored CI by allowlisting the metrics source, which skipped all six database-usage patterns for that file.
- This PR distinguishes the Markdown form, removes the metrics allowlist entry, and leaves the metrics source unchanged as an integration fixture.

## Verification

- TDD red: the Markdown classification and metrics-source coverage assertions failed before implementation.
- TDD green: all direct-database guard tests passed after the minimal matcher and allowlist changes.
- Focused guard and metrics snapshot regression tests passed.
- `npm run ci:quick` passed.
- Final diff and whitespace checks passed.

## Scope

- No dependency, parser, comment stripper, or unrelated allowlist change.
- No deployment or database operation performed.
```

- [ ] **Step 5: Verify hosted PR state**

Run:

```bash
gh pr view --json number,url,isDraft,state,headRefOid,statusCheckRollup
```

Expected: an open draft PR whose `headRefOid` matches local `HEAD`. Report hosted checks as pending until GitHub completes them; do not claim green from local evidence alone.
