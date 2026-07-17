# /goal — QFieldCloud Storage Recovery & Delta Backlog (run autonomously until DONE)

> **How to use:** start a fresh session on Opus, in a worktree off `master`, and run:
> `/goal Execute docs/plans/qfieldcloud-storage-recovery-goal.md to completion. Work autonomously through triage → reclaim → durability → delta fix; do not stop to ask; only halt for a genuine external blocker that needs Hein. Loop until every Success Criterion is verified true, then write a handoff and stop.`

---

## 1. Mission (one goal)

Make QFieldCloud storage healthy and stop losing field edits. Four outcomes, **in this order**:
recover what is still recoverable, reclaim ~650 GB from the 90%-full root disk, give the photo
evidence a real second copy, then fix the `delta_apply` failures stranding field work.

**IN scope:** MinIO version/disk reclamation, photo durability, delta backlog recovery, guards
against recurrence.

**NOT in scope:** the `TEM.S.*` / Works QA "planned register" work — separate PR, separate blast
radius (see §10). Do not touch `pages/api/works-qa/*` or the `poles` table in this goal.

Keep iterating until **all** Success Criteria (§7) are verified live. Do not pause for
confirmation. Only halt for a genuine external blocker.

## 2. What is already DONE — do NOT redo

Diagnosed 2026-07-17. Everything was read-only **except** the restore.

- **276 dead photo links RESTORED.** `qfield_photo_validations` referenced 276 delete-marked keys
  returning 404. Restored via `mc undo --force`. Result: `restored=275, already_readable=1,
  failed=0`. Independently re-verified: 40/40 sampled return real bytes. **Do not re-run.**
- **Root cause of `delta_apply` failures IDENTIFIED — do not re-diagnose:**
  `ConnectionResetError(104)` at the `download_project_directory` step. The worker downloads the
  *entire* project dir before applying any delta — 6.5 GB for FT_Mohadin. The job dies before
  `apply_deltas` runs, so every delta in that batch is marked `error` with `modified_pk=None`.
  Stack: `qfc_worker/utils.py:424 download_project` → `sdk.download_files` → `_request("GET")`.
- **Ruled OUT — do not chase these again:**
  - *Not OOM:* `OOMKilled=false`; **zero** cgroup OOM events in 7d. The only kernel "out of memory"
    hits are NVRM/GPU from Jul 12 — unrelated. (This one misled me initially.)
  - *Not the 30-min timeout:* `WORKER_TIMEOUT_S=1800`, but killed jobs die in ~1s.
  - *Not gunicorn saturation:* `GUNICORN_WORKERS=12` ≥ 8 `worker_wrapper` containers.
  - *Not gunicorn recycling:* zero `Booting worker` / `WORKER TIMEOUT` events in 7d.
  - *Not the MinIO bridge-IP bug:* `STORAGES` correctly uses `http://minio:9000`.
  - *Not layer detection:* `read_gpkg.py detect_layer_type` matches `poletype` correctly.
- **Delete markers are NOT one bulk accident.** They span **162 projects** across different dates
  (project `00454449…` has 89 markers all on 2025-12-08; others on 2026-04-02). This is routine
  QFC file lifecycle (replaced GPKGs/project files) — which is why §5.2 is comparatively low-risk.
- **Job failure rate is NOT an acute crisis:** 3.9% (24h) / 5.8% (7d) / 4.2% (30d). The 1,787
  failed + 864 stuck jobs are a months-long accumulation. **The delta rate is the real signal**
  (§5.4).

## 3. Environment — get this wrong and nothing runs

- Box is **Velo itself** (`hostname` = `velo-server`) — run Bash directly, **never ssh**.
- **Branch off `master` into a worktree** before any change (`[[feedback_always_use_worktree]]`).
  A hook blocks writes to the main tree at `/home/hein/Workspace/FF_Next.js`. Never commit to
  master. All changes via PR.
- **DB:** self-hosted Supabase Postgres, `100.96.203.105:5437`, db `fibreflow`, user
  `fibreflow_user`. Password: **see `.claude/credentials.local.md`** — never inline it in a file,
  commit, or PR body. Use `PGPASSWORD="$PGPASSWORD" psql …`.
- **Single DB shared by dev + production.** Any migration hits both immediately.
- **MinIO:** host `/usr/bin/mc` is GNU Midnight Commander, **not** the MinIO client. Always
  `docker exec qfieldcloud-minio-1 mc …`. Bucket `qfieldcloud-prod`, alias `local`. Erasure-coded —
  you cannot `cat` files off disk directly.
- **Never** `pkill -f node` / `pkill -f npm` — kills Claude itself. Use `systemctl` or a specific PID.

## 4. Canonical facts + how to regenerate the key lists

Verified 2026-07-17. Re-derive rather than trusting these if >1 week stale.

