# ONT Lifecycle Tracking System Architecture

## Executive Summary

This document defines a comprehensive ONT (Optical Network Terminal) lifecycle tracking system that unifies data from multiple sources to provide complete visibility into device status from installation through maintenance.

## The ONT Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           ONT LIFECYCLE TIMELINE                                     │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Day 0           Day 0           Day 0          Day 1         Day 3+      Ongoing   │
│    │               │               │              │             │            │       │
│    ▼               ▼               ▼              ▼             ▼            ▼       │
│ ┌──────┐      ┌─────────┐     ┌────────┐     ┌───────┐    ┌────────┐   ┌─────────┐ │
│ │ WA   │      │  1Map   │     │ Step   │     │  OES  │    │  ARCH  │   │ SPARC   │ │
│ │Photo │ ──▶  │ Entry   │ ──▶ │ 6/9    │ ──▶ │Report │ ──▶│Report  │──▶│ Report  │ │
│ └──────┘      └─────────┘     └────────┘     └───────┘    └────────┘   └─────────┘ │
│    │               │               │              │             │            │       │
│    │               │               │              │             │            │       │
│ Serials        Serials         ONT only       BECOMES      Shows        Weekly      │
│ visible        entered         VLM verify     SOURCE OF    OFFLINE      network     │
│ (raw)          (may have       barcode        TRUTH        devices      health      │
│                errors)                                                              │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## Lifecycle Stages & Events

### Stage 1: Installation (Day 0)
| Event | Source | Data Captured |
|-------|--------|---------------|
| `WA_PHOTO_RECEIVED` | WhatsApp Bridge | Photo with ONT/UPS visible |
| `WA_PHOTO_VLM_PROCESSED` | VLM Service | Extracted serials from photo |
| `ONEMAP_ENTRY_CREATED` | 1Map Sync | Technician-entered serials |
| `STEP_PHOTO_UPLOADED` | QA System | Step 6 (ONT) / Step 9 (UPS) |
| `STEP_VLM_VERIFIED` | VLM Service | Barcode/VLM extracted serial |

### Stage 2: Activation (Day 1)
| Event | Source | Data Captured |
|-------|--------|---------------|
| `OES_ACTIVATED` | OES Import | ONT serial, activation time, signal |
| `SERIAL_CONFIRMED` | Cross-reference | OES matches other sources |
| `SERIAL_MISMATCH_DETECTED` | Cross-reference | OES differs from installation |
| `QA_APPROVED` | Human Review | Final QA approval |

### Stage 3: Monitoring (Day 3+)
| Event | Source | Data Captured |
|-------|--------|---------------|
| `ARCH_OFFLINE_DETECTED` | ARCH Import | Device went offline |
| `ARCH_REASON_RECORDED` | ARCH Import | Dying Gasp, Not Active, etc. |
| `SPARC_STATUS_UPDATE` | SPARC Import | Weekly network health |
| `MAINTENANCE_TICKET_CREATED` | Auto/Manual | Issue requires attention |

### Stage 4: Recovery
| Event | Source | Data Captured |
|-------|--------|---------------|
| `ARCH_BACK_ONLINE` | ARCH Comparison | Device no longer in offline list |
| `MAINTENANCE_RESOLVED` | Ticket System | Issue fixed |
| `SERIAL_SWAP_RECORDED` | Manual/Auto | ONT was replaced |
| `DR_REACTIVATED` | OES Import | New activation after offline |

## Database Schema

### Core Lifecycle Table: `ont_lifecycle_events`

