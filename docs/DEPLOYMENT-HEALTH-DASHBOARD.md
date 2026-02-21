# Deployment Health Dashboard

> **Real-time service monitoring and CI/CD visibility**  
> **Launched:** 2026-02-21  
> **Location:** `/deployment` (SYSTEM_ADMIN only)

---

## Overview

The Deployment Health Dashboard provides a unified view of all FibreFlow services, GitHub Actions CI/CD status, and system error logs. It replaces manual health checks with automated, real-time monitoring accessible from the web UI.

### Key Features
- **Service Health Cards** — HTTP status, response time, uptime, deployed commit, database status
- **GitHub Actions Widget** — Last 8 CI runs with commit messages and status
- **Error Log Tail** — Recent errors from journalctl with 5-minute and 1-hour counts
- **Deployed Commits Matrix** — Git SHA comparison across environments with drift detection
- **Auto-refresh** — Updates every 30 seconds with countdown timer
- **Graceful degradation** — Individual service failures don't break the page

---

## Access

**URL:** https://app.fibreflow.app/deployment

**Permissions:** `SYSTEM_ADMIN` role only

**Navigation:** System → Deployment Health

---

## Architecture

### API Endpoint

**`GET /api/deployment-health`**

Protected by `withAuth` middleware. Fetches data from:
1. **FibreFlow Production** (app.fibreflow.app)
2. **FibreFlow Staging** (vf.fibreflow.app)
3. **FibreFlow Dev** (dev.fibreflow.app)
4. **GazTime API** (gaztime.fibreflow.app/api)
5. **GitHub Actions API** (last 8 workflow runs)
6. **System Error Log** (journalctl, last 100 lines)

**Parallel Fetching:** All services checked simultaneously  
**Timeout:** 6 seconds per service  
**Error Handling:** Individual failures return gracefully degraded data

### Response Format

```json
{
  "services": [
    {
      "name": "FibreFlow Production",
      "url": "https://app.fibreflow.app",
      "status": "healthy",
      "http_status": 200,
      "response_time": 145,
      "uptime": "8d 12h",
      "git_commit": "5aa58011",
      "git_commit_short": "5aa5801",
      "deployed_at": "2026-02-21T10:30:00Z",
      "database_status": "connected",
      "error": null
    }
  ],
  "github_actions": {
    "runs": [
      {
        "id": 123456,
        "status": "completed",
        "conclusion": "success",
        "commit_sha": "5aa58011",
        "commit_message": "fix: auth isolation sweep",
        "created_at": "2026-02-21T10:00:00Z",
        "html_url": "https://github.com/..."
      }
    ],
    "error": null
  },
  "error_log": {
    "recent_lines": ["line1", "line2"],
    "error_count_5m": 2,
    "error_count_1h": 15,
    "error": null
  },
  "deployed_commits": {
    "production": "5aa58011",
    "staging": "5aa58011",
    "dev": "8641f1eb",
    "drift_detected": true
  }
}
```

---

## UI Components

### Service Health Cards

Each service displays:
- **Status Badge:** Green (healthy), Yellow (degraded), Red (down)
- **HTTP Status:** 200, 503, etc.
- **Response Time:** Milliseconds
- **Uptime:** Days/hours
- **Deployed Commit:** Git SHA with link to GitHub
- **Database Status:** Connected/error
- **Last Checked:** Timestamp

### GitHub Actions Widget

Shows last 8 workflow runs on `master` branch:
- **Status Icon:** ✅ Success, ❌ Failure, ⏳ In Progress, ⚪ Skipped
- **Commit SHA:** First 7 characters
- **Commit Message:** Truncated to 60 chars
- **Created At:** Relative time (e.g., "2 hours ago")
- **Link:** Click to open GitHub Actions run

### Error Log Tail

Displays recent system errors:
- **Error Counts:** Last 5 minutes and last 1 hour
- **Recent Lines:** Last 10-20 error log entries
- **Color Coding:** Red for errors, yellow for warnings

### Deployed Commits Matrix

Compares deployed commits across environments:
```
Production: 5aa58011
Staging:    5aa58011
Dev:        8641f1eb  ⚠ Drift detected
```

Shows **drift warning** when environments are out of sync.

### Auto-Refresh

