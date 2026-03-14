# System Module CHANGELOG

All notable changes to the System Administration module are documented here.

---

## [Unreleased]

### Added
- **OLT Bulk Ticketing for Investigation Records** (2026-03-11, commit `f55a38e`)
  - Create maintenance tickets from OLT mismatch records
  - Bulk ticket creation for not_found, needs_investigation, empty_serial records
  - Team assignment with email notifications via Resend
  - 5 new endpoints for ticket management
  - 5 schema changes: maintenance_ticket_id link, OLT source/type enums

- **Deployment Health Dashboard** (2026-03-02, commit `fe6b07b`)
  - Real-time deployment monitoring interface
  - Health metrics visualization
  - Single endpoint for deployment status aggregation

---

## Commit Details

### f55a38ec — feat(olt): add bulk ticketing for investigation records

**Date**: 2026-03-11 13:05:46 +0200  
**Author**: Claude Sonnet 4.5  
**Co-Author**: Claude Opus 4.6

#### Description

Implements bulk maintenance ticket creation from OLT (Optical Line Terminal) mismatch records that require investigation. Allows operations team to convert serial number discrepancies (not_found, needs_investigation, empty_serial) into trackable maintenance tickets with team assignment and email notifications.

#### Files Changed

1. **pages/api/system/olt-report/tickets.ts** (+255 lines, NEW)
   - **POST** `/api/system/olt-report/tickets`
   - Creates maintenance tickets from selected OLT mismatch records
   - Request body:
     ```typescript
     {
       record_ids: string[];                    // Array of olt_mismatch_record IDs
       ticket_type: 'OLT_INVESTIGATION';        // Ticket type enum
       assigned_team?: string;                  // Team ID (optional, defaults to field ops)
       priority: 'low' | 'medium' | 'high';     // Ticket priority
       bulk_mode: boolean;                      // true = single ticket for all, false = one per record
       notes?: string;                          // Additional context
     }
     ```
   - Logic:
     - **Bulk Mode (true)**: Creates one ticket with all records as line items
       - Title: "OLT Investigation: 15 mismatched records"
       - Description: Table of all records with serials, statuses, reasons
       - Single assignment, single notification
     - **Individual Mode (false)**: Creates one ticket per record
       - Title: "OLT Investigation: [ONT Serial] - [Status]"
       - Description: Detailed info for single record
       - Separate assignments possible (if team has routing rules)
   - Email notification (via Resend):
     - Recipient: Assigned team's email distribution list
     - Subject: "New OLT Investigation Tickets Assigned"
     - Body:
       - Ticket ID and link to ticket detail page
       - Record summary: ONT serial, status, location
       - Priority and expected resolution timeframe
       - Instructions for investigation workflow
   - Side effects:
     - Updates `olt_mismatch_records.maintenance_ticket_id` for each record
     - Marks records as "under_investigation" status
     - Logs ticket creation event in audit trail
     - Sends email notifications to assigned team
   - Validation:
     - All record IDs must exist and be valid
     - Records must have status: not_found, needs_investigation, or empty_serial
     - Cannot ticket already-resolved records
     - User must have ticket creation permission
   - Response:
     ```typescript
     {
       tickets: Array<{
         id: string;
         ticket_number: string;
         title: string;
         record_count: number;
         assigned_team: string;
         created_at: Date;
       }>;
       summary: {
         tickets_created: number;
         records_ticketed: number;
         emails_sent: number;
       };
     }
     ```
   - Error handling:
     - Invalid record IDs: 404 with list of missing IDs
     - Already ticketed: 409 with list of conflicting records
     - Email failure: Log warning, continue (ticket still created)

2. **pages/api/system/olt-report/records.ts** (+1 line, MODIFIED)
   - Added `maintenance_ticket_id` to record response
   - Allows UI to show ticket link for already-ticketed records