```sql
CREATE TABLE ont_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_number VARCHAR(50) NOT NULL,

  -- Event Details
  event_type VARCHAR(50) NOT NULL,
  event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_source VARCHAR(50) NOT NULL,  -- 'wa_photo', 'onemap', 'oes', 'arch', 'sparc', 'manual'

  -- Serial Tracking
  ont_serial VARCHAR(50),
  ups_serial VARCHAR(50),
  previous_ont_serial VARCHAR(50),  -- For tracking changes
  previous_ups_serial VARCHAR(50),

  -- Verification
  confidence_score DECIMAL(3,2),  -- 0.00 to 1.00
  verification_method VARCHAR(50),  -- 'barcode', 'vlm', 'manual', 'cross_reference'
  sources_agreeing INTEGER DEFAULT 0,

  -- Offline Tracking
  offline_reason VARCHAR(100),
  days_offline INTEGER,
  signal_strength DECIMAL(6,3),

  -- Metadata
  actor VARCHAR(100),  -- user_id, 'system', 'vlm', 'import_job'
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Indexes
  CONSTRAINT valid_event_type CHECK (event_type IN (
    -- Installation
    'WA_PHOTO_RECEIVED', 'WA_PHOTO_VLM_PROCESSED', 'ONEMAP_ENTRY_CREATED',
    'STEP_PHOTO_UPLOADED', 'STEP_VLM_VERIFIED',
    -- Activation
    'OES_ACTIVATED', 'SERIAL_CONFIRMED', 'SERIAL_MISMATCH_DETECTED', 'QA_APPROVED',
    -- Monitoring
    'ARCH_OFFLINE_DETECTED', 'ARCH_REASON_RECORDED', 'SPARC_STATUS_UPDATE',
    'MAINTENANCE_TICKET_CREATED',
    -- Recovery
    'ARCH_BACK_ONLINE', 'MAINTENANCE_RESOLVED', 'SERIAL_SWAP_RECORDED', 'DR_REACTIVATED',
    -- Manual
    'MANUAL_SERIAL_EDIT', 'MANUAL_STATUS_CHANGE', 'NOTE_ADDED'
  ))
);

CREATE INDEX idx_lifecycle_dr ON ont_lifecycle_events(drop_number);
CREATE INDEX idx_lifecycle_timestamp ON ont_lifecycle_events(event_timestamp DESC);
CREATE INDEX idx_lifecycle_type ON ont_lifecycle_events(event_type);
CREATE INDEX idx_lifecycle_source ON ont_lifecycle_events(event_source);
CREATE INDEX idx_lifecycle_ont ON ont_lifecycle_events(ont_serial);
```

### SPARC Report Table: `sparc_reports`

```sql
CREATE TABLE sparc_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_number VARCHAR(50) NOT NULL,

  -- Report Data
  report_date DATE NOT NULL,
  report_type VARCHAR(20) DEFAULT 'weekly',  -- 'weekly' or 'daily'

  -- Device Status
  device_status VARCHAR(50),  -- 'online', 'offline', 'degraded'
  signal_strength DECIMAL(6,3),
  packet_loss DECIMAL(5,2),
  latency_ms INTEGER,

  -- Network Details
  olt_address VARCHAR(100),
  vlan VARCHAR(20),
  area VARCHAR(50),

  -- Serial
  ont_serial VARCHAR(50),

  -- Import Tracking
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  import_batch_id UUID,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(drop_number, report_date)
);

CREATE INDEX idx_sparc_dr ON sparc_reports(drop_number);
CREATE INDEX idx_sparc_date ON sparc_reports(report_date DESC);
CREATE INDEX idx_sparc_status ON sparc_reports(device_status);
```

### DR Current Status View: `vw_dr_current_status`