```
root disk /:            1.9T total, 1.6T used, 184G avail, 90% FULL   <- the problem
/srv/storage (nvme2n1): 3.7T total, 3.0T avail, 16% used              <- the headroom
MinIO physical:         ~788 GB (4 x 197G docker volumes, ALL on the root LVM)
MinIO current objects:  48 GiB / 57,859   (qfieldcloud-prod)
MinIO all versions:     375 GiB / 120,856
qfieldcloud-backups:    14 GiB / 1,926 (un-versioned)
delete markers:         58,295   |  real data versions: 120,875
lifecycle rules:        NONE ("The lifecycle configuration does not exist")
```

**MinIO's redundancy is an illusion.** All 4 erasure "drives" are Docker volumes on the SAME
physical disk (`/var/lib/docker/volumes/qfieldcloud_minio_data{1..4}` →
`/dev/mapper/ubuntu--vg-ubuntu--lv` → `nvme0n1p3`). Losing that NVMe loses all 4 shards. Never
treat MinIO as a durable second copy.

**Why expiry is safe for current data:** QFieldCloud versions files **in the object key**
(`…/Civil Audit.gpkg/v20260310073743-23238761`), so each QFC version is a distinct object with a
single MinIO version. MinIO bucket versioning is a **separate, redundant layer QFC never reads.**

Regenerate the delete-marked key list:
```bash
docker exec qfieldcloud-minio-1 mc ls --versions --recursive local/qfieldcloud-prod \
  | awk '{isdel=0; for(i=1;i<=NF;i++) if($i=="DEL") isdel=1; if(isdel) print}' \
  | sed -E 's/^.*DEL //' | sed 's|^/||' | sort -u > delmarked_clean.txt
```
**Gotcha:** the token is `DEL`, not `DELETE`. Matching `"DELETE"` yields a **false zero** and you
will wrongly conclude there are no delete markers. This bit once already. Also strip the `DEL `
prefix before any `comm` — leaving it produces a false-zero intersection.

**The safety gate — re-run after every destructive step; MUST be empty:**
```bash
# construction_qa_photos = what FF SERVES (18,578 rows source='qfield')
psql … -t -A -c "SELECT storage_key FROM construction_qa_photos WHERE source='qfield';" \
  | sed 's|^/||' | sort -u > ffkeys_all.txt
comm -12 ffkeys_all.txt delmarked_clean.txt   # MUST be empty
```

## 5. What to do (locked design — don't re-litigate)

### 5.1 Triage the orphaned photos (BEFORE any expiry)
~145 deleted DCIM photos are known to **neither** `qfield_photo_validations` **nor**
`construction_qa_photos`. Their only bytes are noncurrent versions, so expiry destroys them.
Derive the list (deleted DCIM filenames minus those known to FF), restore with
`mc undo --force`, then ingest via `python3 scripts/extract-gpkg-photos.py --all --force`.
Report any that cannot be attributed to a project/feature — never silently drop
(`[[feedback_data_safety]]`).

### 5.2 ILM lifecycle rule — reclaims ~650 GB
Only after 5.1. Expire **noncurrent versions only**; never touch current versions.
- Pilot on **one project prefix**, measure reclaim, re-run the §4 gate, then widen.
- Keep `NoncurrentVersionExpiration` generous (retain >= 30 days / >= 1 noncurrent version) so a
  bad delete stays recoverable.
- `mc ilm rule add --expire-delete-marker` for markers whose data has already expired.
- Re-check `df -h /` after each stage. Expect root 90% -> ~55-60%.

### 5.3 Photo durability
- `node scripts/sync-qfield-photos-to-local.js` (batch with `--limit`) copies the 18,578
  `source='qfield'` photos to `/home/velo/storage/qa-photos/<project-slug>/<feature-id>/<file>`
  (-> `/srv/storage`, 3.0 T free). Script flips `source='local'` and rewrites `storage_key`.
  ~10 GB. This moves data OFF the 90%-full disk onto the empty one — a win either way.
- Verify: `SELECT count(*) FROM construction_qa_photos WHERE source='qfield'` -> **0**.
- **`/srv/storage` has NO RAID and NO backup job.** Every backup on this box (`db-backup.sh`,
  `qfc-pg-backup.sh`, `bugsink/backup.sh`) covers a database, not the 37 GB of photo evidence.
  Add a backup for `/srv/storage/qa-photos` **before** it becomes the only copy.

### 5.4 Fix the delta backlog (the actual field-data loss)
2,159 deltas unapplied (1,789 `error` + 370 `not_applied`) vs 23,862 applied. Baseline ~4%, but
**last 24h = 22.3%** — actively accruing. Worst: MOA_Pole_Audit 834, FT_Mohadin 699,
FT_Etwatwa_POP_2 165, FT_Lawley 134. Oldest 2025-11-13; newest still arriving.
These are real submissions — one sampled delta carried `Status: "Optical Complete"`,
`QA Optical Comments: "Pole QA pass"` and 4 photos.
- Root cause is the 6.5 GB project download (§2). Reduce payload: DCIM is 62–96% of every project
  (FT_Mohadin 4,053 MB of 6,555 MB; LAW_Pole_Audit 96%; VT_Tonga 94%; FT_Etwatwa_POP_2 87%).