3. **scripts/migrations/228_olt_mismatch_tickets.sql** (+23 lines, NEW)
   - **Schema Change 1**: Add `maintenance_ticket_id` column
     ```sql
     ALTER TABLE olt_mismatch_records 
     ADD COLUMN maintenance_ticket_id UUID REFERENCES maintenance_tickets(id);
     CREATE INDEX idx_olt_mismatch_ticket ON olt_mismatch_records(maintenance_ticket_id);
     ```
   - **Schema Change 2**: Add OLT_MISMATCH to ticket source enum
     ```sql
     ALTER TYPE ticket_source_enum ADD VALUE 'OLT_MISMATCH' AFTER 'CUSTOMER_REPORT';
     ```
   - **Schema Change 3**: Add OLT_INVESTIGATION to ticket type enum
     ```sql
     ALTER TYPE ticket_type_enum ADD VALUE 'OLT_INVESTIGATION' AFTER 'INSTALLATION';
     ```
   - **Schema Change 4**: Create index on record status for investigation queries
     ```sql
     CREATE INDEX idx_olt_mismatch_investigation_status 
     ON olt_mismatch_records(status) 
     WHERE status IN ('not_found', 'needs_investigation', 'empty_serial');
     ```
   - **Schema Change 5**: Add trigger to update record status when ticket is closed
     ```sql
     CREATE TRIGGER update_olt_record_on_ticket_close
     AFTER UPDATE ON maintenance_tickets
     FOR EACH ROW
     WHEN (OLD.status != 'closed' AND NEW.status = 'closed')
     EXECUTE FUNCTION update_olt_mismatch_status_on_close();
     ```
   - Function `update_olt_mismatch_status_on_close()`:
     - When ticket is closed with resolution "resolved"
     - Updates linked OLT records to status "resolved"
     - Logs resolution in OLT audit trail

4. **src/modules/system/components/groups/olt/CreateOltTicketsModal.tsx** (+141 lines, NEW)
   - React modal component for ticket creation
   - Props:
     - `recordIds`: Array of selected record IDs
     - `onClose`: Close modal callback
     - `onSuccess`: Ticket created callback (refreshes list)
   - Form fields:
     - **Ticket Mode**: Radio buttons
       - "Single Ticket (Bulk)" — One ticket for all records
       - "Individual Tickets" — One per record
     - **Ticket Type**: Dropdown (default: OLT_INVESTIGATION)
     - **Assigned Team**: Team selector dropdown
       - Options: Field Ops, Network Ops, QA Team
       - Default: Field Ops
     - **Priority**: Radio buttons (Low, Medium, High)
       - Default: Medium
       - Auto-suggests High if > 10 records with "not_found" status
     - **Notes**: Textarea for additional context (optional)
   - Preview section:
     - Shows ticket title based on mode
     - Lists first 5 records (with "and X more..." if > 5)
     - Displays assigned team and priority
   - Validation:
     - Must select at least one record
     - Team assignment required
     - Confirms if creating > 20 individual tickets
   - Submit flow:
     - Calls POST `/api/system/olt-report/tickets`
     - Shows loading spinner during creation
     - Success: Toast notification with ticket count
     - Error: Shows error message, allows retry
   - Mobile responsive with full-screen on small devices

5. **src/modules/system/components/groups/olt/OltInvestigateTab.tsx** (+152 lines, -23 lines MODIFIED)
   - Enhanced investigation tab with bulk ticketing UI
   - New features:
     - **Bulk Select Mode**: Checkbox column for record selection
       - "Select All" header checkbox
       - Individual row checkboxes
       - Selected count badge: "5 selected"
     - **Bulk Actions Bar** (appears when items selected):
       - "Create Tickets" button (opens CreateOltTicketsModal)
       - "Export CSV" button
       - "Clear Selection" button
     - **"Ticket All Not Found" Button**:
       - Quick action for ticketing all not_found records
       - Confirmation dialog: "Create tickets for 23 not_found records?"
       - Bypasses manual selection, goes straight to ticket creation
     - **Status Filters** (existing, enhanced):
       - Added "Already Ticketed" filter (shows records with ticket links)
       - Badge shows ticket count per filter
     - **Ticket Link Display**:
       - Records with `maintenance_ticket_id` show clickable ticket badge
       - Badge: "Ticket #MT-2026-0042" (links to ticket detail)
       - Tooltip: "Created on [date] by [user]"
   - Record table integration:
     - Passes `checkboxMode={true}` to OltRecordTable
     - Manages selected IDs state
     - Disables selection for already-ticketed records

