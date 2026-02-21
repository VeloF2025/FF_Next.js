# Unified Notification Service (UNS)

> Real-time, multi-channel notification system for FibreFlow  
> **Version:** 1.0 (Phase 1-3)  
> **Launched:** 2026-02-20

---

## Overview

The Unified Notification Service (UNS) provides a **centralized notification bus** that all FibreFlow modules can use to deliver real-time notifications to users via multiple channels (in-app, email, WhatsApp).

Prior to UNS, notifications were hardcoded fake data in the bell icon. UNS replaces this with a **real notification system** backed by database tables, delivery channels, and user preferences.

### Key Features
- **Multi-channel delivery:** In-app, Email (Resend), WhatsApp (group + DM)
- **User preferences:** Per-event-type channel selection
- **Delivery audit logging:** Track which notifications were sent when and to whom
- **Severity levels:** Info, Warning, Critical (with visual indicators)
- **Real-time polling:** Bell icon updates every 30 seconds
- **Module integration:** Maintenance, QField QA, Procurement modules integrated

---

## Architecture

### Database Schema (Migration 192)

```sql
-- User notifications (inbox)
CREATE TABLE user_notifications (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  event_type VARCHAR(100),  -- e.g., 'ticket_assigned', 'qa_rejected'
  severity VARCHAR(20),      -- 'info', 'warning', 'critical'
  title VARCHAR(255),
  message TEXT,
  link VARCHAR(500),         -- Deep link to related resource
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP
);

-- User notification preferences
CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  event_type VARCHAR(100),
  in_app BOOLEAN DEFAULT true,
  email BOOLEAN DEFAULT false,
  whatsapp BOOLEAN DEFAULT false,
  UNIQUE(user_id, event_type)
);

-- Delivery audit log
CREATE TABLE notification_delivery_log (
  id UUID PRIMARY KEY,
  notification_id UUID REFERENCES user_notifications(id),
  channel VARCHAR(50),       -- 'in_app', 'email', 'whatsapp'
  status VARCHAR(50),        -- 'sent', 'failed', 'pending'
  delivered_at TIMESTAMP,
  error_message TEXT,
  metadata JSONB             -- Channel-specific delivery data
);
```

### Service Layer

**NotificationBus** (`src/modules/notifications/services/notificationBus.ts`)

Central service for creating and managing notifications:

```typescript
import { NotificationBus } from '@/modules/notifications/services';

// Create a notification
await NotificationBus.notify({
  userId: 'uuid',
  eventType: 'ticket_assigned',
  title: 'New ticket assigned to you',
  message: 'Ticket #1234 - Replace damaged ONT',
  link: '/maintenance/tickets/1234',
  severity: 'warning'
});

// Get unread count
const count = await NotificationBus.getUnreadCount(userId);

// Mark as read
await NotificationBus.markAsRead(notificationId, userId);

// Mark all as read
await NotificationBus.markAllAsRead(userId);
```

### Delivery Channels

#### In-App Notifications
- **Always delivered** to `user_notifications` table
- Real-time bell icon badge with unread count
- TanStack Query with 30s polling
- Click notification → deep link to resource

#### Email Delivery
**Service:** `src/modules/notifications/services/emailDelivery.ts`  
**Provider:** Resend API  
**Template:** HTML email with FibreFlow branding

```typescript
await EmailDelivery.send({
  to: user.email,
  subject: notification.title,
  body: notification.message,
  link: notification.link
});
```

Logs delivery to `notification_delivery_log` with success/failure status.

#### WhatsApp Delivery
**Service:** `src/modules/notifications/services/whatsappDelivery.ts`  
**Endpoints:**
- **Group messages:** WhatsApp Bridge (port 8092)
- **Individual DMs:** WAHA API (port 3001)

```typescript
// Group message
await WhatsAppDelivery.sendGroupMessage({
  groupJid: '120363423864087150@g.us',
  recipientJid: user.phone + '@s.whatsapp.net',
  message: notification.message
});

// Individual DM
await WhatsAppDelivery.sendDirectMessage({
  phone: user.phone,
  message: notification.message
});
```

---

## API Endpoints

### `GET /api/notifications`
List user's notifications (paginated, with filters)

