# Task 9 report — curated FastMCP QField tool

## Delivered

- Added `get_qfield_project_stats(project, section='summary', page=1, limit=50)`
  with the approved seven-section `Literal` schema.
- The adapter URL-encodes query values and delegates only to
  `_fibreflow_get_sync("/api/qfield/project-stats", query)`, preserving its
  per-user credential, path, rate-limit, timeout, upstream-error, and
  response-size guards.
- The async FastMCP tool runs its blocking adapter through an AnyIO worker thread.
- The load-bearing description directs QField, planted-pole, cable, drop, QA,
  field-build, and sync-stat questions to this tool. It states that planted means
  physically in the ground despite missing photos or pending/failed QA.
- Registered the module once from `server.py` and made the test fixture evict
  both module-cache entries and stale package attributes before each fresh
  FastMCP server import.
- Added an opt-in dev smoke test. It skips unless `FF_DEV_TOKEN` is present and
  never prints the token or response body.

## TDD evidence

### RED

Command:

```bash
env -u FF_DEV_TOKEN FF_MCP_CALLBACK_SECRET=test-secret \
  python3 -m pytest apps/ff_mcp/test_qfield_tools.py -q
```

Result: `10 failed`. Nine cases failed because `ff_mcp.qfield_tools` did not
exist, and the registration case found zero `get_qfield_project_stats` tools.
No Task 9 production module or registration existed for this run.

### GREEN

The same focused command passed:

```text
10 passed in 0.25s
```

The first implementation run exposed one additional registration-isolation
failure after repeated fixture imports. Investigation reproduced that removing a
submodule from `sys.modules` leaves its attribute on the `ff_mcp` package, which
can bind a side-effect module to an old FastMCP instance. The already-failing
exactly-once registration test drove the narrow fixture correction.

## Verification

Complete offline MCP suite with the live token explicitly removed:

```bash
env -u FF_DEV_TOKEN FF_MCP_CALLBACK_SECRET=test-secret \
  python3 -m pytest apps/ff_mcp/ -q
```

Result:

```text
76 passed, 1 skipped in 0.62s
```

The single skip was verified separately:

```text
SKIPPED: FF_DEV_TOKEN is required for the live dev smoke
1 skipped in 0.22s
```

Additional gates:

- `python3 -m compileall -q apps/ff_mcp` — passed. The MCP package defines no
  Python lint or static-type command in its `pyproject.toml`.
- `git diff --cached --check` — passed.
- All changed and created files are below 300 lines.
- Staged `npm run ci:quick` — passed: 8 gates passed, 0 failed, 1 warned,
  2 skipped. The warning is the repository baseline of 58 pre-existing
  TypeScript errors; changed-file zero tolerance and secret scan passed.

## Self-review

- The adapter contains no HTTP client, token lookup, rate limiter, timeout,
  response parser, alternate path, fallback, logging, or business aggregation.
- The fixed endpoint and hand-derived encoded query are asserted for all seven
  allowed sections; defaults and the generated FastMCP input schema are asserted.
- Worker-thread execution, exactly-once registration, and all load-bearing
  physical-planting wording are behavior-tested.
- The ordinary suite cannot make a dev API call without `FF_DEV_TOKEN`; no live
  request was made during Task 9 verification.
- No deploy, publish, production access, migration, generic-tool change, or
  unrelated edit was performed.

## Concerns

- Repository-wide TypeScript remains at its pre-existing 58-error baseline,
  reported as non-blocking by `ci:quick`. Task 9 contains no TypeScript changes.
- The authenticated dev smoke remains intentionally unexecuted because no
  `FF_DEV_TOKEN` was supplied.

## Fix round 1 — preserve catalogue tools across fresh test servers

### Review finding

The fixture evicted `server`, `tools`, and `qfield_tools`, but left
`ff_mcp.catalogue` in both `sys.modules` and the `ff_mcp` package attributes.
Because catalogue registration is an import side effect, its cached module stayed
bound to the previous FastMCP instance. A later fresh server therefore exposed
only `fibreflow_get` and `get_qfield_project_stats`, losing `list_endpoints` and
`describe_endpoint`.

### TDD evidence

The regression requests two real fresh `svc` fixtures and requires the complete
four-tool set exactly once on each.

RED:

```text
.F
1 failed, 1 passed
```

The second fresh import was missing exactly `list_endpoints` and
`describe_endpoint`.

GREEN after adding `ff_mcp.catalogue` to the existing module/package eviction
tuple:

```text
2 passed in 0.24s
```

Focused Task 9 suite:

```text
12 passed in 0.30s
```

Complete offline MCP suite with `FF_DEV_TOKEN` explicitly removed:

```text
78 passed, 1 skipped in 0.73s
```

The skip remains the opt-in authenticated dev smoke. No live request was made.
`python3 -m compileall -q apps/ff_mcp` and `git diff --check` also passed.
