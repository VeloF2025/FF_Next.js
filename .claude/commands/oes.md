# OES Import

Import and manage Nokia OES activation reports.

## Usage

```
/oes                 # Show OES status and guide
/oes status          # Database stats and coverage
/oes restart         # Restart staging server
/oes debug           # Diagnose issues
```

## Quick Start

**Import URL**: `https://vf.fibreflow.app/activate` (staging)

1. Navigate to URL
2. Click "OES Import" tab
3. Drag-drop Excel file
4. Preview → Import

## Check Status

```bash
# OES record count
PGPASSWORD='npg_MIUZXrg1tEY0' psql -h ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech -U neondb_owner -d neondb -c "SELECT COUNT(*) as total_oes_records FROM oes_activations;"

# Recent imports
PGPASSWORD='npg_MIUZXrg1tEY0' psql -h ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech -U neondb_owner -d neondb -c "SELECT filename, total_rows, matched_drops, imported_at FROM oes_import_batches ORDER BY imported_at DESC LIMIT 5;"

# OES coverage
PGPASSWORD='npg_MIUZXrg1tEY0' psql -h ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech -U neondb_owner -d neondb -c "SELECT COUNT(*) FILTER (WHERE oes_confirmed = true) AS confirmed, COUNT(*) AS total FROM drops;"
```

## Restart Staging Server

```bash
# Restart service (port 3006)
sshpass -p 'velo2026' ssh velo@100.96.203.105 "echo 'velo2026' | sudo -S systemctl restart fibreflow.service"

# Verify
sleep 3 && curl -s -o /dev/null -w "HTTP: %{http_code}\n" http://100.96.203.105:3006/
```

## Debug Issues

### Import Stuck/Hanging

```bash
# Check service status
sshpass -p 'velo2026' ssh velo@100.96.203.105 "systemctl status fibreflow.service --no-pager | head -15"

# Pull latest code and rebuild
sshpass -p 'velo2026' ssh velo@100.96.203.105 "cd /home/velo/fibreflow-development && git pull && npm run build"

# Restart
sshpass -p 'velo2026' ssh velo@100.96.203.105 "echo 'velo2026' | sudo -S systemctl restart fibreflow.service"
```

### Wrong Insert/Update Counts

Ensure latest code deployed (commit: `fix(oes-import): use count-based approach`):
```bash
sshpass -p 'velo2026' ssh velo@100.96.203.105 "cd /home/velo/fibreflow-development && git log -1 --oneline"
```

### View Logs

```bash
sshpass -p 'velo2026' ssh velo@100.96.203.105 "echo 'velo2026' | sudo -S journalctl -u fibreflow.service -n 50 --no-pager"
```

## Expected Results

After import, you should see:
- **Total Rows**: Number of rows in Excel
- **New Inserts**: DR numbers not previously in oes_activations
- **Updated**: DR numbers that already existed (refreshed data)
- **Matched Drops**: OES records linked to drops table
- **Not in Drops**: OES-only records (no drops match)

## Port Reference

| Port | Use | Notes |
|------|-----|-------|
| 3000 | Production | DO NOT TOUCH |
| 3005 | Dev | Local development |
| 3006 | Staging | OES import testing |

## Files

| File | Purpose |
|------|---------|
| `pages/api/activate/import-oes.ts` | Import API |
| `src/modules/activate/components/OESImportTab.tsx` | Import UI |
| `.claude/skills/oes-import.md` | Full documentation |