6. **src/modules/system/components/groups/olt/OltRecordTable.tsx** (+11 lines, MODIFIED)
   - Added `checkboxMode` prop (boolean, default false)
   - When true:
     - Renders checkbox column as first column
     - Checkbox disabled if record has `maintenance_ticket_id`
     - Emits `onSelectionChange` event with selected IDs
   - Visual indication for ticketed records:
     - Row has light blue background
     - Ticket badge in status column
     - Tooltip: "Ticket #... created [date ago]"

7. **src/modules/data-sync/types.ts** (+1 line, MODIFIED)
   - Added `OLT_MISMATCH` to `TicketSource` enum type

8. **src/modules/maintenance/types/ticket.ts** (+2 lines, MODIFIED)
   - Added `OLT_INVESTIGATION` to `TicketType` enum
   - Updated type definition:
     ```typescript
     export type TicketType = 
       | 'INSTALLATION'
       | 'REPAIR'
       | 'INSPECTION'
       | 'OLT_INVESTIGATION'  // NEW
       | 'PREVENTIVE_MAINTENANCE';
     ```

#### API Usage Example

```bash
# Create bulk ticket for multiple records
POST /api/system/olt-report/tickets
Body: {
  record_ids: ["r1", "r2", "r3"],
  ticket_type: "OLT_INVESTIGATION",
  assigned_team: "field-ops-team-id",
  priority: "medium",
  bulk_mode: true,
  notes: "Found during weekly OLT sync, requires physical verification"
}

Response: {
  tickets: [
    {
      id: "t1",
      ticket_number: "MT-2026-0042",
      title: "OLT Investigation: 3 mismatched records",
      record_count: 3,
      assigned_team: "field-ops-team-id",
      created_at: "2026-03-11T13:00:00Z"
    }
  ],
  summary: {
    tickets_created: 1,
    records_ticketed: 3,
    emails_sent: 1
  }
}

# Create individual tickets
POST /api/system/olt-report/tickets
Body: {
  record_ids: ["r1", "r2", "r3"],
  ticket_type: "OLT_INVESTIGATION",
  assigned_team: "field-ops-team-id",
  priority: "high",
  bulk_mode: false
}

Response: {
  tickets: [
    { id: "t1", ticket_number: "MT-2026-0042", title: "OLT Investigation: ONT123456 - not_found", ... },
    { id: "t2", ticket_number: "MT-2026-0043", title: "OLT Investigation: ONT789012 - not_found", ... },
    { id: "t3", ticket_number: "MT-2026-0044", title: "OLT Investigation: ONT345678 - empty_serial", ... }
  ],
  summary: {
    tickets_created: 3,
    records_ticketed: 3,
    emails_sent: 3
  }
}
```

#### Key Features

- **Bulk Processing**: Efficiently ticket multiple records at once
- **Flexible Modes**: Single bulk ticket or individual tickets per record
- **Team Assignment**: Automated routing to appropriate operations team
- **Email Notifications**: Assigned team notified immediately via Resend
- **Status Tracking**: Records linked to tickets, status updated on resolution
- **Audit Trail**: All ticket creation events logged with user context
- **UI Integration**: Seamless workflow from investigation tab to ticket creation
- **Already-Ticketed Detection**: Prevents duplicate tickets, shows existing ticket links

#### PRD Alignment

**KB Query Result**: Knowledge base describes OLT mismatch investigation workflow: "Identify Mismatch Types: Entry Swap, Typo, Different Serial, Missing Serial... Investigate Mismatches: Cross-reference with physical installations... Ticketing Maintenance: Create or update tickets in your maintenance system to track the resolution of these issues."

**Status**: Fully aligned with KB description

**Assessment**: Feature implements the documented ticketing workflow for OLT mismatches. KB explicitly states: "Create or update tickets in your maintenance system to track the resolution" — this implementation provides bulk ticket creation with team assignment and email notifications as described.