- **Interval:** 30 seconds
- **Countdown Timer:** Shows seconds until next refresh
- **Pause/Resume:** Click to pause auto-refresh

---

## Health Check Endpoint Integration

Each service's `/api/health` endpoint returns:

```json
{
  "status": "healthy",
  "uptime": 123456,
  "version": {
    "gitCommit": "5aa58011",
    "gitCommitShort": "5aa5801",
    "builtAt": "2026-02-21T10:30:00Z"
  },
  "checks": {
    "database": "connected",
    "memory": "ok"
  }
}
```

See `docs/INFRASTRUCTURE.md` for full health endpoint documentation.

---

## Use Cases

### 1. Deployment Verification

After deploying to production:
1. Navigate to `/deployment`
2. Verify service status is green
3. Check deployed commit matches expected SHA
4. Confirm database connection is healthy
5. Review error log for new issues

### 2. Incident Response

During an outage:
1. Check which services are down (red status)
2. Review error log for recent errors
3. Compare deployed commits (drift may indicate bad deploy)
4. Check GitHub Actions for failed deployments
5. Investigate specific service errors

### 3. CI/CD Monitoring

Track deployment pipeline health:
1. Review GitHub Actions run history
2. Identify flaky tests or failed builds
3. Correlate failed runs with service issues
4. Monitor deployment frequency

### 4. Environment Drift Detection

Ensure environments stay in sync:
1. Check deployed commits matrix
2. Investigate drift warnings
3. Promote staging to production when ready
4. Rollback production if needed

---

## Configuration

### Environment Variables

```bash
# GitHub Actions API (read-only)
GITHUB_TOKEN=ghp_xxxxx

# Service URLs (defaults)
NEXT_PUBLIC_FIBREFLOW_PROD_URL=https://app.fibreflow.app
NEXT_PUBLIC_FIBREFLOW_STAGING_URL=https://vf.fibreflow.app
NEXT_PUBLIC_FIBREFLOW_DEV_URL=https://dev.fibreflow.app
NEXT_PUBLIC_GAZTIME_API_URL=https://gaztime.fibreflow.app/api
```

### Timeouts

- **Service health check:** 6 seconds
- **GitHub API:** 6 seconds
- **Error log fetch:** 3 seconds

---

## Monitoring

### Page Performance

- **Load time:** ~1-2 seconds (parallel fetching)
- **Refresh time:** ~500ms-1s (cached responses)
- **API latency:** ~200-500ms per service

### Common Issues

**Service shows as down but is accessible**
- Check timeout settings (may need increase for slow responses)
- Verify `/api/health` endpoint exists and returns correct format
- Check network connectivity from production server

**GitHub Actions not showing**
- Verify `GITHUB_TOKEN` has `repo` scope
- Check token hasn't expired
- Ensure repository name is correct in API call

**Error log empty**
- Verify `journalctl` permissions on server
- Check log format parsing (may need adjustment for different systemd versions)

**Drift detected incorrectly**
- Verify git SHA format (should be first 8 chars)
- Check `/api/health` version field exists
- Ensure all services deployed from same repo

---

## Future Enhancements

### Planned
- [ ] Alert notifications when services go down
- [ ] Historical uptime tracking (SLA metrics)
- [ ] Deployment timeline (show deploy events)
- [ ] Service dependency graph
- [ ] Prometheus metrics integration

### Under Consideration
- [ ] Mobile app view
- [ ] Slack/Discord integration for alerts
- [ ] Custom health check rules per service
- [ ] Automated rollback on health check failures
- [ ] Performance trending (response time over 24h)

---

## Related Files

**Frontend:**
- `pages/deployment.tsx` — Dashboard page
- `pages/api/deployment-health.ts` — API endpoint

**Navigation:**
- `src/components/layout/sidebar/config/systemSection.ts` — Sidebar entry

**Documentation:**
- `docs/INFRASTRUCTURE.md` — `/api/health` endpoint spec

---

## Support

**For issues with the dashboard:**
- **Frontend/UI:** Flow (Apps)
- **API/Backend:** Elon (CTO)
- **DevOps/Monitoring:** Forge
- **Documentation:** Scribe

**Commit:** `bbe0ba7c` (2026-02-21)

---

**Last Updated:** 2026-02-21 13:00 SAST  
**Maintained By:** Scribe
