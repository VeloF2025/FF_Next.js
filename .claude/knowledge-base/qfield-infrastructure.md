# QFieldCloud Infrastructure Learnings

## Incident: THM_3_Site_Audit_2026 Failed (Feb 10, 2026)

### What Happened
Project THM_3_Site_Audit_2026 stuck in `failed` / `failed_process_projectfile` status. Multiple jobs failing with "UNKNOWN" error type. Users unable to sync from QField app.

### Root Causes Found

#### 1. Gunicorn Worker Saturation
- **Problem:** 8 worker_wrapper containers making concurrent HTTP requests to download project files, but only 4 gunicorn workers serving them
- **Error:** `ConnectionResetError(104, 'Connection reset by peer')` during `download_project_directory`
- **Pattern:** Intermittent - 77 succeeded vs 14 failed (85% success rate)
- **Fix:** Increased `GUNICORN_WORKERS=8` and `GUNICORN_MAX_REQUESTS=5000` in `.env`

#### 2. Zombie Jobs Blocking Queue
- **Problem:** 16 failed jobs had `started_at` set but `finished_at=NULL` - workers crashed mid-job
- **Effect:** Project locked as `busy`, preventing new jobs from being picked up
- **Fix:** Set `finished_at=timezone.now()` on all stuck failed jobs

#### 3. Orphaned Queued Jobs
- **Problem:** Job set to `queued` by dequeue loop, but worker crashed before processing it
- **Effect:** Dequeue logic only picks up `PENDING` jobs; `QUEUED` jobs are assumed to be actively running
- **Fix:** Reset orphaned `queued` jobs (no `started_at`) back to `PENDING`

#### 4. Multi-Table Inheritance Bug
- **Problem:** Created job via `Job.objects.create()` instead of `ProcessProjectfileJob.objects.create()`
- **Effect:** Row only in `core_job` table, not in `core_processprojectfilejob` child table
- **Error:** `AttributeError: 'ProcessProjectfileJobRun' object has no attribute 'job'` (constructor fails to load from child table, except handler references unset `self.job`)
- **Fix:** ALWAYS use the specific child model to create jobs

#### 5. Static Files Not Served (Admin UI Unstyled)
- **Problem:** `static_volume` only mounted in `app` and `worker_wrapper`, NOT in `nginx`
- **Effect:** Django admin completely unstyled (no CSS/JS), returning 503 via Cloudflare
- **Fix:** Added `static_volume:/var/www/html/staticfiles:ro` to nginx in `docker-compose.override.yml`
- **Gotcha:** Cloudflare cached old 503 responses. Need hard refresh (Ctrl+Shift+R) or cache purge after fix.

### Key Learnings

1. **Gunicorn workers >= worker_wrappers** - Always match or exceed the worker count
2. **Never use base Job model** - Always use `ProcessProjectfileJob`, `PackageJob`, or `ApplyDeltaJob`
3. **Check for zombie jobs first** - Stuck jobs (started but not finished) are the #1 cause of "stuck project" issues
4. **Dequeue logic is strict** - Only picks up `PENDING` jobs for projects with NO `QUEUED`/`STARTED` jobs
5. **Static files need nginx volume** - Without it, Django admin is completely broken (no WhiteNoise middleware)
6. **Cloudflare caches errors** - After fixing 503s, old responses may be cached. Always test with cache bust.

### Changes Made (Feb 10, 2026)

| Change | File | Before | After |
|--------|------|--------|-------|
| Gunicorn workers | `.env` | `GUNICORN_WORKERS=4` | `GUNICORN_WORKERS=8` |
| Gunicorn max-requests | `.env` | `GUNICORN_MAX_REQUESTS=1000` | `GUNICORN_MAX_REQUESTS=5000` |
| Nginx static volume | `docker-compose.override.yml` | Not mounted | `static_volume:/var/www/html/staticfiles:ro` |
| Zombie jobs | Database | 16 stuck jobs | All given `finished_at` |

### Diagnostic Commands Quick Reference

```bash
# Check all containers
docker ps -a --filter "name=qfield"

# Check worker activity
for i in 1 2 3 4 5 6 7 8; do
  echo "=== wrapper-$i ==="
  docker logs --since 10m qfieldcloud-worker_wrapper-$i 2>&1 | grep -E 'Dequeued|Error|Finished' | tail -3
done

# Find stuck jobs
docker exec qfieldcloud-app-1 python manage.py shell -c "
from qfieldcloud.core.models import Job
stuck = Job.objects.filter(status='failed', started_at__isnull=False, finished_at__isnull=True)
print(f'Stuck: {stuck.count()}')
"

# Check project status
docker exec qfieldcloud-app-1 python manage.py shell -c "
from qfieldcloud.core.models import Project
p = Project.objects.get(pk='PROJECT_UUID')
print(f'{p.name}: status={p.status}, status_code={p.status_code}')
"

# Trigger reprocess (use child model!)
docker exec qfieldcloud-app-1 python manage.py shell -c "
from qfieldcloud.core.models import ProcessProjectfileJob, Project
p = Project.objects.get(pk='PROJECT_UUID')
job = ProcessProjectfileJob.objects.create(project=p, created_by=p.owner)
print(f'Job: {job.pk}')
"

# Test static files
curl -s -o /dev/null -w '%{http_code}' -H 'Host: qfield.fibreflow.app' http://localhost:8082/staticfiles/admin/css/base.css
```