**No Doc Drift Detected**: Code implements KB-described feature accurately.

**Doc Enhancement Opportunity**: KB should be updated with:
- Description of bulk vs. individual ticket modes
- Team assignment options and routing rules
- Email notification format and content
- Ticket resolution workflow (how closing tickets updates OLT records)

#### Use Cases

1. **Weekly OLT Sync**: After weekly OLT report import, ops team bulk-tickets all "not_found" records for field investigation
2. **High-Priority Discrepancies**: Network issues detected, ops creates high-priority individual tickets for affected ONTs
3. **Project-Specific Investigation**: During project close-out, ticket all mismatches for specific PON/zone for verification
4. **Audit Compliance**: Before monthly audit, ensure all unresolved mismatches have tracking tickets
5. **Team Workload Distribution**: Assign different mismatch batches to different field teams based on location

#### Email Notification Template

**Subject**: "New OLT Investigation Tickets Assigned - 3 Records"

**Body**:
```
Hi Field Ops Team,

You have been assigned 3 new OLT Investigation tickets:

Ticket: MT-2026-0042 (Bulk)
Priority: Medium
Records: 3 mismatched ONT serials
Locations: Zone 5, PON 3, PON 7

Records to Investigate:
1. ONT Serial: 123456 - Status: not_found - Location: Zone 5, PON 3
2. ONT Serial: 789012 - Status: needs_investigation - Location: Zone 5, PON 3
3. ONT Serial: 345678 - Status: empty_serial - Location: Zone 5, PON 7

Action Required:
- Physically verify ONT serial numbers at listed locations
- Cross-reference with OLT port allocations
- Update ticket with findings (resolved, swap detected, physical mismatch)
- Close ticket once investigation complete

View Ticket: https://fibreflow.app/tickets/MT-2026-0042

Expected Resolution: Within 3 business days

Questions? Contact your team lead or reply to this email.

— FibreFlow Maintenance System
```

#### Testing Checklist

- [ ] Bulk mode creates single ticket with all records
- [ ] Individual mode creates one ticket per record
- [ ] Email notifications sent to assigned team
- [ ] Record `maintenance_ticket_id` updated after ticket creation
- [ ] Cannot ticket already-ticketed records (validation)
- [ ] Ticket link displayed correctly in investigation tab
- [ ] Checkbox selection works, disables for ticketed records
- [ ] "Ticket All Not Found" button creates correct count
- [ ] Ticket status filters work (Already Ticketed filter)
- [ ] Closing ticket updates OLT record status to "resolved"
- [ ] Audit trail logs ticket creation event
- [ ] Mobile responsive modal and table UI
- [ ] CSV export includes ticket IDs for ticketed records
- [ ] High priority auto-suggested for > 10 not_found records

#### Future Enhancements (Not in This Commit)

- SLA tracking for ticket resolution times
- Automatic escalation if tickets unresolved after 7 days
- Integration with field mobile app for in-field ticket updates
- Photo upload for physical verification evidence
- Batch ticket resolution (mark multiple tickets as resolved at once)
- Dashboard widget showing open OLT investigation ticket count

---

### fe6b07bc — feat(system): deployment health dashboard

**Date**: 2026-03-02 15:15:20 +0200  
**Author**: Hein van Vuuren

#### Description

Implements a centralized deployment health monitoring dashboard that provides real-time visibility into system status, deployment metrics, and health indicators. Replaces manual SSH monitoring with a web-based dashboard accessible to operations team.

#### Files Changed

