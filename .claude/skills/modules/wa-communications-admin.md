# WhatsApp Communications Admin Module

## Overview

The WhatsApp Communications Admin Portal provides a centralized dashboard for managing WhatsApp services, groups, templates, message logs, and configuration settings. Located at `/communications/whatsapp`.

## Module Location

```
src/modules/communications/whatsapp/
├── WhatsAppPortal.tsx          # Main portal with tab navigation
├── index.ts                    # Module exports
├── types/
│   └── wa-admin.types.ts       # TypeScript interfaces
├── services/
│   └── waAdminApiService.ts    # API client service
└── components/
    ├── ServicesTab.tsx         # Service status & restart controls
    ├── GroupsTab.tsx           # Group management (CRUD)
    ├── TemplatesTab.tsx        # Template editing & preview
    ├── LogsTab.tsx             # Message log viewer with export
    └── SettingsTab.tsx         # Configuration management
```

## Page & API Routes

| Route | Type | Description |
|-------|------|-------------|
| `/communications/whatsapp` | Page | Main portal page |
| `/api/communications/whatsapp/services/status` | GET | Get service status |
| `/api/communications/whatsapp/services/[service]/restart` | POST | Restart service |
| `/api/communications/whatsapp/groups` | GET/POST | List/create groups |
| `/api/communications/whatsapp/groups/[id]` | GET/PUT/DELETE | Group CRUD |
| `/api/communications/whatsapp/groups/[id]/test` | POST | Send test message |
| `/api/communications/whatsapp/templates` | GET | List templates |
| `/api/communications/whatsapp/templates/[key]` | GET/PUT | Template management |
| `/api/communications/whatsapp/logs` | GET | Query message logs |
| `/api/communications/whatsapp/logs/export` | GET | Export logs to CSV |
| `/api/communications/whatsapp/config` | GET | List configuration |
| `/api/communications/whatsapp/config/[key]` | PUT | Update config setting |

## Database Tables (Migration 094)

### wa_service_config
Configuration settings for WhatsApp services:
```sql
- config_key (TEXT PRIMARY KEY)
- config_value (TEXT)
- config_type (TEXT) -- string, boolean, number, json
- category (TEXT) -- service, validation, feature, general
- description (TEXT)
- is_sensitive (BOOLEAN) -- masks value in UI
- created_at, updated_at (TIMESTAMPS)
```

### wa_group_mappings (deprecated - use wa_monitored_groups)
Project-to-WhatsApp group mappings:
```sql
- id (UUID PRIMARY KEY)
- project_id (UUID REFERENCES projects)
- project_name (TEXT)
- group_jid (TEXT) -- e.g., 120363418298130331@g.us
- group_name (TEXT)
- enabled (BOOLEAN)
- created_at, updated_at (TIMESTAMPS)
```

**Note:** Bridge now loads from `wa_monitored_groups` table.

### wa_message_templates
Message templates with variable support:
```sql
- id (UUID PRIMARY KEY)
- template_key (TEXT UNIQUE) -- e.g., dr_acknowledgment
- template_name (TEXT)
- template_content (TEXT) -- supports {{variable}} syntax
- variables (TEXT[]) -- list of variable names
- category (TEXT) -- acknowledgment, feedback, notification, system
- enabled, is_default (BOOLEAN)
- created_at, updated_at (TIMESTAMPS)
```

### wa_message_logs
Audit trail for all WhatsApp messages:
```sql
- id (UUID PRIMARY KEY)
- direction (TEXT) -- inbound, outbound
- service (TEXT) -- bridge, command-bot
- group_jid (TEXT)
- message_type (TEXT) -- text, ack, feedback
- message_content (TEXT)
- project, drop_number (TEXT)
- status (TEXT) -- sent, delivered, failed, pending
- error_message (TEXT)
- created_at (TIMESTAMP)
```

### wa_monitored_groups (current, used by bridge)
Group configuration loaded by bridge:
```sql
- id (UUID PRIMARY KEY)
- group_jid (VARCHAR(100) UNIQUE NOT NULL)
- group_name (VARCHAR(200) NOT NULL)
- project_name (VARCHAR(200))
- group_type (VARCHAR(50) DEFAULT 'dr_submission') -- dr_submission, maintenance, admin, pre_provision, civil, optical
- project_id (UUID REFERENCES projects) -- links civil/optical groups to projects
- description (TEXT)
- is_active (BOOLEAN DEFAULT true)
- created_at, updated_at (TIMESTAMPTZ)
```

## UI Components

### Tab Navigation (WhatsAppPortal.tsx)
- WAI-ARIA compliant tabs with `role="tablist"`, `role="tab"`, `aria-selected`
- Keyboard navigation: Arrow keys, Home, End
- Focus management with refs

