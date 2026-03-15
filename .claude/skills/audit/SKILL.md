---
name: audit
description: FibreFlow Daily Audit Framework. Comprehensive system health checks covering APIs, database, external services, navigation, and cross-module integrations. USE WHEN user says '/audit', 'audit system', 'run daily audit', 'health check all', 'system audit'.
disable-model-invocation: true
---


# /audit - FibreFlow Daily Audit

Comprehensive daily audit system covering API endpoints, database, external services, navigation, and cross-module integrations.

## Quick Reference

```bash
# Full audit (all suites)
tsx scripts/daily-audit/runner.ts

# Quick audit (P0 only)
tsx scripts/daily-audit/runner.ts --quick

# Specific suite
tsx scripts/daily-audit/runner.ts --suite api-health
tsx scripts/daily-audit/runner.ts --suite database-health
tsx scripts/daily-audit/runner.ts --suite external-services
tsx scripts/daily-audit/runner.ts --suite navigation
tsx scripts/daily-audit/runner.ts --suite cross-module
```

## Suites

| Suite | Priority | Description |
|-------|----------|-------------|
| `database-health` | P0 | DB connectivity, latency, tables |
| `external-services` | P0 | VLM, WhatsApp, 1Map, Sage, Resend |
| `api-health` | P0 | 573 API endpoints |
| `navigation` | P1 | 210 pages, sidebar sections |
| `cross-module` | P1 | Module integrations |

## Reports

After running, reports are available at:
- **HTML**: `public/audit-report.html`
- **JSON**: `scripts/daily-audit/results/YYYY-MM-DD.json`
- **Latest**: `scripts/daily-audit/results/latest.json`

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All tests passed |
| 1 | P0 failures (critical) |
| 2 | P1 failures (warning) |

## Options

| Flag | Description |
|------|-------------|
| `--quick`, `-q` | Run P0 tests only |
| `--suite`, `-s <name>` | Run specific suite |
| `--skip-reports` | Skip report generation |
| `--skip-slack` | Skip Slack notification |

## Scheduling

The audit runs automatically at 05:30 daily via systemd timer on Velocity server.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AUDIT_ENV` | Override environment (production/development) |
| `AUDIT_LOG_LEVEL` | Log verbosity (debug/info/warn/error) |
| `AUDIT_LOG_FILE` | Set to "true" to write log files |
| `SLACK_AUDIT_WEBHOOK` | Slack webhook URL for notifications |

## Workflow

When user says "/audit":

1. **Quick check**: Run `--quick` for fast P0-only results
2. **Full audit**: Run without flags for comprehensive check
3. **Specific issue**: Use `--suite` to focus on problem area
4. **View results**: Open HTML report in browser

## Interpreting Results

### Status Indicators

- 🟢 **Healthy**: All tests pass
- 🟡 **Degraded**: P1 failures or warnings
- 🔴 **Unhealthy**: P0 failures (critical)

### Priority Levels

- **P0**: Critical - must pass for system operation
- **P1**: Important - should pass for full functionality
- **P2**: Nice to have - informational

## Troubleshooting

### Common Issues

1. **Database timeout**: Check Neon DB status, network connectivity
2. **VLM down**: SSH to Velocity, check `systemctl status vllm`
3. **WhatsApp services**: SSH to VPS, check bridge/sender services
4. **API failures**: Check server logs, may need restart

### Re-running After Fixes

```bash
# Re-run just the failing suite
tsx scripts/daily-audit/runner.ts --suite external-services

# Quick re-check
tsx scripts/daily-audit/runner.ts --quick
```