1. **pages/api/system/deploy-health.ts** (+129 lines, NEW)
   - **GET** `/api/system/deploy-health`
   - Aggregates multiple health metrics:
     - **Deployment Status**:
       - Last deployment timestamp
       - Current git commit hash and branch
       - Deployment duration
       - Deploy user
     - **System Metrics**:
       - Node.js version
       - Memory usage (used/total)
       - CPU load average (1min, 5min, 15min)
       - Disk usage for critical mounts
       - Uptime since last restart
     - **Application Health**:
       - Database connection pool status
       - Active API requests count
       - Error rate (last hour)
       - Cache hit ratio
     - **Background Jobs**:
       - Cron job status (last run, next run)
       - Queue depth (pending background tasks)
       - Failed job count (last 24h)
     - **External Dependencies**:
       - Database latency (ping time)
       - Redis connection status
       - S3 bucket accessibility
       - Email service status (Resend API)
   - Returns:
     ```typescript
     {
       deployment: {
         timestamp: Date;
         commit: string;
         branch: string;
         duration_seconds: number;
         deployed_by: string;
       };
       system: {
         node_version: string;
         memory_used_mb: number;
         memory_total_mb: number;
         memory_percent: number;
         cpu_load: [number, number, number];
         disk_usage: Array<{ mount: string; used_gb: number; total_gb: number; percent: number }>;
         uptime_seconds: number;
       };
       application: {
         db_pool: { active: number; idle: number; waiting: number };
         active_requests: number;
         error_rate_per_hour: number;
         cache_hit_ratio: number;
       };
       jobs: {
         cron_status: Array<{ name: string; last_run: Date; next_run: Date; status: string }>;
         queue_depth: number;
         failed_jobs_24h: number;
       };
       dependencies: {
         database: { status: 'healthy' | 'degraded' | 'down'; latency_ms: number };
         redis: { status: string; latency_ms: number };
         s3: { status: string };
         email: { status: string; last_sent: Date };
       };
       overall_status: 'healthy' | 'degraded' | 'critical';
     }
     ```
   - Health calculation logic:
     - `healthy`: All systems operational, error rate < 1%, memory < 80%
     - `degraded`: Minor issues, error rate 1-5%, memory 80-90%, some dependencies slow
     - `critical`: Major issues, error rate > 5%, memory > 90%, dependencies down
   - Authorization: Requires admin or ops role
   - Caching: Response cached for 30 seconds (high-frequency dashboard polling)

2. **pages/deploy-health.tsx** (+174 lines, NEW)
   - Next.js page component for health dashboard
   - Layout:
     - **Header**:
       - Overall status badge (large, color-coded)
       - Last deployment info (commit, branch, time ago)
       - Auto-refresh toggle (30s interval)
     - **Metrics Grid** (4 columns, responsive):
       - System card: Memory, CPU, Disk, Uptime
       - Application card: DB pool, Active requests, Error rate, Cache
       - Jobs card: Cron status list, Queue depth, Failed jobs
       - Dependencies card: DB, Redis, S3, Email (status icons)
   - Visual features:
     - Color-coded status indicators:
       - Green: Healthy (checkmark icon)
       - Yellow: Degraded (warning icon)
       - Red: Critical (exclamation icon)
     - Progress bars for percentage metrics (memory, disk, cache)
     - Sparkline charts for historical trends (if enabled)
     - Tooltips on hover with detailed info
   - Interactivity:
     - Click metric card → expand for detailed view
     - Click deployment info → show git diff modal
     - Click cron job → view job logs
     - Error rate click → open error log viewer
   - Real-time updates:
     - Auto-refresh every 30 seconds (configurable)
     - Visual pulse animation on refresh
     - "Last updated X seconds ago" timestamp
   - Mobile responsive:
     - Single column layout on small screens
     - Swipeable metric cards
   - Empty/error states:
     - "Unable to fetch health data" with retry button
     - "Partial data available" warning if some metrics fail

#### API Usage Example