**Query params:**
- `limit` — Results per page (default: 20)
- `offset` — Pagination offset
- `unread_only` — Filter to unread notifications only

**Response:**
```json
{
  "success": true,
  "notifications": [
    {
      "id": "uuid",
      "event_type": "ticket_assigned",
      "severity": "warning",
      "title": "New ticket assigned",
      "message": "Ticket #1234 - Replace damaged ONT",
      "link": "/maintenance/tickets/1234",
      "is_read": false,
      "created_at": "2026-02-20T13:05:00Z"
    }
  ],
  "total": 42,
  "unread_count": 5
}
```

### `GET /api/notifications/unread-count`
Get count of unread notifications (for bell icon badge)

**Response:**
```json
{
  "success": true,
  "count": 5
}
```

### `PATCH /api/notifications/mark-read`
Mark a single notification as read

**Body:**
```json
{
  "notification_id": "uuid"
}
```

### `PATCH /api/notifications/mark-all-read`
Mark all user's notifications as read

### `GET /api/notifications/preferences`
Get user's notification channel preferences

**Response:**
```json
{
  "success": true,
  "preferences": [
    {
      "event_type": "ticket_assigned",
      "in_app": true,
      "email": true,
      "whatsapp": false
    }
  ]
}
```

### `PUT /api/notifications/preferences`
Update user's channel preferences

**Body:**
```json
{
  "event_type": "ticket_assigned",
  "in_app": true,
  "email": false,
  "whatsapp": true
}
```

### `POST /api/notifications/test`
Send a test notification (admin only)

**Body:**
```json
{
  "user_id": "uuid",
  "event_type": "ticket_assigned",
  "title": "Test notification",
  "message": "This is a test",
  "link": "/test"
}
```

---

## Registered Event Types

The system supports 20 event types across modules:

### Maintenance Module
| Event Type | Description | Default Channels | Severity |
|------------|-------------|------------------|----------|
| `ticket_assigned` | Ticket assigned to user | In-app, Email | Warning |
| `ticket_closed` | Ticket marked as closed | In-app | Info |
| `ticket_escalated` | Ticket escalated to supervisor | In-app, Email | Critical |
| `qa_rejected` | QA photo rejected | In-app, Email | Warning |
| `sla_warning` | SLA deadline approaching | In-app, Email, WhatsApp | Critical |

### QField QA Module
| Event Type | Description | Default Channels | Severity |
|------------|-------------|------------------|----------|
| `photo_rejected` | QField photo failed QA | In-app | Warning |
| `photo_escalated` | Photo escalated to supervisor | In-app, Email | Warning |

### Procurement Module
| Event Type | Description | Default Channels | Severity |
|------------|-------------|------------------|----------|
| `approval_granted` | Purchase requisition approved | In-app, Email | Info |
| `approval_rejected` | Purchase requisition rejected | In-app, Email | Warning |
| `po_approved` | Purchase order approved | In-app | Info |
| `grn_received` | Goods received note created | In-app | Info |

### System Events
| Event Type | Description | Default Channels | Severity |
|------------|-------------|------------------|----------|
| `system_alert` | Critical system event | In-app, Email, WhatsApp | Critical |
| `deployment_complete` | Deployment finished | In-app | Info |

Full list: `src/modules/notifications/constants/index.ts`

---

## Frontend Integration

### React Query Hook

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
          {notif.title}
        </div>
      ))}
      <button onClick={markAllAsRead}>Mark all as read</button>
    </div>
  );
}
```

### Bell Icon Component

**Location:** `src/components/layout/Header.tsx` + `NotificationsDropdown.tsx`

Features:
- Real-time badge with unread count
- Dropdown with notification list
- Severity color coding (amber/red)
- Deep links to related resources
- Mark all as read button
- Empty state when no notifications

---

## Module Integration Guide

To send notifications from your module:

### 1. Import NotificationBus
```typescript
import { NotificationBus } from '@/modules/notifications/services';
```

### 2. Call `notify()` at the right moment
```typescript
// Example: When assigning a ticket
await NotificationBus.notify({
  userId: assignedToUserId,
  eventType: 'ticket_assigned',
  title: `Ticket #${ticket.id} assigned to you`,
  message: ticket.description,
  link: `/maintenance/tickets/${ticket.id}`,
  severity: 'warning'
});
```

### 3. Register your event type
Add to `src/modules/notifications/constants/index.ts`:

```typescript
export const EVENT_TYPES = {
  // ... existing events
  YOUR_NEW_EVENT: {
    code: 'your_new_event',
    label: 'Your New Event',
    description: 'Description of what this event means',
    icon: 'Bell',
    defaultChannels: {
      in_app: true,
      email: true,
      whatsapp: false
    },
    severity: 'info'
  }
};
```

---

## Delivery Flow

```
User Action (e.g., ticket assigned)
         ↓
