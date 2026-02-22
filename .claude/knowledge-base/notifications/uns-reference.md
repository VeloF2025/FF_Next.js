# Unified Notification Service (UNS) Reference

> Real-time, multi-channel notification system for FibreFlow  
> Last Updated: 2026-02-21

## Quick Start

### Sending a Notification

```typescript
import { NotificationBus } from '@/modules/notifications/services';

await NotificationBus.notify({
  userId: 'uuid-of-recipient',
  eventType: 'ticket_assigned',
  title: 'New ticket assigned to you',
  message: 'Ticket #1234 - Replace damaged ONT at customer site',
  link: '/maintenance/tickets/1234',
  severity: 'warning'
});
```

This single call will:
1. Create notification in `user_notifications` table
2. Check user's channel preferences
3. Deliver via enabled channels (in-app, email, WhatsApp)
4. Log delivery status

### User Preferences

Users control which channels they receive notifications on:
- Navigate to **Profile → Notification Preferences**
- Toggle channels per event type
- Changes apply immediately

## Architecture

### Database Tables

**`user_notifications`** — User inbox
- `id`, `user_id`, `event_type`, `severity`, `title`, `message`, `link`
- `is_read`, `created_at`

**`notification_preferences`** — User channel settings
- `user_id`, `event_type`
- `in_app`, `email`, `whatsapp` (booleans)

**`notification_delivery_log`** — Delivery audit
- `notification_id`, `channel`, `status`, `delivered_at`, `error_message`

### Delivery Channels

**In-App** (always delivered)
- Stored in `user_notifications` table
- Real-time bell icon with unread count
- TanStack Query with 30s polling

**Email** (via Resend)
- HTML template with FibreFlow branding
- Requires `RESEND_API_KEY` env variable

**WhatsApp**
- Group messages via Bridge (port 8092)
- Individual DMs via WAHA (port 3001)

## Event Types

### Maintenance Module
- `ticket_assigned` — Warning, in-app + email
- `ticket_closed` — Info, in-app only
- `ticket_escalated` — Critical, all channels
- `qa_rejected` — Warning, in-app + email
- `sla_warning` — Critical, all channels

### QField QA
- `photo_rejected` — Warning, in-app
- `photo_escalated` — Warning, in-app + email

### Procurement
- `approval_granted` — Info, in-app + email
- `approval_rejected` — Warning, in-app + email
- `po_approved` — Info, in-app
- `grn_received` — Info, in-app

### System
- `system_alert` — Critical, all channels
- `deployment_complete` — Info, in-app

Full list in `src/modules/notifications/constants/index.ts`

## API Endpoints

**List Notifications**
```
GET /api/notifications?limit=20&offset=0&unread_only=true
```

**Unread Count** (for bell badge)
```
GET /api/notifications/unread-count
```

**Mark as Read**
```
PATCH /api/notifications/mark-read
Body: { "notification_id": "uuid" }
```

**Mark All as Read**
```
PATCH /api/notifications/mark-all-read
```

**Get Preferences**
```
GET /api/notifications/preferences
```

**Update Preferences**
```
PUT /api/notifications/preferences
Body: { "event_type": "ticket_assigned", "in_app": true, "email": false, "whatsapp": true }
```

**Test Notification** (admin only)
```
POST /api/notifications/test
Body: { "user_id": "uuid", "event_type": "ticket_assigned", "title": "Test", "message": "..." }
```

## Frontend Integration

### React Hook

```typescript
import { useNotifications } from '@/modules/notifications/hooks';

function MyComponent() {
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    isLoading
  } = useNotifications();

  return (
    <div>
      <p>You have {unreadCount} unread notifications</p>
      {notifications.map(notif => (
        <div key={notif.id} onClick={() => markAsRead(notif.id)}>
          <h4>{notif.title}</h4>
          <p>{notif.message}</p>
        </div>
      ))}
    </div>
  );
}
```

### Bell Icon

Located in `src/components/layout/Header.tsx`:
- Real-time badge with unread count
- Dropdown with notification list
- Severity color coding
- Deep links to related resources

## Module Integration

To send notifications from your module:

1. **Import the service**
```typescript
import { NotificationBus } from '@/modules/notifications/services';
```

2. **Call at the right moment**
```typescript
// When assigning a ticket
await NotificationBus.notify({
  userId: assignedToUserId,
  eventType: 'ticket_assigned',
  title: `Ticket #${ticket.id} assigned to you`,
  message: ticket.description,
  link: `/maintenance/tickets/${ticket.id}`,
  severity: 'warning'
});
```

3. **Register event type** (if new)

Add to `src/modules/notifications/constants/index.ts`:
```typescript
YOUR_EVENT: {
  code: 'your_event',
  label: 'Your Event',
  description: 'What this event means',
  icon: 'Bell',
  defaultChannels: { in_app: true, email: true, whatsapp: false },
  severity: 'info'
}
```

## Configuration

### Environment Variables

```bash
# Email delivery
RESEND_API_KEY=re_xxxxx

# WhatsApp
WA_BRIDGE_URL=http://100.96.203.105:8092
WAHA_URL=http://100.96.203.105:3001
WAHA_API_KEY=xxxxx
```

## Monitoring

### Check Delivery Logs

```sql
SELECT 
  ndl.channel,
  ndl.status,
  un.event_type,
  un.title
FROM notification_delivery_log ndl
JOIN user_notifications un ON ndl.notification_id = un.id
WHERE ndl.status = 'failed'
ORDER BY ndl.delivered_at DESC
LIMIT 20;
```

### Test Delivery

```bash
curl -X POST https://app.fibreflow.app/api/notifications/test \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "uuid",
    "event_type": "system_alert",
    "title": "Test Notification"
  }'
```

## Common Issues

**Notifications not appearing in bell**
- Check TanStack Query devtools for fetch errors
- Verify `/api/notifications/unread-count` returns data
- Clear browser cache

**Email not sending**
- Verify `RESEND_API_KEY` is set
- Check delivery log for errors
- Ensure user has email in their profile

**WhatsApp not delivering**
- Check WA Bridge/WAHA are running
- Verify phone numbers are in correct format
- Check delivery log for API errors

## Performance

- **Bell polling:** 30 seconds
- **Delivery latency:** <2 seconds (in-app), <5 seconds (email/WA)
- **Database indexes:** on `user_id`, `is_read`, `created_at`

## Related Files

**Services:**
- `src/modules/notifications/services/notificationBus.ts`
- `src/modules/notifications/services/emailDelivery.ts`
- `src/modules/notifications/services/whatsappDelivery.ts`

**Constants:**
- `src/modules/notifications/constants/index.ts`

**Hooks:**
- `src/modules/notifications/hooks/useNotifications.ts`

**API:**
- `pages/api/notifications/` (all endpoints)

**Migration:**
- `scripts/migrations/192_unified_notifications.sql`

**Full Documentation:**
- `docs/UNIFIED-NOTIFICATION-SERVICE.md`

## Support

- **Technical:** Elon (CTO)
- **Business Logic:** Flow (Apps)
- **Documentation:** Scribe

Launched: 2026-02-20  
Commit: f7e71787