```bash
# Get current deployment health
GET /api/system/deploy-health
Response: {
  deployment: {
    timestamp: "2026-03-02T15:10:00Z",
    commit: "fe6b07b",
    branch: "main",
    duration_seconds: 45,
    deployed_by: "hein"
  },
  system: {
    node_version: "20.11.0",
    memory_used_mb: 1250,
    memory_total_mb: 2048,
    memory_percent: 61,
    cpu_load: [0.8, 1.2, 1.5],
    disk_usage: [
      { mount: "/", used_gb: 45, total_gb: 100, percent: 45 },
      { mount: "/data", used_gb: 180, total_gb: 500, percent: 36 }
    ],
    uptime_seconds: 3600
  },
  application: {
    db_pool: { active: 5, idle: 10, waiting: 0 },
    active_requests: 12,
    error_rate_per_hour: 0.8,
    cache_hit_ratio: 0.92
  },
  jobs: {
    cron_status: [
      {
        name: "daily_reports",
        last_run: "2026-03-02T06:00:00Z",
        next_run: "2026-03-03T06:00:00Z",
        status: "success"
      }
    ],
    queue_depth: 3,
    failed_jobs_24h: 0
  },
  dependencies: {
    database: { status: "healthy", latency_ms: 5 },
    redis: { status: "healthy", latency_ms: 2 },
    s3: { status: "healthy" },
    email: { status: "healthy", last_sent: "2026-03-02T14:55:00Z" }
  },
  overall_status: "healthy"
}
```

#### Key Features

- **Single Pane of Glass**: All deployment health metrics in one view
- **Real-Time Monitoring**: Auto-refresh with configurable interval
- **Color-Coded Alerts**: Instant visual indication of issues
- **Historical Context**: Last deployment info for correlation
- **Dependency Tracking**: External service health monitoring
- **Cron Job Visibility**: Background task status at a glance
- **Mobile Accessible**: Operations team can check health on mobile devices
- **No External Tools**: Self-contained monitoring (no Datadog/NewRelic dependency)

#### PRD Alignment

**KB Query Result**: Knowledge base references deployment monitoring via CLI tool `deployment-monitor` with commands: `monitor` (live), `last` (recent deployment), `stats` (historical). Documentation describes SSH-based monitoring approach.

**Status**: Extends KB-documented CLI tool with web dashboard

**Assessment**: Feature complements the documented `deployment-monitor` CLI by providing a web-based alternative. KB mentions real-time monitoring and deployment statistics, which this dashboard implements via HTTP API instead of SSH. Adds value by making health data accessible without terminal access.

**Doc Enhancement Opportunity**: KB should be updated to mention the web dashboard as an alternative to SSH monitoring. Document URL path `/deploy-health` and use cases (mobile access, manager visibility, incident triage).

#### Use Cases

1. **Incident Response**: Ops team checks dashboard first during incident to identify bottlenecks
2. **Deployment Validation**: After deployment, verify "healthy" status before closing deploy ticket
3. **Capacity Planning**: Monitor memory and disk trends to predict when scaling is needed
4. **Cron Monitoring**: Catch failed background jobs before they impact users
5. **Dependency Health**: Identify external service degradation (e.g., S3 slow, Redis down)
6. **Mobile Monitoring**: On-call engineer checks system health from phone during commute

#### Security Considerations

- **Authorization Required**: Only admin/ops roles can access endpoint
- **No Sensitive Data Exposure**: No passwords, keys, or user data in health metrics
- **Rate Limiting**: Endpoint cached to prevent abuse (30s cache window)
- **Audit Logging**: Health check access logged for security review

#### Testing Checklist

- [ ] Dashboard loads within 2 seconds
- [ ] Overall status calculates correctly based on metrics
- [ ] Auto-refresh works without memory leaks
- [ ] Mobile responsive layout on iOS and Android
- [ ] Color-coded status badges match thresholds
- [ ] Click interactions (expand cards, view logs) work
- [ ] "Degraded" state triggers when memory > 80%
- [ ] "Critical" state triggers when dependencies down
- [ ] Error handling: API failure shows retry button
- [ ] Authorization: non-admin users get 403 error
- [ ] Caching: Rapid requests return cached response
- [ ] Historical sparklines render correctly (if enabled)

#### Future Enhancements (Not in This Commit)

- Slack/email alerts when status becomes "degraded" or "critical"
- Historical trend graphs (24h, 7d, 30d views)
- Export health data to CSV for analysis
- Custom alert thresholds per metric
- Integration with uptime monitoring (e.g., UptimeRobot)
- Webhook support for external monitoring tools

---

**Module Owner**: hein:velo  
**Last Updated**: 2026-03-11 17:20 SAST  
**Documented By**: Scribe (subagent)
