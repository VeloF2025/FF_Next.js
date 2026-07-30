# Task 11 report — integrated verification, DEV deploy, and PR handoff

## Result

The QField project-statistics feature was integrated with current
`origin/master`, verified locally, and deployed to DEV through the mandatory
deployment script. DEV is serving the feature merge commit and its health route
returns HTTP 200.

The authenticated Mahikeng, missing-project, and live MCP adapter smokes remain
pending because no safe `FF_DEV_TOKEN` could be acquired. No result or count was
fabricated, no connector or browser grant was accessed, and production was not
deployed.

## Master integration

- Pre-integration feature HEAD:
  `9bd7c3ef4eb144546c89f3a5dedce5060d7babab`.
- Fetched `origin/master`:
  `e49b84bb8f58074394404886afec572909535e47`.
- Before integration the branch was 22 commits ahead and 14 behind.
- `git merge --no-edit origin/master` completed without conflicts.
- Integration merge:
  `0e2628b11fe22ffa6c3da3c7db0b5bb093426528`.
- After integration the branch was 23 commits ahead and 0 behind.

## Required verification

### Focused TypeScript and API tests

```bash
npx vitest run src/modules/qfield-sync/project-stats/__tests__ \
  tests/api/qfield/project-stats.test.ts
```

Result: 13 test files passed, 73 tests passed, 0 failed, 0 skipped. Vitest
reported only the repository's existing Vite CJS deprecation warning.

### Complete offline MCP suite

```bash
env -u FF_DEV_TOKEN FF_MCP_CALLBACK_SECRET=test-secret \
  python3 -m pytest apps/ff_mcp/ -q
```

Result: 79 passed, 1 skipped. The only skip was the deliberately opt-in live
DEV smoke that requires `FF_DEV_TOKEN`; the variable was explicitly removed for
this offline run.

### Repository quality gates

`npm run ci:quick` exited zero:

```text
ESLint: 0 errors, 185 warnings at the accepted baseline
Silent catches: 78 at the accepted baseline
Neon-shim SQL divergence: none
QField step detection, GPKG resolution, and hierarchy mapping: pass
TypeScript: 58 pre-existing errors, non-blocking
Secret scan: no new credential-like content
Passed: 8  Failed: 0  Warned: 1  Skipped: 2
```

`npm run claude-md:check` exited zero in non-strict mode and reported exactly
127 pre-existing stale references outside the Task 10 QField documentation
changes.

`npm run antihall` could not execute because `package.json` points to
`scripts/antihall-validator.cjs`, which is absent from:

- current `origin/master`;
- pre-integration feature HEAD `9bd7c3ef4e`;
- merged feature HEAD `0e2628b11f`; and
- all fetched path history (`git log --all -- scripts/antihall-validator.cjs`
  returned no commits).

This is an inherited unavailable repository gate, not a QField feature
regression. The task owner approved proceeding without adding an unrelated
replacement validator.

`git diff --check origin/master...HEAD` exited zero.

Before adding this report, the feature diff was:

```text
48 files changed, 7578 insertions(+), 4 deletions(-)
```

## Scope and security audit

The final feature diff was reviewed with `git diff --stat`,
`git diff --name-status`, targeted production-file searches, and the repository
secret scan.

- No migration file or schema change is present.
- No deploy-directory or credential file is present.
- No connector/session diagnostic work from PR 2 is present.
- The API route accepts GET only and retains
  `withAuth(withPermission('projects', 'view'))`.
- The MCP adapter calls only the fixed GET project-statistics path.
- Production queries are read-only; no insert, update, delete, or write endpoint
  was introduced.
- Responses and production logs contain no token, credential, raw QField record
  payload, customer name, address, geometry, or photo body.
- Credential-like strings found by a broad diff search were test-only sentinel
  values used to prove upstream errors and raw payloads are excluded.
- No production deployment or production smoke was performed.

The physical planted-pole definition remains: one distinct QField civil feature
whose last successfully applied physical-state event leaves it in the ground.
Missing photos and pending or failed QA do not make it unplanted. Photo-incomplete
planted poles therefore remain included in the planted total; quality state is
reported separately.

Required-source failure returns unavailable rather than zero. Optional-source
failure returns a partial result with affected values null and safe source-health
warnings. Sync-job statistics remain explicitly `scope: "system"` because the
current sync tables have no project identifier.

## DEV deployment

The first literal plan command:

```bash
bash scripts/deploy-local.sh dev
```

used the script's default `master` branch, redeployed `e49b84bb8`, and restored
DEV health to HTTP 200. Inspection confirmed the supported feature mechanism is
the same mandatory script with `--branch`. The verified integrated feature
commit was pushed to establish that remote branch, then deployed with:

```bash
bash scripts/deploy-local.sh dev \
  --branch docs/qfield-mcp-project-stats-design
```

Result:

```text
Environment: dev
Branch: docs/qfield-mcp-project-stats-design
Commit: e49b84bb8 -> 0e2628b11
Build ID: m10WH-KdNIQGfbKq3_QFj
Duration: 254 seconds
Service: active
Health: HTTP 200
```

The deploy script found zero pending migrations and skipped the shared prestart
guard sync because the deployed branch is not `master`. A direct read-only check
confirmed:

```text
deployed branch: docs/qfield-mcp-project-stats-design
deployed SHA: 0e2628b11fe22ffa6c3da3c7db0b5bb093426528
/api/health: HTTP 200
unauthenticated /api/qfield/project-stats: HTTP 401
```

## Token-dependent smoke status

`FF_DEV_TOKEN` was absent. The documented local credential file contains
database, infrastructure, and integration credentials, but no FibreFlow
application email/password, short-lived application token, or authenticated
application session.

The repository's supported token-mint endpoints require an already verified
interactive `req.user`; the mint implementation explicitly forbids a
client-selected identity. Acquiring a browser cookie, harvesting a removed
connector grant, or directly minting an impersonated identity would not be a
safe application-auth flow and was not attempted.

Pending solely on a safely supplied `FF_DEV_TOKEN`:

1. authenticated Mahikeng summary verification, including `HT_Mahikeng`,
   non-null physical planted count, photo-incomplete inclusion, QField health
   `ok`, system sync scope, and no raw payload;
2. missing-project HTTP 404 with `error.code = "NOT_FOUND"`; and
3. unskipped `apps/ff_mcp/test_qfield_tools_live.py` through the real HTTP
   adapter.

No smoke-driven defect was observed, so no regression fix or empty correction
commit was created.

## Production gate

Production is not deployed. Production deployment and its live connector smoke
remain a separate, after-hours action requiring Hein's explicit approval after
review and checks pass.