```sql
CREATE OR REPLACE VIEW vw_dr_current_status AS
WITH latest_events AS (
  SELECT DISTINCT ON (drop_number, event_type)
    drop_number,
    event_type,
    event_timestamp,
    ont_serial,
    ups_serial,
    metadata
  FROM ont_lifecycle_events
  ORDER BY drop_number, event_type, event_timestamp DESC
),
serial_sources AS (
  SELECT
    drop_number,
    MAX(CASE WHEN event_source = 'wa_photo' THEN ont_serial END) as wa_ont,
    MAX(CASE WHEN event_source = 'onemap' THEN ont_serial END) as onemap_ont,
    MAX(CASE WHEN event_source = 'oes' THEN ont_serial END) as oes_ont,
    MAX(CASE WHEN event_source = 'arch' THEN ont_serial END) as arch_ont
  FROM ont_lifecycle_events
  WHERE ont_serial IS NOT NULL
  GROUP BY drop_number
)
SELECT
  q.drop_number,

  -- Current Serials
  COALESCE(o.serial_number, q.ont_serial_scanned) as ont_serial,
  q.ups_serial_scanned as ups_serial,

  -- Lifecycle Status
  CASE
    WHEN od.drop_number IS NOT NULL THEN 'offline'
    WHEN o.drop_number IS NOT NULL THEN 'active'
    WHEN q.qa_status = 'approved' THEN 'approved'
    ELSE 'pending'
  END as lifecycle_status,

  -- Activation Info
  o.activation_date,
  o.team as installation_team,

  -- Offline Info
  od.last_down_reason as offline_reason,
  od.days_since_last_inform as days_offline,

  -- Serial Verification
  ss.wa_ont,
  ss.onemap_ont,
  ss.oes_ont,
  ss.arch_ont,
  (
    CASE WHEN ss.wa_ont IS NOT NULL THEN 1 ELSE 0 END +
    CASE WHEN ss.onemap_ont IS NOT NULL THEN 1 ELSE 0 END +
    CASE WHEN ss.oes_ont IS NOT NULL THEN 1 ELSE 0 END +
    CASE WHEN ss.arch_ont IS NOT NULL THEN 1 ELSE 0 END
  ) as serial_sources_count,

  -- QA Status
  q.qa_status,
  q.final_decision

FROM dr_photo_unified_reviews q
LEFT JOIN oes_activations o ON q.drop_number = o.drop_number
LEFT JOIN offline_devices od ON q.drop_number = od.drop_number
LEFT JOIN serial_sources ss ON q.drop_number = ss.drop_number;
```

## Report Integration

### OES Import Enhancement

```typescript
// In OES import job, after inserting activation:
await logLifecycleEvent(dropNumber, {
  eventType: 'OES_ACTIVATED',
  eventSource: 'oes',
  ontSerial: oesRow.serial_number,
  actor: 'oes_import_job',
  metadata: {
    activation_date: oesRow.timestamp,
    olt_address: oesRow.olt_address,
    signal_strength: oesRow.ont_rx_sig,
    team: oesRow.team
  }
});

// Cross-reference with existing data
const existing = await getExistingSerials(dropNumber);
if (existing.onemap_ont && existing.onemap_ont !== oesRow.serial_number) {
  await logLifecycleEvent(dropNumber, {
    eventType: 'SERIAL_MISMATCH_DETECTED',
    eventSource: 'cross_reference',
    ontSerial: oesRow.serial_number,
    previousOntSerial: existing.onemap_ont,
    metadata: {
      expected_source: 'onemap',
      expected_serial: existing.onemap_ont,
      actual_source: 'oes',
      actual_serial: oesRow.serial_number
    }
  });
}
```

### ARCH Import Enhancement

```typescript
// Track new offline devices
await logLifecycleEvent(dropNumber, {
  eventType: 'ARCH_OFFLINE_DETECTED',
  eventSource: 'arch',
  ontSerial: archRow.serial_number,
  offlineReason: archRow.reason,
  daysOffline: archRow.days_offline,
  metadata: {
    last_event_time: archRow.last_event_time,
    area: archRow.area,
    oes_status: archRow.oes_status
  }
});

// CRITICAL: Detect devices that came BACK ONLINE
// Compare current ARCH with previous day's ARCH
const previouslyOffline = await getPreviousDayOffline();
const currentlyOffline = new Set(currentArchData.map(r => r.drop_number));

for (const dr of previouslyOffline) {
  if (!currentlyOffline.has(dr)) {
    await logLifecycleEvent(dr, {
      eventType: 'ARCH_BACK_ONLINE',
      eventSource: 'arch_comparison',
      metadata: { detected_method: 'arch_daily_comparison' }
    });
  }
}
```

### SPARC Import (New)

```typescript
// pages/api/imports/sparc.ts
export async function importSparcReport(file: File) {
  const rows = parseSparcExcel(file);

  for (const row of rows) {
    // Insert SPARC data
    await sql`
      INSERT INTO sparc_reports (drop_number, report_date, device_status, ...)
      VALUES (${row.drop_number}, ${row.report_date}, ${row.status}, ...)
      ON CONFLICT (drop_number, report_date)
      DO UPDATE SET device_status = ${row.status}, ...
    `;

    // Log lifecycle event
    await logLifecycleEvent(row.drop_number, {
      eventType: 'SPARC_STATUS_UPDATE',
      eventSource: 'sparc',
      ontSerial: row.serial_number,
      metadata: {
        report_date: row.report_date,
        device_status: row.status,
        signal_strength: row.signal
      }
    });
  }
}
```

