# Registering a metric

A metric is one row in `src/modules/metrics/registry/index.ts`. No migration, no route, no
per-metric SQL test. The registry is the single definition site — Cortex and any other MCP
client read it over HTTP and hold no SQL of their own.

## The contract

```ts
{
  key: 'open_snags',                  // stable id; the client asks for this
  label: 'open snags',                // appears in the answer text
  description: '...',                 // shown in metrics-list so a caller can choose
  from: `( SELECT ... ) src`,         // FROM body, aliased src. Predicates live HERE.
  measure: 'count(*)',                // aggregate expression
  dateColumn: 'src.created_at' | null,// null = current-state only
  additivity: 'additive' | 'semi-additive' | 'non-additive',
  grains: ['day'],                    // which buckets are legal
  dimensions: [],                     // names from the dimension registry
  aliases: ['open snags', 'snags'],   // how a question reaches this metric
  cite: 'FibreFlow snags (open = ...)',
  permission: 'analytics.reports',    // RBAC, checked per metric per request
}
```

There is no `filter` field. It was removed because no metric used it — every predicate
belongs in `from`.

## The five decisions that are easy to get wrong

### 0. Confirm the source is what you think it is

Before choosing `additivity`, check whether the source table records each thing **once** or
**repeatedly**. Two tables in this database look like event logs and are not:

- `project_weekly_zone_pon_uptake.installed` is a **running total**; summing July reports
  91,296 against a true 23,732.
- `dr_activity_log` **re-logs** an unresolved pre-provision roughly daily; one drop carries
  141 rows over 104 days, so counting rows for July returns 1,107 against 219 genuinely new.

Both produce a plausible number that is several times too large, with no error. Run
`SELECT <entity>, count(*) ... GROUP BY 1 ORDER BY 2 DESC LIMIT 5` on any candidate source
before writing the definition — if the top entity has many rows, it is not an event log.

### 1. `additivity` is required and is not cosmetic

It decides how a series collapses to one number, and — less obviously — whether an **empty
series means zero or means missing data**.

| value | meaning | headline |
|---|---|---|
| `additive` | an event count; each row is a distinct thing that happened | sum of the series |
| `semi-additive` | a level, stock, balance or running total | the **latest** period, plus `total_period` |
| `non-additive` | a ratio, percentage or average | recompute per grain; never sum |

Get this wrong and the number is silently wrong rather than an error. `zone_uptake` summed
across July reports **91,296** against a true **23,732**, because `installed` is cumulative.

A consequence worth knowing: for a `semi-additive` metric an empty series means *the snapshot
was never captured*, and clients report that as absence rather than `0`. For an `additive`
metric an empty series genuinely is zero events.

### 2. `dateColumn: null` means current-state

The builder then emits no `WHERE` date filter and `NULL::text AS period`, so the requested
window is **ignored** and every row lands in one undated bucket. That is correct for "how many
are open right now" (`open_snags`, `open_tickets`), and clients render it as "(current)"
rather than stamping it with a date range.

Such a metric must still declare a periodic grain (`['day']` is conventional). It is unused,
but `validateMetricQuery` rejects `'range'` for any non-additive measure, so declaring only
`range` makes every query 400.

### 3. A metric with no alias is unreachable

Intent matching is alias-based, so a metric without at least one alias can never be asked for.
`registry.test.ts` fails if you forget.

**Longest alias wins, and matching is plain substring** — so a SHORT alias that is contained
in a longer one silently steals its questions.

This is not hypothetical. A `pre-provisions` alias was proposed for an event-count metric
alongside `pp_open_balance`'s existing `pre-provision backlog`. Because the backlog alias only
matches that exact singular phrase, *"how many pre-provisions are in the backlog"* would have
matched the 14-character `pre-provisions` and answered a **stock** question with an **event
count**. Before the alias existed the question matched nothing and fell through to prose —
so adding it would have replaced an honest non-answer with a confident wrong one.

Rules that follow:

- Never register an alias that is a substring of another metric's alias unless you have
  tested every phrasing that contains both.
- When adding a metric near an existing one, add an `intent.test.ts` case for the phrasings a
  user would actually type — including the ones that *should* stay `none`.
- `none` is a good outcome. Falling through to prose beats answering the wrong question.

### 4. Adding a project alias means editing **two** places

`canonical_project()` exists in both TypeScript and SQL:

- `src/modules/metrics/dimensions/canonical.ts`
- the SQL function shipped by `scripts/migrations/sql/477_conformed_project_dimension.sql`

Change one without the other and grouping silently splits: `TEM` and `Thembisa POP 1` stop
folding together, and one project reports as two rows carrying the same label.

`tests/migrations/477_conformed_project_dimension.test.ts` enforces parity in both directions —
every TypeScript alias against the SQL, every SQL mapping against the TypeScript, including
whitespace trimming and case folding. It fails if you edit only one side.

## What you get for free, and what you still owe

**Free:** `tests/migrations/metric-registry-execution.test.ts` enrols **every** registered
metric automatically and runs its SQL for each declared grain × dimension against a real
Postgres. You do not need a per-metric test for SQL validity.

⚠️ **But auto-enrolment means a missing source table is a failure, not a skip.** The fixture
in `tests/migrations/setup/metric-registry-fixture.ts` builds the schema by hand, so a new
metric whose table is not there fails with `relation "x" does not exist`. Add the table with
**live column types** — check `information_schema.columns`, do not guess. `status` is `varchar`
on `oes_activations` and `maintenance_tickets` but `text` on `snags`.

**Still owed:** a value-assertion test. SQL that runs is not SQL that is right. Seed at least
one row your predicate must EXCLUDE, so a dropped `WHERE` shows up as a wrong number rather
than passing against an all-matching table.

## Snapshot sources

A metric that reads a nightly snapshot needs a source, which is a row in
`src/modules/metrics/snapshot/sources.ts` — **no migration**. The spine tables
(`metric_snapshots`, `snapshot_runs`) already exist from migration 474.

⚠️ `pp_open_balance`'s join is only safe because `snapshot_runs_source_date_key` is UNIQUE on
`(source_key, as_of_date)`. The primary key is on `id`. Drop that index and every count doubles.

## Checklist

- [ ] Source checked for repeat-logging (`GROUP BY entity ORDER BY count DESC`) before choosing additivity
- [ ] Row added to `registry/index.ts` with an explicit `additivity` and a `cite`
- [ ] At least one alias; a test in `intent.test.ts` if it neighbours an existing one
- [ ] Source table present in `metric-registry-fixture.ts` with live column types
- [ ] A value-assertion test that seeds a row the predicate must exclude
- [ ] `npx vitest run src/modules/metrics/` and `npm run test:migrations` both green
