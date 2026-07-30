# H&S Operational Rollout Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a private, evidence-backed H&S rollout review pack without changing production data, and prove the same generator against disposable synthetic data.

**Architecture:** A small TypeScript CLI loads one normalized snapshot either from PostgreSQL inside a read-only transaction or from a JSON fixture. Pure builders turn that snapshot into CSV, Markdown, and JSON artifacts. Live artifacts go only to a git-ignored private directory; tests exercise the real artifact writer with synthetic people, contractors, blockers, and lead evidence.

**Tech Stack:** TypeScript, `tsx`, `pg`, Node.js filesystem APIs, Vitest.

## Global Constraints

- The shared database is production data: live mode must use `BEGIN TRANSACTION READ ONLY` and contain no write statement.
- Do not infer contractor ownership from names, projects, historical submissions, or fuzzy matching.
- A member may inherit a proposed contractor only from their team's explicit `teams.contractor_id`.
- A team may inherit a proposed contractor only when all explicitly linked active members agree on one contractor.
- Conflicting or absent evidence must remain unresolved for human review.
- Do not change `staff.role`, apply contractor mappings, clear medical blockers, or send the announcement.
- Do not commit live names, medical details, generated CSV files, or local database output.
- No `console.log`; CLI status uses `process.stdout.write`, and errors use `process.stderr.write`.
- Keep source files below 300 lines.

---

### Task 1: Pure Snapshot-to-Pack Builder

**Files:**
- Create: `scripts/hs-operational-rollout/types.ts`
- Create: `scripts/hs-operational-rollout/buildPack.ts`
- Create: `scripts/hs-operational-rollout/demo-fixture.json`
- Test: `scripts/__tests__/hs-operational-rollout-pack.test.ts`

**Interfaces:**
- Consumes: a normalized `RolloutSnapshot` containing contractors, teams, team members, blocked check-ins, and crew-lead evidence.
- Produces: `buildPack(snapshot: RolloutSnapshot): PackFiles`, where `PackFiles` maps stable filenames to complete file contents.

- [ ] **Step 1: Write failing tests for evidence-only contractor proposals**

```typescript
it('uses only explicit team/member contractor links and leaves conflicts unresolved', () => {
  const files = buildPack(demoSnapshot);
  expect(files['contractor-mapping.csv']).toContain(
    'team_member,Demo Worker,Demo Team,Demo Contractor,teams.contractor_id,HIGH,pending'
  );
  expect(files['contractor-mapping.csv']).toContain(
    'team,Conflict Team,,,conflicting team_members.contractor_id,NONE,pending'
  );
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npm test -- --run scripts/__tests__/hs-operational-rollout-pack.test.ts`

Expected: FAIL because `buildPack` and its types do not exist.

- [ ] **Step 3: Define normalized input and output types**

```typescript
export interface RolloutSnapshot {
  generatedAt: string;
  contractors: ContractorRow[];
  teams: TeamRow[];
  members: TeamMemberRow[];
  blockedCheckins: BlockedCheckinRow[];
  leadEvidence: LeadEvidenceRow[];
  adoption: AdoptionSummary;
}

export type PackFiles = Record<
  | 'README.md'
  | 'contractor-mapping.csv'
  | 'medical-blockers.csv'
  | 'crew-lead-candidates.csv'
  | 'staff-announcement-DRAFT.md'
  | 'manifest.json',
  string
>;
```

- [ ] **Step 4: Implement deterministic mapping and CSV builders**

```typescript
export function buildPack(snapshot: RolloutSnapshot): PackFiles {
  const contractorNames = new Map(snapshot.contractors.map((row) => [row.id, row.companyName]));
  const teamMappings = deriveTeamMappings(snapshot.teams, snapshot.members);
  const memberMappings = deriveMemberMappings(snapshot.members, teamMappings);
  return {
    'README.md': renderReadme(snapshot, teamMappings, memberMappings),
    'contractor-mapping.csv': renderMappingCsv(teamMappings, memberMappings, contractorNames),
    'medical-blockers.csv': renderMedicalCsv(snapshot.blockedCheckins),
    'crew-lead-candidates.csv': renderLeadCsv(snapshot.leadEvidence),
    'staff-announcement-DRAFT.md': renderAnnouncement(),
    'manifest.json': renderManifest(snapshot, teamMappings, memberMappings),
  };
}
```

`deriveTeamMappings` uses `teams.contractor_id` first; otherwise it proposes only the single unanimous non-null contractor among active members. `deriveMemberMappings` uses `team_members.contractor_id` first; otherwise it may use the team's explicit contractor, but never a team proposal derived from other members. Every other case is unresolved.

- [ ] **Step 5: Add escaping and privacy assertions**

Tests must prove commas, quotes, and newlines are escaped; blocker output omits GPS, ID numbers, medical notes, and clearance notes; the announcement contains `DRAFT — DO NOT SEND` and the four approved safety messages.

- [ ] **Step 6: Run the focused test and confirm it passes**

