# DR Activity Timeline System

> Quick reference for the Activate module's activity tracking system

## Overview

Every DR lifecycle event is logged to `dr_activity_log` table and displayed in the Activity tab.

## Event Types

| Event Type | Title | Actor Type | Trigger |
|------------|-------|------------|---------|
| `dr_received` | DR Received | system | WhatsApp submission arrives |
| `photos_downloaded` | Photos Downloaded | system | BOSS API photo download |
| `photos_categorized` | AI Photo Categorization | vlm | VLM categorizes photos |
| `vlm_validated` | VLM QA Validated | vlm | Automated QA check |
| `human_review_complete` | Human Review Complete | user | QA Wizard Phase 2-3 |
| `final_decision` | Final Decision | user | Phase 4 PASS/FAIL |
| `feedback_sent` | Feedback Sent | whatsapp-sender | WhatsApp message sent |
| `serial_updated` | Serial Updated | user | Manual correction |
| `serial_verified` | Serial Verified | system | 1Map confirmed correct |

## Logging Activity

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await pool.query(`
  INSERT INTO dr_activity_log (
    drop_number, event_type, event_title, event_description,
    event_data, actor_type, actor_name
  ) VALUES ($1, $2, $3, $4, $5, $6, $7)
`, [
  'DR1731166',
  'feedback_sent',
  'Feedback Sent',
  'Sent to 120363418298130331@g.us',
  JSON.stringify({ message_id: 'abc123', status: 'sent' }),
  'whatsapp-sender',
  'whatsapp-sender',
]);
```

## Querying Activity

```sql
-- Get all activity for a DR (newest first)
SELECT event_type, event_title, event_description,
       actor_type, actor_name, created_at
FROM dr_activity_log
WHERE drop_number = 'DR1731166'
ORDER BY created_at DESC;

-- Get activity by type
SELECT * FROM dr_activity_log
WHERE event_type = 'feedback_sent'
AND created_at > NOW() - INTERVAL '24 hours';
```

## UI Components

### Activity Tab Structure
```
Activity
├── Timeline (default)     ─── chronological event list
├── QA History (0)         ─── historic reviews from Excel imports
└── Serial History (0)     ─── ONT/UPS serial changes
```

### Timeline Event Display
```tsx
<div className="flex items-start gap-3 p-3">
  <EventIcon type={event.event_type} />
  <div>
    <h4>{event.event_title}</h4>
    <p>{event.event_description}</p>
    <span>{formatDate(event.created_at)} by {event.actor_type}</span>
  </div>
</div>
```

## Actor Types

| Actor Type | Description | Example |
|------------|-------------|---------|
| `system` | Automated system action | DR received, photos downloaded |
| `vlm` | AI/VLM processing | Categorization, validation |
| `user` | Human action | Review, decision |
| `whatsapp-sender` | WA service | Feedback sent |

## Related Files

| File | Purpose |
|------|---------|
| `pages/api/activate/activity-log.ts` | Activity log API |
| `src/modules/activate/components/ActivityTab.tsx` | Activity tab UI |
| `scripts/migrations/083_activity_log_and_qa_validation.sql` | Schema |