- **Pruning DCIM from the cloud project is destructive and NOT approved.** It is gated on §5.3
  completing (otherwise it breaks the 18,578 photos FF serves from MinIO) **and** on Hein's
  retention decision: *do crews need historical photos on their tablets?* Do not prune without it.
- Evaluate the non-destructive options first: field-side "Automatically download attached files"
  off, and/or excluding DCIM from the worker's download scope.
- Then re-queue the stranded deltas and prove they apply.

### 5.5 Guards (or we are back here in 3 months)
- The ILM rule is the permanent guard for version bloat.
- Alert when root `/` > 80%.
- The resizer is what inflated storage: every 10–20 MB original it "replaced" is retained as a
  noncurrent version, so resizing freed nothing at the storage layer. Confirm the ILM rule covers
  it, or the bloat returns.

## 6. Discipline (mandatory)

- **`superpowers:systematic-debugging`** — root cause before fixes. §2 lists what is already ruled
  out; do not re-litigate it.
- **`superpowers:verification-before-completion`** — never claim done without running the command
  and showing output. "Should work" / "looks good" are forbidden.
- **Blind `/review`** before merging any code change. Never self-review.
- **NLNH** — state HIGH/MEDIUM/LOW confidence; say "I don't know".
- Anything destructive (prune, expiry beyond the pilot prefix): confirm with Hein first.
- `npm run ci:quick` before any PR.

## 7. Success Criteria — DONE = all verified true

1. §4 safety gate returns **0** FF-served keys delete-marked (re-run after every destructive step).
2. Orphaned photos triaged: restored + ingested, or explicitly reported as unattributable.
3. ILM rule live; `df -h /` shows root **< 70%** (from 90%); current objects untouched — proven by
   re-running the §4 gate **and** spot-reading 20 FF photo keys for real bytes.
4. `SELECT count(*) FROM construction_qa_photos WHERE source='qfield'` -> **0**.
5. A backup exists for `/srv/storage/qa-photos` and has completed one successful run.
6. Trailing-24h delta unapplied rate **< 5%** (from 22.3%), measured twice >= 6h apart.
7. Stranded deltas re-queued; **live proof** that previously-failed deltas reach
   `last_status='applied'`.
8. Memory updated (`project_velo_disk_space.md`, new `project_qfieldcloud_storage_recovery.md`)
   and handoff written.

## 8. Deploy & safety rules

- **Production time gate:** no risky action 08:00–17:00 SAST Mon–Fri. Prune/expiry = after hours,
  with Hein's approval.
- Never edit deploy dirs (`/home/velo/fibreflow-*`). Deploy only via `bash scripts/deploy-local.sh`.
- Never `--no-verify` past the secret-scan hook.
- **No credentials in this file, any doc, commit message, or PR body** — reference
  `.claude/credentials.local.md`.
- MinIO expiry is irreversible once noncurrent versions are gone. Pilot on one prefix first.

## 9. Autonomous loop behavior

- Each cycle: pick the next incomplete Success Criterion, advance it, verify with real output,
  repeat.
- **Exit only when** all §7 criteria are verified true **or** a genuine external blocker (Hein's
  retention decision on §5.4 is the likely one — do the rest around it).
- Don't gold-plate. Prove it, ship it.

## 10. Explicitly deferred — separate PR, do not start here

The original trigger was `TEM.S.C885`/`C886` missing from Works QA PON 220. Diagnosed but
**parked**:
- The design GPKG leaves zone/PON blank on 60 of 69 `TEM.S.*` poles (C885/C886 included); PIP
  against `pon_boundaries` resolves both to PON 220 / Zone 19.
- The GPKG poles import has been broken since 2026-02-14: `importPoles` uses
  `ON CONFLICT (project_id, pole_number)`, which does not cover the redundant **global**
  `poles_pole_number_unique`; a colliding generic label (`New pole `, owned by Mamelodi) kills the
  whole 1000-row batch. No FK references `poles`; no global duplicates exist.
- `zones.ts` builds "planned" from `sow_poles ∪ pole_qa_photos` while `poles.ts` builds the list
  from `poles ∪ pole_qa_photos`. **6 of 9 projects have zero `sow_poles`**, so "planned" is
  degenerate (Thembisa reads `8 planned -> 8 planted -> 8 QA'd -> 8 approved`).
- Unioning `poles` into `pole_pool` is provably non-regressive (Lawley/Mamelodi unchanged) but
  re-bases 6 projects' headline numbers (Grabouw 121 -> 3793). Needs its own PR + PM comms.

**Out of scope here.**