### Services Tab
- Displays Bridge service status (unified on VPS)
- Shows phone number (+27 63 841 2276), URL (72.61.197.178:8083), last message timestamp
- Restart button with 3-second delay for confirmation
- Overall health badge (healthy/degraded/down)
- Auto-refresh every 30 seconds

### Groups Tab
- List all project-group mappings with enable/disable toggle
- Add new group modal with JID validation
- Edit existing group settings
- Delete with confirmation modal (focus trapping)
- Send test message to verify connectivity
- Group type selection: dr_submission, maintenance, admin, pre_provision, civil, optical

### Templates Tab
- List templates grouped by category
- Edit template content with syntax highlighting
- Preview with sample data
- Variable documentation display
- Enable/disable templates

### Logs Tab
- Paginated message log viewer (25 per page)
- Filters: direction, status, project, drop_number, date range
- Export to CSV functionality
- Log detail modal with full message content
- Error highlighting for failed messages

### Settings Tab
- Grouped by category (service, validation, feature, general)
- Inline editing with save/reset buttons
- Type-aware inputs (boolean, number, json, url, password)
- Sensitive values masked in UI

## Accessibility Features

All components include:
- `aria-labels` on icon-only buttons
- `role="status"` for loading states with `sr-only` text
- `role="alert"` for error messages
- Focus trapping in modals
- Keyboard navigation support
- Proper label associations (`htmlFor`/`id`)

## Integration with WA Services

The portal integrates with the existing WhatsApp infrastructure:

```
WhatsApp Admin Portal (FibreFlow UI)
    │
    ├─→ whatsapp-bridge (VPS 72.61.197.178:8083)
    │       └─→ Unified: receives, sends acks, sends feedback
    │
    ├─→ wa-command-bot (VPS 72.61.197.178:8086)
    │       └─→ Admin commands only
    │
    └─→ wa-feedback (Velocity 100.96.203.105:8092) - LEGACY
            └─→ Proxies to bridge (backward compatibility)

Primary Server: VPS 72.61.197.178 (WhatsApp services)
Legacy Proxy: 100.96.203.105 (Velocity - wa-feedback only)
```

## Common Tasks

### Check Service Status
Navigate to Services tab - shows real-time status with auto-refresh.

### Add New Project Group
1. Go to Groups tab
2. Click "Add Group"
3. Enter project name and group JID
4. Select group type (dr_submission, maintenance, admin, pre_provision)
5. Toggle enabled status
6. Send test message to verify

### Edit Message Template
1. Go to Templates tab
2. Select template from list
3. Click "Edit" button
4. Modify content (use `{{variable}}` syntax)
5. Preview with sample data
6. Save changes

### Export Message Logs
1. Go to Logs tab
2. Apply filters as needed
3. Click "Export CSV"
4. File downloads automatically

### Update Configuration
1. Go to Settings tab
2. Find setting by category
3. Edit value inline
4. Click save icon
5. Restart services if needed (notification shown)

## Troubleshooting

### Service Shows Disconnected
1. Check VPS bridge connectivity: `curl http://72.61.197.178:8083/health`
2. SSH to VPS and check service: `ssh root@72.61.197.178 "systemctl status whatsapp-bridge"`
3. Use restart button in UI or restart manually on VPS

### Test Message Not Sending
1. Verify group JID is correct format (`XXXXX@g.us`)
2. Check bridge service status
3. Review logs tab for error details
4. Ensure group is enabled

### Configuration Not Saving
1. Check for validation errors in UI
2. Verify database connectivity
3. Some settings require service restart to take effect

## Related Documentation

- `.claude/knowledge-base/whatsapp/unified-bridge-reference.md` - Quick reference
- `.claude/skills/infrastructure/whatsapp.md` - Full architecture
- `.claude/agents/wa-agent.md` - WA troubleshooting agent

## Version History

| Date | Change |
|------|--------|
| Mar 02, 2026 | Added civil + optical group types; project_id column on wa_monitored_groups; 11 groups total |
| Feb 20, 2026 | Updated for unified VPS bridge architecture, 9 groups |
| Jan 26, 2026 | WhatsApp Admin Portal created |

## Important Notes (Updated Feb 2026)

1. **Architecture Change:** Unified VPS bridge (version 2.0.0) at 72.61.197.178:8083
2. **Phone Number:** +27 63 841 2276 (unified for all operations)
3. **11 Monitored Groups:** Including civil and optical types (added Mar 2026)
4. **No Separate Sender:** Bridge handles all message sending
5. **wa-feedback:** Legacy service on Velocity, proxies to bridge
6. **Group Types:** dr_submission, maintenance, admin, pre_provision, civil, optical
7. **Pole Install ACK Pipeline:** Civil groups trigger real-time VLM photo classification and ACK messages (see `infrastructure/whatsapp.md`)
8. **New Tables (Mar 2026):** `pole_install_sessions` (session tracking), columns added to `field_ops_wa_photos`
