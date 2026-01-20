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

### wa_group_mappings
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
- service (TEXT) -- sender, bridge, monitor
- group_jid (TEXT)
- message_type (TEXT) -- text, ack, feedback
- message_content (TEXT)
- project, drop_number (TEXT)
- status (TEXT) -- sent, delivered, failed, pending
- error_message (TEXT)
- created_at (TIMESTAMP)
```

## UI Components

### Tab Navigation (WhatsAppPortal.tsx)
- WAI-ARIA compliant tabs with `role="tablist"`, `role="tab"`, `aria-selected`
- Keyboard navigation: Arrow keys, Home, End
- Focus management with refs

### Services Tab
- Displays Bridge and Sender service status
- Shows phone numbers, URLs, last message timestamps
- Restart button for each service (3-second delay for confirmation)
- Overall health badge (healthy/degraded/down)
- Auto-refresh every 30 seconds

### Groups Tab
- List all project-group mappings with enable/disable toggle
- Add new group modal with JID validation
- Edit existing group settings
- Delete with confirmation modal (focus trapping)
- Send test message to verify connectivity

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
    ├─→ whatsapp-sender.service (Port 8081)
    │       └─→ Status checks, restart commands
    │       └─→ Test message sending
    │
    └─→ whatsapp-bridge.service (Port 8083)
            └─→ Status checks, restart commands
            └─→ Message log aggregation

Server: 100.96.203.105 (Velocity Server)
```

## Common Tasks

### Check Service Status
Navigate to Services tab - shows real-time status with auto-refresh.

### Add New Project Group
1. Go to Groups tab
2. Click "Add Group"
3. Enter project name and group JID
4. Toggle enabled status
5. Send test message to verify

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
1. Check server connectivity: `curl http://100.96.203.105:8081/health`
2. SSH to server and check service: `systemctl status whatsapp-sender.service`
3. Use restart button in UI or restart manually

### Test Message Not Sending
1. Verify group JID is correct format (`XXXXX@g.us`)
2. Check sender service status
3. Review logs tab for error details
4. Ensure group is enabled

### Configuration Not Saving
1. Check for validation errors in UI
2. Verify database connectivity
3. Some settings require service restart to take effect

## Related Documentation

- `docs/wa-monitor/WHATSAPP_ARCHITECTURE.md` - Full architecture guide
- `src/modules/wa-monitor/README.md` - WA Monitor module
- `.claude/agents/wa-agent.md` - WA troubleshooting agent
