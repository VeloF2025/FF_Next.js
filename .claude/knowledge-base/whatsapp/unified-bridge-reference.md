# WhatsApp Unified Bridge - Quick Reference

> Last updated: 2026-02-20

## Service Locations

| Service | Server | Port | Status |
|---------|--------|------|--------|
| Unified Bridge | VPS (72.61.197.178) | 8083 | **ACTIVE** |
| Command Bot | VPS | 8086 | Active |
| WA Feedback Proxy | Velocity (100.96.203.105) | 8092 | **LEGACY** |

## Quick Health Checks

```bash
# Unified bridge health
curl -s http://72.61.197.178:8083/health | jq .

# List monitored groups
curl -s http://72.61.197.178:8083/groups | jq .

# Reload groups from database (no restart needed)
curl -s http://72.61.197.178:8083/reload-groups

# WA Feedback proxy health (legacy)
curl -s http://100.96.203.105:8092/health
```

## Send Test Message

```bash
curl -s -X POST http://72.61.197.178:8083/send-message \
  -H "Content-Type: application/json" \
  -d '{"group_jid":"120363423864087150@g.us","recipient_jid":"0@s.whatsapp.net","message":"Test message from bridge"}'
```

**Note:** Use `120363423864087150@g.us` (Velo Server) for test messages.

## Current Monitored Groups (9)

| Group | Type | JID |
|-------|------|-----|
| Lawley | dr_submission | `120363418298130331@g.us` |
| Mohadin | dr_submission | `120363421532174586@g.us` |
| Mamelodi | dr_submission | `120363408849234743@g.us` |
| Marketing Activations | dr_submission | `120363422808656601@g.us` |
| Mamelodi Internal | dr_submission | `120363425029043207@g.us` |
| Mohadin Maintenance | maintenance | `120363424360693693@g.us` |
| Lawley Maintenance | maintenance | `120363423947610853@g.us` |
| Mohadin Pre-Provision | pre_provision | `120363423163566226@g.us` |
| Velo Server | admin | `120363423864087150@g.us` |

## Managing Groups

### Option A: WA Portal UI (Recommended)

Navigate to **Communications → WhatsApp → Groups tab**

Features:
- View all monitored groups with type badges
- Add new groups with type selection (DR Submission, Maintenance, Admin, Pre-Provision)
- Edit existing groups (name, JID, type, description, active status)
- Delete groups
- Send test messages
- **Bridge auto-reloads** after any change

Group Types:
| Type | Badge | Purpose |
|------|-------|---------|
| `dr_submission` | Purple | DR photo submissions - processed and acknowledged |
| `maintenance` | Blue | Maintenance photos - reactions on success/failure |
| `pre_provision` | Yellow | Pre-provisioning tasks |
| `admin` | Gray | Admin commands only (for wa-command-bot) |

### Option B: Direct Database + CLI

#### Step 1: Add bridge phone to group
Add **+27 63 841 2276** to the WhatsApp group

#### Step 2: Find the Group JID
```bash
# Send a message in the group, then check logs
ssh root@72.61.197.178 "tail -20 /opt/whatsapp-bridge/bridge.log | grep 'Storing message'"
# Look for: 📝 Storing message from 120363XXXXXXXXXX@g.us
```

#### Step 3: Add to database
```bash
DATABASE_URL='postgresql://neondb_owner:$NEON_DB_PASSWORD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
(async () => {
  await sql\`INSERT INTO wa_monitored_groups
    (group_jid, group_name, project_name, group_type, description)
    VALUES
    ('120363XXXXXXXXXX@g.us', 'Group Name', 'Project', 'dr_submission', 'Description')\`;
  console.log('Group added');
})();
"
```

#### Step 4: Reload groups
```bash
curl http://72.61.197.178:8083/reload-groups
```

## Bridge Phone Number

**Phone:** +27 63 841 2276  
**JID:** 27638412276@s.whatsapp.net  
**Version:** 2.0.0

## SSH Access

```bash
# VPS (WhatsApp services)
ssh root@72.61.197.178

# Velocity (FibreFlow apps) — run commands locally as user hein (passwordless sudo)
```

## Service Management (VPS)

```bash
# Bridge service
systemctl status whatsapp-bridge
systemctl restart whatsapp-bridge
journalctl -u whatsapp-bridge -f

# Command bot
systemctl status wa-command-bot
systemctl restart wa-command-bot

# Logs
tail -f /opt/whatsapp-bridge/bridge.log
```

## Troubleshooting

### Bridge not responding
```bash
ssh root@72.61.197.178
systemctl status whatsapp-bridge
# If stopped:
systemctl start whatsapp-bridge
```

### Messages not being received
1. Check bridge is connected: `curl http://72.61.197.178:8083/health`
2. Verify group is in database: `curl http://72.61.197.178:8083/groups`
3. If group missing, add it and reload

### Session expired (needs re-pairing)
```bash
# Check pairing state in /health response
curl http://72.61.197.178:8083/health | jq '.needs_auth, .pairing_state'
# If needs_auth: true, service needs QR code scan
```

## Database Schema

```sql
CREATE TABLE wa_monitored_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_jid VARCHAR(100) UNIQUE NOT NULL,
  group_name VARCHAR(200) NOT NULL,
  project_name VARCHAR(200),
  group_type VARCHAR(50) DEFAULT 'dr_submission',  -- dr_submission, maintenance, admin, pre_provision
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Related Files

| File | Purpose |
|------|---------|
| `.claude/skills/modules/wa-monitor.md` | Full module documentation |
| `/home/velo/whatsapp-bridge/main.go` | Bridge source (Velocity) |
| `/opt/whatsapp-bridge/` | Deployed binary (VPS) |
| `/home/velo/wa-feedback-service/` | Feedback proxy (Velocity, legacy) |
