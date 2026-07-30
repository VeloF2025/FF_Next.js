# H&S Rollout Snapshot Date Timezone Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every H&S check-in on its stored PostgreSQL calendar date when the operational rollout snapshot runs in SAST or any other runtime timezone.

**Architecture:** Make the database boundary return `hs_daily_checkins.checkin_date` as PostgreSQL text, matching the established H&S pure-date pattern. The loader then consumes the `YYYY-MM-DD` string directly, so no JavaScript `Date` or UTC conversion can shift the calendar day.

**Tech Stack:** TypeScript, node-postgres query interface, pg-mem, Vitest

## Global Constraints

- Select `c.checkin_date::text AS checkin_date`.
- Type `CheckinDbRow.checkin_date` as `string`.
- Remove the JavaScript `Date`-to-UTC normalization and use the returned `YYYY-MM-DD` string directly.
- Keep `WHERE c.checkin_date BETWEEN $1::date AND $2::date` and `ORDER BY c.checkin_date DESC, c.worker_name, c.id` on the raw database column.
- The regression must exercise consumer-visible snapshot behavior, not merely scan source text.
- No database writes, schema migrations, medical overrides, contractor mappings, role changes, or announcement sends.
- The staff announcement draft and its wording are unaffected.
- Production deployment is outside this change; dev deployment follows the mandatory `scripts/deploy-local.sh dev` path.

---

### Task 1: Preserve PostgreSQL Pure Dates at the Snapshot Boundary

**Files:**
- Modify: `scripts/__tests__/hs-operational-rollout-live.test.ts`
- Modify: `scripts/hs-operational-rollout/loadSnapshot.ts`

**Interfaces:**
- Consumes: `loadSnapshotFromPool(pool: SnapshotPool, now?: Date): Promise<RolloutSnapshot>`
- Produces: `CheckinDbRow.checkin_date: string` populated by `c.checkin_date::text AS checkin_date`

- [ ] **Step 1: Make the disposable adapter emulate the production SAST date boundary**

In `scripts/__tests__/hs-operational-rollout-live.test.ts`, add this helper below the imports:

```typescript
function emulateSastNodePgDateParsing<Row>(
  text: string,
  result: { rows: Row[] }
): { rows: Row[] } {
  if (
    !text.includes('FROM hs_daily_checkins c') ||
    text.includes('c.checkin_date::text AS checkin_date')
  ) {
    return result;
  }

  return {
    rows: result.rows.map((row) => {
      const checkinRow = row as Row & { checkin_date?: Date | string };
      if (!checkinRow.checkin_date) return row;
      const storedDate =
        checkinRow.checkin_date instanceof Date
          ? checkinRow.checkin_date.toISOString().slice(0, 10)
          : checkinRow.checkin_date.slice(0, 10);
      return {
        ...checkinRow,
        checkin_date: new Date(`${storedDate}T00:00:00+02:00`),
      };
    }),
  };
}
```

Update the recording client's query implementation so the real query result passes through the helper:

```typescript
async query<Row>(text: string, values?: unknown[]) {
  transactionQueries.push(text);
  const result = (await client.query(text, values)) as { rows: Row[] };
  return emulateSastNodePgDateParsing(text, result);
},
```

Rename the test to:

```typescript
it('preserves PostgreSQL pure dates when node-postgres runs in SAST', async () => {
```

Keep the existing adoption and blocked-checkin assertions unchanged. They are the consumer-visible regression: the 30 July check-in must count on 30 July, and the seven-day boundary must remain 24 July.

- [ ] **Step 2: Run the focused test and capture the expected failure**

Run:

```bash
TZ=Africa/Johannesburg npx vitest run scripts/__tests__/hs-operational-rollout-live.test.ts
```

Expected: FAIL because the current loader converts SAST midnight through UTC, shifting the stored `2026-07-30` check-in to `2026-07-29`. The adoption assertion should show `checkinsToday: 0` instead of `1` and `clockedInWithoutCheckin: 2` instead of `1`.

- [ ] **Step 3: Return the pure date as text at the SQL boundary**

In `scripts/hs-operational-rollout/loadSnapshot.ts`, change the row type:

```typescript
interface CheckinDbRow {
  id: string;
  checkin_date: string;
```

Delete the entire `dateText` function:

```typescript
function dateText(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}
```

Change only the selected expression in the check-in query:

```sql
SELECT c.id::text AS id, c.checkin_date::text AS checkin_date,
```

Keep the filter and ordering expressions on raw `c.checkin_date`.

Replace the normalization map:

```typescript
const checkins = checkinsResult.rows.map((row) => ({
  ...row,
  checkin_date: dateText(row.checkin_date),
}));
```

with:

```typescript
const checkins = checkinsResult.rows;
```

- [ ] **Step 4: Run focused regression and adjacent pack tests**

Run:

```bash
TZ=Africa/Johannesburg npx vitest run \
  scripts/__tests__/hs-operational-rollout-live.test.ts \
  scripts/__tests__/hs-operational-rollout-pack.test.ts \
  scripts/__tests__/hs-operational-rollout-cli.test.ts
```

Expected: all tests PASS with pristine output.

- [ ] **Step 5: Prove the regression detects removal of the fix**

Temporarily change the query expression back to `c.checkin_date`, run:

```bash
TZ=Africa/Johannesburg npx vitest run scripts/__tests__/hs-operational-rollout-live.test.ts
```

Expected: FAIL with the same shifted-day adoption mismatch from Step 2. Restore `c.checkin_date::text AS checkin_date`, rerun the command, and expect PASS.

- [ ] **Step 6: Run repository verification**

Run:

```bash
npm run ci:quick
npm test -- --run
```

Expected: `npm run ci:quick` PASS. The repository suite should PASS; if the four environment-dependent `src/tests/api-integration/api-health.test.ts` cases fail because no local API server is running, record them exactly as pre-existing baseline failures rather than masking or changing them.

- [ ] **Step 7: Commit the implementation**

```bash
git add \
  scripts/__tests__/hs-operational-rollout-live.test.ts \
  scripts/hs-operational-rollout/loadSnapshot.ts
git commit -m "fix(hs): preserve rollout check-in dates"
```
