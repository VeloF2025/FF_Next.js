# Module: notifications

> **Last updated:** 2026-02-23  
> **Path:** `src/modules/notifications/`  
> **Status:** Active (Phase 1–3 complete)  
> **Complexity:** Medium

## Overview

Unified Notification Service (UNS) — centralized notification bus for all FibreFlow modules. Replaces hardcoded fake notifications with real, multi-channel delivery system (in-app, email, WhatsApp).

| Property | Value |
|----------|-------|
| **Purpose** | Send real-time notifications to users via multiple channels with user preferences |
| **Primary use** | Module integration for ticket assignments, QA decisions, approvals, SLA warnings |
| **Status** | Active (launched Feb 2026) |
| **Category** | system/communication |

## Core Concept

All modules call `notify(payload)` to dispatch notifications. The system:
1. Creates in-app record (always, if user has in-app enabled)
2. Delivers email (if user preference enabled, via Resend)
3. Delivers WhatsApp (if user preference enabled, via bridge + WAHA)
4. Logs all deliveries for audit trail

## Database Schema (Migration 192)

### Tables
- `user_notifications` — In-app notifications (bell icon source)
- `notification_preferences` — Per-user, per-event-type channel selection
- `notification_delivery_log` — Audit trail of deliveries (sent, failed, skipped)

### Indices
- `idx_user_notifications_unread` — Fast unread count for bell badge
- `idx_user_notifications_list` — Fast notification list by user
- `idx_user_notifications_source` — Fast lookup by source entity

## notify() API

**Module:** `src/modules/notifications/services/notificationBus.ts`

```typescript
import { notify } from '@/modules/notifications/services/notificationBus';

await notify({
  event_type: 'maintenance.ticket_assigned',
  title: 'Ticket Assigned',
  body: 'You've been assigned a ticket',
  action_url: '/maintenance/tickets/[id]',
  source_module: 'maintenance',
  source_id: '[ticket-uuid]',
  metadata: { project: 'Lawley' },
  recipient_user_ids: ['user-uuid-1', 'user-uuid-2'],
});
```

**Behavior:**
- Non-blocking (fires and logs errors, never throws)
- Per-user channel preference respected
- Grace ful degradation (one failed delivery doesn't block others)

## API Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notifications` | List notifications (paginated, 20/page) |
| GET | `/api/notifications/unread-count` | Bell badge count |
| POST | `/api/notifications/mark-read` | Mark single notification read |
| POST | `/api/notifications/mark-all-read` | Mark all read |
| GET/PUT | `/api/notifications/preferences` | Get/update delivery preferences |
| POST | `/api/notifications/test` | Send test notification (dev/admin) |

## Components & Hooks

### Bell Icon (TanStack Query)
- `useUnreadCount()` — polls every 30s for badge count
- `useNotifications()` — paginated notification list
- `useNotificationPreferences()` — user's channel preferences

### Frontend
- Bell icon in navbar showing unread count with severity colour
- Dropdown shows last 10 notifications
- Click navigates to action_url
- "Mark all read" button

## Severity Levels & Icons

| Severity | Icon | Colour | Usage |
|----------|------|--------|-------|
| `info` | bell | brand | General notifications |
| `warning` | alert-triangle | amber | Warnings, SLA approaching |
| `error` | alert-circle | red | Critical issues, SLA breached |
| `success` | check-circle | green | Approvals granted, tasks complete |

## Module Integrations

### Maintenance Module
Events: `ticket_assigned`, `qa_rejected`, `ticket_closed`, `sla_warning`

### QField QA Module
Events: `photo_rejected`, `photo_escalated`

### Procurement Module
Events: `approval_granted`, `approval_rejected`

## Adding Notifications to Your Module

1. **Import notify:**
   ```typescript
   import { notify } from '@/modules/notifications/services/notificationBus';
   ```

2. **Resolve recipients** (caller's responsibility):
   ```typescript
   const recipients = await getUsersByRole('supervisor', projectId);
   ```

3. **Call notify() at the event:**
   ```typescript
   await notify({
     event_type: 'mymodule.something_happened',
     title: 'Something Happened',
     action_url: `/my-module/${entityId}`,
     source_module: 'mymodule',
     source_id: entityId,
     recipient_user_ids: recipients.map(u => u.id),
   });
   ```

4. **Optional: Add constants** for icon/severity defaults:
   ```typescript
   // src/modules/notifications/constants/index.ts
   EVENT_ICONS['mymodule.something_happened'] = 'alert-circle';
   EVENT_SEVERITY['mymodule.something_happened'] = 'warning';
   ```

## Delivery Channels

### In-App (Bell Icon)
- Real-time via TanStack Query 30s polling
- Database-backed, survives session
- Severity-colour badge

### Email (via Resend)
- HTML template with FibreFlow branding
- Optional custom HTML override
- Delivery audit logged

### WhatsApp
- Group messages via VPS bridge (port 8083)
- Individual DMs via WAHA service (port 3001)
- Off by default (user must enable)

## Full Documentation

For complete API reference, schema details, troubleshooting, and examples:
→ `knowledge-base/notifications/uns-reference.md` (10KB comprehensive guide)

## Related

- `/skills/modules/maintenance.md` — integration example (4 notification events)
- `/knowledge-base/notifications/uns-reference.md` — full UNS reference
- Resend email service → used for email delivery channel
- VPS bridge (72.61.197.178:8083) → WhatsApp group delivery