Run: `npm test -- --run scripts/__tests__/hs-operational-rollout-pack.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the pure builder**

```bash
git add scripts/hs-operational-rollout scripts/__tests__/hs-operational-rollout-pack.test.ts
git commit -m "feat(hs): build evidence-only rollout review pack"
```

### Task 2: Disposable Fixture and Read-Only Live Loader

**Files:**
- Create: `scripts/hs-operational-rollout/loadSnapshot.ts`
- Create: `scripts/hs-operational-rollout/index.ts`
- Modify: `package.json`
- Modify: `.gitignore`
- Test: `scripts/__tests__/hs-operational-rollout-cli.test.ts`

**Interfaces:**
- Consumes: `loadFixtureSnapshot(path: string)` or `loadLiveSnapshot(databaseUrl: string)`.
- Produces: `writePack(snapshot: RolloutSnapshot, outputDir: string): Promise<string[]>` and CLI arguments `--fixture <json> --output <dir>` or `--live --output .private/hs-operational-rollout/<timestamp>`.

- [ ] **Step 1: Write a failing end-to-end fixture test**

```typescript
it('writes the complete pack from disposable demo data', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'ff-hs-rollout-'));
  const written = await run({
    fixturePath: resolve('scripts/hs-operational-rollout/demo-fixture.json'),
    outputDir,
  });
  expect(written.sort()).toEqual(EXPECTED_PACK_FILES);
  expect(await readFile(join(outputDir, 'manifest.json'), 'utf8')).toContain('"source":"fixture"');
});
```

- [ ] **Step 2: Run the CLI test and confirm it fails**

Run: `npm test -- --run scripts/__tests__/hs-operational-rollout-cli.test.ts`

Expected: FAIL because the loader and CLI do not exist.

- [ ] **Step 3: Implement fixture loading, private output enforcement, and atomic file writes**

Live CLI output must resolve beneath `<repo>/.private/hs-operational-rollout/`. Fixture-mode tests may use an operating-system temporary directory. Write into a newly created output directory, refuse to overwrite an existing file, and print only filenames/counts.

- [ ] **Step 4: Implement the live read-only transaction**

```typescript
const client = await pool.connect();
try {
  await client.query('BEGIN TRANSACTION READ ONLY');
  const snapshot = await querySnapshot(client);
  await client.query('COMMIT');
  return snapshot;
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
```

The fixed queries read:

- active `contractors`, `teams`, and `team_members`;
- current-day adoption counts in SAST;
- blocked check-ins from the last seven SAST dates, using `blocked_reasons`;
- lead evidence from `team_members.is_team_lead`, lead-like `team_members.role`, linked `staff.role`, and `teams.lead_user_id`.

- [ ] **Step 5: Wire the package command and private ignore rule**

```json
"hs:operational-pack": "tsx scripts/hs-operational-rollout/index.ts"
```

Add `/.private/hs-operational-rollout/` to `.gitignore`.

- [ ] **Step 6: Run fixture and focused tests**

Run:

```bash
npm run hs:operational-pack -- --fixture scripts/hs-operational-rollout/demo-fixture.json --output /tmp/ff-hs-rollout-demo
npm test -- --run scripts/__tests__/hs-operational-rollout-pack.test.ts scripts/__tests__/hs-operational-rollout-cli.test.ts
```

Expected: six demo artifacts written; all focused tests pass.

- [ ] **Step 7: Commit loader and CLI**

```bash
git add .gitignore package.json scripts/hs-operational-rollout scripts/__tests__/hs-operational-rollout-cli.test.ts
git commit -m "feat(hs): add read-only operational pack CLI"
```

### Task 3: Live Private Pack, Verification, and Pull Request

**Files:**
- Create locally only: `.private/hs-operational-rollout/<timestamp>/*`
- Modify if needed: code and tests from Tasks 1–2 only

**Interfaces:**
- Consumes: live `DATABASE_URL` supplied from the deploy environment without printing it.
- Produces: a private review directory and a non-sensitive PR.

- [ ] **Step 1: Generate the live pack read-only**

Run:

```bash
set -a
source /home/velo/fibreflow-dev/.env.local >/dev/null 2>&1
set +a
npm run hs:operational-pack -- --live --output .private/hs-operational-rollout/$(date +%Y%m%d-%H%M%S)
```

Expected: six files, no database write, no names printed to stdout.

- [ ] **Step 2: Validate pack integrity and repository privacy**

Run:

```bash
git check-ignore .private/hs-operational-rollout/*
git status --short
git diff --check
```

Expected: every live artifact is ignored; only source, fixture, tests, plan, `.gitignore`, and `package.json` are tracked changes.

- [ ] **Step 3: Run all required verification**

Run:

```bash
npm test -- --run scripts/__tests__/hs-operational-rollout-pack.test.ts scripts/__tests__/hs-operational-rollout-cli.test.ts
npm run ci:quick
npm run antihall
```

Expected: focused tests pass, CI quick passes its repository baseline, and antihall either passes or reports the already-known missing-validator baseline with exact evidence.

- [ ] **Step 4: Review generated decisions without exposing PII**

Report only aggregate counts in chat and PR: proposed mappings by confidence, unresolved mappings, medical blocker count, and crew-lead candidate count. Keep names and medical rows inside the ignored private pack.

- [ ] **Step 5: Commit final source changes and open a PR with `gh`**

```bash
git add .gitignore package.json docs/superpowers/plans/2026-07-30-hs-operational-rollout-pack.md scripts/hs-operational-rollout scripts/__tests__
git commit -m "test(hs): verify rollout pack with disposable data"
gh pr create --base master --head feat/hs-operational-rollout --title "Add private H&S operational rollout pack" --body-file /tmp/hs-rollout-pr.md
```

The PR body must explicitly state: no schema migration, no production write, no live artifact committed, and no message sent.

- [ ] **Step 6: Verify the already-deployed portal reminder**

Use Playwright against `https://dev.fibreflow.app/my` with an authorized test session. Confirm the reminder appears only after clock-in and links to `/my/hs-checkin`. Do not create real attendance or H&S rows; use an existing authorized test account/state or report the exact blocker.

- [ ] **Step 7: Present gated operational decisions**

Present the private pack path, aggregate findings, and the exact approvals still needed for contractor updates, crew-lead roles, announcement send, and medical evidence capture. Do not apply them until approved.