Module calls NotificationBus.notify()
         ↓
1. Create notification in user_notifications table
2. Check user's channel preferences
         ↓
┌────────┴────────┬──────────────┐
│                 │              │
In-App      Email (Resend)   WhatsApp (Bridge/WAHA)
  ↓               ↓              ↓
Always      If email=true   If whatsapp=true
delivered   Send via API    Send via API
  ↓               ↓              ↓
Log to notification_delivery_log
         ↓
User sees notification in bell dropdown
```

---

## Configuration

### Environment Variables

```bash
# Email delivery (Resend)
RESEND_API_KEY=re_xxxxx

# WhatsApp Bridge (Group messages)
WA_BRIDGE_URL=http://100.96.203.105:8092

# WAHA (Individual DMs)
WAHA_URL=http://100.96.203.105:3001
WAHA_API_KEY=xxxxx
```

### User Preferences

Users can customize which channels they receive notifications on:
- Navigate to **Profile → Notification Preferences**
- Toggle channels per event type
- Changes apply immediately

---

## Monitoring & Debugging

### Check delivery logs
```sql
SELECT 
  ndl.channel,
  ndl.status,
  ndl.delivered_at,
  un.event_type,
  un.title
FROM notification_delivery_log ndl
JOIN user_notifications un ON ndl.notification_id = un.id
WHERE ndl.status = 'failed'
ORDER BY ndl.delivered_at DESC
LIMIT 20;
```

### Test notification delivery
```bash
curl -X POST https://app.fibreflow.app/api/notifications/test \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "uuid",
    "event_type": "system_alert",
    "title": "Test Notification",
    "message": "This is a test",
    "link": "/test"
  }'
```

---

## Phase Roadmap

### Phase 1: Foundation ✅
- Database schema
- NotificationBus service
- API endpoints
- Bell icon integration
- In-app delivery

### Phase 2: Delivery Channels ✅
- Email via Resend
- WhatsApp group messages
- WhatsApp DMs
- Delivery audit logging

### Phase 3: Module Integration ✅
- Maintenance module
- QField QA module
- Procurement module
- 20 registered event types

### Phase 4: Future Enhancements (Planned)
- SMS delivery (Twilio)
- Push notifications (mobile app)
- Notification scheduling (digest emails)
- Advanced filtering and search
- Notification templates
- Bulk operations API

---

## Related Files

**Services:**
- `src/modules/notifications/services/notificationBus.ts` — Core notification logic
- `src/modules/notifications/services/emailDelivery.ts` — Email delivery via Resend
- `src/modules/notifications/services/whatsappDelivery.ts` — WhatsApp delivery

**Constants:**
- `src/modules/notifications/constants/index.ts` — Event types, icons, defaults

**Hooks:**
- `src/modules/notifications/hooks/useNotifications.ts` — React Query hook

**API Routes:**
- `pages/api/notifications/` — All notification endpoints

**Database:**
- `scripts/migrations/192_unified_notifications.sql` — Schema migration

**Module Integration:**
- `src/modules/maintenance/services/notificationTriggers.ts` — Maintenance triggers
- `src/modules/qfield/services/qfieldNotificationService.ts` — QField triggers
- `pages/api/procurement/approvals/[id]/approve.ts` — Procurement triggers

---

## Support

For issues or questions about the Unified Notification Service:
- **Technical:** Elon (CTO)
- **Business Logic:** Flow (Apps)
- **Documentation:** Scribe

**Commit:** `f7e71787` (2026-02-20)  
**Co-Authored-By:** Claude Sonnet 4.5 + Claude Opus 4.6