## Anomaly Detection

### Serial Mismatch Types

| Type | Detection | Severity |
|------|-----------|----------|
| **Entry Swap** | ONT in UPS field, vice versa | Medium |
| **Typo** | 1-2 char difference | Low |
| **Different Serial** | Completely different | High |
| **Missing Serial** | Present in one source, absent in another | Medium |
| **Late Mismatch** | OES/ARCH differs from installation | Critical |

### Automatic Anomaly Detection

```typescript
async function detectSerialAnomalies(dropNumber: string) {
  const sources = await getSerialSources(dropNumber);
  const anomalies = [];

  // Check for swaps (ONT pattern in UPS field)
  if (sources.onemap_ups?.startsWith('ALCL')) {
    anomalies.push({
      type: 'POTENTIAL_SWAP',
      details: 'ONT pattern found in UPS field',
      affected: 'onemap'
    });
  }

  // Check for mismatches across sources
  const ontValues = [sources.wa_ont, sources.onemap_ont, sources.oes_ont, sources.arch_ont]
    .filter(Boolean);
  const uniqueOnts = [...new Set(ontValues.map(s => s.toUpperCase()))];

  if (uniqueOnts.length > 1) {
    anomalies.push({
      type: 'SERIAL_MISMATCH',
      details: `Found ${uniqueOnts.length} different ONT serials`,
      values: uniqueOnts
    });
  }

  return anomalies;
}
```

## UI: DR Timeline View

```tsx
// components/activate/DrTimelineView.tsx
export function DrTimelineView({ dropNumber }: { dropNumber: string }) {
  const { data: events } = useQuery(['dr-timeline', dropNumber],
    () => fetchLifecycleEvents(dropNumber)
  );

  return (
    <Timeline>
      {events?.map(event => (
        <TimelineEvent key={event.id}>
          <EventIcon type={event.event_type} />
          <EventContent>
            <EventTitle>{formatEventType(event.event_type)}</EventTitle>
            <EventTime>{formatDate(event.event_timestamp)}</EventTime>
            {event.ont_serial && (
              <SerialBadge
                serial={event.ont_serial}
                previousSerial={event.previous_ont_serial}
              />
            )}
            {event.offline_reason && (
              <OfflineReason reason={event.offline_reason} />
            )}
          </EventContent>
        </TimelineEvent>
      ))}
    </Timeline>
  );
}
```

## Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Create `ont_lifecycle_events` table
- [ ] Create `sparc_reports` table
- [ ] Add lifecycle logging to existing OES import
- [ ] Add lifecycle logging to existing ARCH import

### Phase 2: Detection (Week 2)
- [ ] Implement ARCH back-online detection (daily comparison)
- [ ] Implement serial mismatch auto-detection
- [ ] Add lifecycle events to WA photo receipt
- [ ] Add lifecycle events to 1Map sync

### Phase 3: SPARC Integration (Week 3)
- [ ] Build SPARC import API
- [ ] Create SPARC import UI
- [ ] Add SPARC lifecycle events
- [ ] Build SPARC status reports

### Phase 4: UI & Reporting (Week 4)
- [ ] Build DR Timeline component
- [ ] Add lifecycle view to QA Centre
- [ ] Create Lifecycle Anomaly Report
- [ ] Build Serial Verification Dashboard

## Metrics & KPIs

| Metric | Description | Target |
|--------|-------------|--------|
| Serial Match Rate | % of DRs where all sources agree | > 95% |
| Back-Online Detection | % of recovered devices tracked | 100% |
| Mismatch Resolution Time | Days from detection to resolution | < 3 days |
| Lifecycle Coverage | % of DRs with full event history | > 90% |
| VLM Processing Rate | % of WA photos with extracted serials | > 80% |
