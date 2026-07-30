# Task 10 report — catalogue and QField documentation

## Delivered

- Added a real generated-catalogue regression assertion for
  `/api/qfield/project-stats` and its GET-only contract.
- Regenerated `apps/ff_mcp/endpoints.json` from the Pages API source; the route
  is catalogued as `GET` in the `qfield` group.
- Added the project-statistics endpoint, service folder, and the four required
  source/physical-state/sync-scope rules to the canonical QField module docs.
- Regenerated the scoped `AGENTS.md` mirror from `.claude.md`; the canonical
  quick reference is 45 lines.

## TDD evidence

### RED

```bash
FF_MCP_CALLBACK_SECRET=test-secret \
  python3 -m pytest apps/ff_mcp/test_catalogue.py::test_catalogue_contains_qfield_project_stats -q
```

The new assertion failed as expected with `assert None is not None`: the route
already existed in Pages API, but the committed generated catalogue did not yet
contain it.

### GREEN

```bash
npm run mcp:catalogue
```

The generator completed and the generated entry was inspected directly:

```json
{"path":"/api/qfield/project-stats","methods":["GET"],"group":"qfield"}
```

The focused MCP verification then passed:

```text
20 passed in 0.32s
```

The complete offline MCP suite also passed with its opt-in live smoke skipped:

```text
79 passed, 1 skipped in 0.88s
```

## Verification

- `npx vitest run scripts/__tests__/build-mcp-endpoint-catalogue.test.ts` —
  passed: 29 tests.
- `node scripts/mirror-agents-md.mjs` regenerated exactly the QField scoped
  `AGENTS.md` mirror.
- `npm run agents:check` — passed: 56 mirrors match their canonical source.
- `npm run claude-md:check` completed non-strictly and reported 127 pre-existing
  stale references outside the Task 10 files.
- `git diff --check` passed before staging.
- Staged `npm run ci:quick` exited 0. Its captured output confirms the ESLint
  gate passed with 0 errors and 185 warnings at the accepted baseline.

## Self-review

- The JSON catalogue was changed only by `npm run mcp:catalogue`; no generated
  route was hand-edited.
- The generated entry is GET-only and its group is exactly `qfield`.
- Both QField docs contain the required endpoint, project-statistics service
  folder, and canonical rules. The quick reference remains below its 50-line
  limit.
- No route, service, schema, deployment, live request, or publish action was
  changed or performed by this task.

## Concerns

- Regeneration also captured three already-present API routes that were absent
  from the older generated catalogue. This is generator output, not authored
  catalogue editing.
- The repository's non-strict documentation-path check has 127 pre-existing
  stale references; none was introduced by the QField documentation changes.
