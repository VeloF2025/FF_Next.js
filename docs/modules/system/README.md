# System Module

**Infrastructure Monitoring, Deployment Health, and OLT Equipment Management**

The System module provides operational visibility across three critical areas: deployment health monitoring with real-time system metrics, infrastructure health dashboards for service status tracking, and OLT (Optical Line Terminal) equipment reporting with automated ticket creation for investigation. Operations teams use this module to monitor production deployment status, identify system bottlenecks before they impact users, track optical equipment mismatches, and convert investigation needs into actionable tickets with team assignment and notifications.

---

## 🎯 Purpose

The System module solves three operational challenges in network infrastructure management:

1. **Deployment Visibility** — Operations teams lack visibility into deployment status and system health after releases. The module aggregates metrics (CPU, memory, disk, database health, cron jobs, dependencies) in a single dashboard accessible without SSH access. Managers can validate deployments and troubleshoot issues from their desk or mobile device.

2. **OLT Equipment Tracking** — Optical Line Terminal serial number mismatches discovered during maintenance imports require tedious manual investigation. The module batch-converts discovery reports into tracked maintenance tickets, auto-assigns to teams, and sends notifications with investigation context. Auto-closes tickets when investigation is complete.

3. **System Health Degradation** — Early warning of approaching limits (memory, disk, error rate) requires continuous manual monitoring. The module calculates health status (healthy, degraded, critical) based on threshold rules and flags issues before they cascade into outages.

---

## 📊 Key Features

### Deployment Health Dashboard
- **Real-Time System Metrics**: CPU load, memory usage, disk utilization, network I/O
- **Application Health**: Database connection pool status, active requests, error rate, cache hit ratio
- **Background Jobs**: Cron job status with last/next run times, queue depth, failed job count
- **External Dependencies**: Database latency, Redis connection, S3 accessibility, email service status
- **Overall Status Badge**: Healthy (green), Degraded (yellow), Critical (red)
- **Auto-Refresh**: Configurable polling interval (default: 30 seconds)
- **Mobile Accessible**: Responsive design for on-call engineers checking status from mobile
- **Last Deployment Info**: Git commit, branch, deployment user, duration

### Infrastructure Health Dashboard
- **Service Status Monitoring**: Real-time health indicators for core services
- **Health Trend Charts**: Historical visualization of metrics over time
- **Component Status**: Database, caching, message queues, external APIs
- **Incident Learning**: AI-powered incident correlation and pattern detection
- **Escalation Service**: Automatic alert escalation based on severity rules
- **Recovery Service**: Automated recovery actions for known failure patterns
- **Service Registry**: Catalog of monitored services and health check configurations

### OLT Equipment Reporting & Ticketing
- **Bulk OLT Import**: Process optical equipment reports from network monitoring systems
- **Mismatch Detection**: Identify serial number discrepancies (not_found, needs_investigation, empty_serial)
- **Bulk Ticket Creation**: Convert multiple mismatch records into maintenance tickets with one action
- **Flexible Modes**: Single bulk ticket for all records OR one ticket per record
- **Team Assignment**: Route tickets to Field Ops, Network Ops, or QA teams
- **Email Notifications**: Assigned team receives ticket details with investigation context
- **Ticket Linking**: Records linked to maintenance tickets for status tracking
- **Automatic Resolution**: Closing ticket updates OLT record status to "resolved"
- **Investigation Status**: Tracks investigation progress (pending, under_investigation, resolved)

### Self-Healing Incident Management
- **Incident Detection**: Monitors for known failure patterns
- **Auto-Recovery**: Executes recovery actions without human intervention (restarts, reconnects, etc.)
- **Recovery Approval**: Critical actions require manager approval before execution
- **Learning Feedback**: Past incident resolutions used to improve detection and recovery
- **Incident Correlation**: Links related incidents across services for root cause analysis

### QField Data Integration
- **Field Operations Dashboard**: Real-time visibility into field team activities
- **Data Sync Status**: Track QField synchronization status and latency
- **Offline Data Management**: Monitor offline data queues and sync conflicts
- **Mobile Device Health**: Battery, connectivity, storage levels for field devices

---

## 🏗️ Architecture

### Data Model

**OLT Mismatch Records**
- `id` (UUID): Primary key
- `ont_serial` (VARCHAR): ONT device serial number
- `olt_port` (VARCHAR): Expected OLT port location
- `actual_location` (VARCHAR, nullable): Physical location if found
- `status` (VARCHAR): not_found | needs_investigation | empty_serial | resolved
- `maintenance_ticket_id` (UUID, nullable): Linked ticket for investigation
- `source` (VARCHAR): OLT_REPORT | MANUAL_DISCOVERY | SYNC
- `created_at`, `updated_at`: Timestamps

**Maintenance Tickets (System Module Context)**
- `id` (UUID): Primary key
- `ticket_number` (VARCHAR): Human-readable ID (e.g., MT-2026-0042)
- `title` (VARCHAR): Ticket title
- `ticket_type` (VARCHAR): OLT_INVESTIGATION | REPAIR | INSPECTION | etc.
- `ticket_source` (VARCHAR): OLT_MISMATCH | CUSTOMER_REPORT | etc.
- `assigned_team` (UUID): Team responsible for investigation
- `priority` (VARCHAR): low | medium | high
- `status` (VARCHAR): open | in_progress | on_hold | resolved | closed
- `created_at`, `updated_at`: Timestamps
- **Index**: `idx_olt_mismatch_investigation_status` (fast query for investigation records)

**Deployment Health Metrics**
- Aggregated from system APIs (OS-level monitoring, application metrics)
- Not persisted in primary database; calculated on-demand
- 30-second cache for dashboard performance

### Service Layer

**Deployment Health Service** (`src/modules/system/services/`)
- Aggregates system metrics from multiple sources
- Calculates overall health status (healthy/degraded/critical)
- Thresholds:
  - Healthy: error rate < 1%, memory < 80%, all dependencies up
  - Degraded: error rate 1-5%, memory 80-90%, some dependency latency
  - Critical: error rate > 5%, memory > 90%, dependencies down

**OLT Report Service** (`pages/api/system/olt-report/`)
- Processes OLT equipment reports
- Detects mismatch types (not_found, needs_investigation, empty_serial)
- Tracks investigation status and ticket linking
- Triggers auto-resolution when investigation ticket closes

**Incident Learning Service** (`src/modules/system/services/incidentLearning.ts`)
- Analyzes past incidents for patterns
- Correlates related failures across services
- Recommends recovery actions based on history
- Updates knowledge base for continuous improvement

**Escalation Service** (`src/modules/system/services/escalationService.ts`)
- Monitors alert severity over time
- Auto-escalates unresolved critical issues
- Notifies on-call managers when escalation occurs
- Tracks escalation history for SLA compliance

**Recovery Service** (`src/modules/system/services/recoveryService.ts`)
- Executes automated recovery actions
- Tracks recovery attempts and success rates
- Logs recovery actions for audit trail
- Integrates with approval workflow for critical actions

**Infrastructure Health Service** (`src/modules/system/services/infrastructureHealthService.ts`)
- Monitors core service components
- Calculates health scores per service
- Generates alerts on degradation
- Provides historical trend data

---

## 🔧 Main Files

| File | Purpose |
|------|---------|
| `pages/api/system/deploy-health.ts` | GET: Aggregates all deployment metrics into single health response |
| `pages/api/system/olt-report/index.ts` | GET: List OLT mismatch records with filters |
| `pages/api/system/olt-report/tickets.ts` | POST: Bulk create maintenance tickets from records |
| `pages/api/system/olt-report/records.ts` | GET: OLT records with ticket linking info |
| `pages/api/system/health.ts` | GET: Infrastructure health summary |
| `pages/api/system/self-healing.ts` | POST: Trigger automated recovery actions |
| `pages/api/system/services.ts` | GET: Service catalog and health status |
| `pages/api/system/stats.ts` | GET: Historical statistics and trends |
| `pages/system/infrastructure.tsx` | Dashboard: Infrastructure health visualization |
| `pages/system/health.tsx` | Dashboard: Real-time system metrics |
| `pages/system/data-sync.tsx` | Dashboard: Data synchronization status |
| `pages/system/data-management/olt-report.tsx` | Dashboard: OLT investigation and ticketing |
| `src/modules/system/components/InfrastructureDashboard.tsx` | Health dashboard component |
| `src/modules/system/components/OverviewDashboard.tsx` | System overview component |
| `src/modules/system/components/SelfHealingDashboard.tsx` | Recovery actions visualization |
| `src/modules/system/qfield/QFieldDashboard.tsx` | Field operations data sync dashboard |
| `src/modules/system/services/healthDaemon.ts` | Background service for health monitoring |

---

## 📡 API Endpoints

### Deployment Health

**GET** `/api/system/deploy-health`
- Aggregates all deployment and system health metrics
- Returns:
  ```json
  {
    "deployment": {
      "timestamp": "ISO timestamp",
      "commit": "git hash",
      "branch": "main",
      "duration_seconds": 45,
      "deployed_by": "username"
    },
    "system": {
      "node_version": "20.11.0",
      "memory_used_mb": 1250,
      "memory_total_mb": 2048,
      "memory_percent": 61,
      "cpu_load": [0.8, 1.2, 1.5],
      "disk_usage": [{
        "mount": "/",
        "used_gb": 45,
        "total_gb": 100,
        "percent": 45
      }],
      "uptime_seconds": 3600
    },
    "application": {
      "db_pool": { "active": 5, "idle": 10, "waiting": 0 },
      "active_requests": 12,
      "error_rate_per_hour": 0.8,
      "cache_hit_ratio": 0.92
    },
    "jobs": {
      "cron_status": [{
        "name": "daily_reports",
        "last_run": "ISO timestamp",
        "next_run": "ISO timestamp",
        "status": "success"
      }],
      "queue_depth": 3,
      "failed_jobs_24h": 0
    },
    "dependencies": {
      "database": { "status": "healthy", "latency_ms": 5 },
      "redis": { "status": "healthy", "latency_ms": 2 },
      "s3": { "status": "healthy" },
      "email": { "status": "healthy", "last_sent": "ISO timestamp" }
    },
    "overall_status": "healthy|degraded|critical"
  }
  ```
- **Caching**: 30-second cache to prevent dashboard polling abuse
- **Authorization**: Admin/Ops role required
- **Use Case**: Operations dashboard, health check monitoring, incident triage

### OLT Reporting & Ticketing

**GET** `/api/system/olt-report?status=<status>&limit=<n>`
- List OLT mismatch records
- Query params:
  - `status`: not_found | needs_investigation | empty_serial | resolved | all
  - `limit`: Max results (default: 100)
  - `offset`: Pagination
  - `has_ticket`: Filter by ticket status (true|false|all)
- Returns: `{ records: [...], total: number }`

**POST** `/api/system/olt-report/tickets`
- Bulk create maintenance tickets from selected mismatch records
- Body:
  ```json
  {
    "record_ids": ["uuid", "uuid", ...],
    "ticket_type": "OLT_INVESTIGATION",
    "assigned_team": "team-uuid",
    "priority": "low|medium|high",
    "bulk_mode": true,
    "notes": "optional context"
  }
  ```
- **Bulk Mode (true)**: Creates one ticket containing all records as line items
- **Individual Mode (false)**: Creates one ticket per record
- Side effects:
  - Updates `maintenance_ticket_id` for each record
  - Sets record status to "under_investigation"
  - Sends email notification to assigned team
  - Logs ticket creation in audit trail
- Returns:
  ```json
  {
    "tickets": [{
      "id": "uuid",
      "ticket_number": "MT-2026-0042",
      "title": "OLT Investigation: 3 mismatched records",
      "record_count": 3,
      "assigned_team": "team-uuid",
      "created_at": "ISO timestamp"
    }],
    "summary": {
      "tickets_created": 1,
      "records_ticketed": 3,
      "emails_sent": 1
    }
  }
  ```

**GET** `/api/system/olt-report/records/:record_id`
- Fetch individual OLT record with ticket linking info
- Returns record details including `maintenance_ticket_id` if linked

### Infrastructure Health

**GET** `/api/system/health`
- Infrastructure health summary
- Returns component status (database, caching, queues, APIs)
- Overall health calculation

**GET** `/api/system/services`
- Service catalog: all monitored services with health checks
- Returns: `{ services: [{name, status, latency_ms, last_check}] }`

**GET** `/api/system/stats?timeframe=<1h|24h|7d>`
- Historical statistics and trend data
- Error rates, latency percentiles, incident frequency

### Self-Healing & Incident Management

**POST** `/api/system/self-healing`
- Trigger recovery action for known failure
- Body: `{ incident_type, service, action_type }`
- Executes automated fix or schedules for approval if critical

**GET** `/api/system/approve-recovery`
- List pending recovery actions awaiting approval

---

## 🔌 Integration Points

### Maintenance Module
- OLT mismatch records link to maintenance tickets via `maintenance_ticket_id`
- Closing investigation ticket triggers OLT record resolution
- Ticket details display OLT investigation context

### Field Operations / QField Module
- Field team data sync status monitored in health dashboard
- QField sync conflicts tracked and reported
- Field device health (connectivity, battery, storage) monitored

### Notifications Module
- Email notifications sent to assigned teams via Resend
- Slack/SMS alerts for critical health status changes (if configured)
- Incident escalation notifications

### Audit & Logging
- All OLT ticketing actions logged with user context
- Recovery actions logged for compliance review
- Health metrics stored for historical analysis

---

## 📋 Database Tables

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `olt_mismatch_records` | Equipment serial mismatches | id, ont_serial, status, maintenance_ticket_id, created_at |
| `maintenance_tickets` | Investigation & repair tickets | id, ticket_number, ticket_type, ticket_source, assigned_team, status |
| `incident_logs` | Incident detection and recovery history | id, incident_type, service, action_taken, resolved_at |
| `service_health_checks` | Component health check results | id, service_name, status, latency_ms, timestamp |

---

## 🛠️ Configuration

### Health Status Thresholds

| Metric | Healthy | Degraded | Critical |
|--------|---------|----------|----------|
| **Memory Usage** | < 80% | 80-90% | > 90% |
| **Disk Usage** | < 85% | 85-95% | > 95% |
| **Error Rate** | < 1% per hour | 1-5% per hour | > 5% per hour |
| **Cache Hit Ratio** | > 85% | 70-85% | < 70% |
| **DB Pool Wait Queue** | 0 | 1-5 | > 5 pending |
| **Dependency Latency** | < 100ms | 100-500ms | > 500ms |

### OLT Record Status Values

- `not_found` — Equipment expected but not found at location
- `needs_investigation` — Flagged for further verification
- `empty_serial` — Serial field is empty or incomplete
- `under_investigation` — Ticket created, being investigated
- `resolved` — Investigation complete, issue resolved
- `provisioning_mismatch` — Provisioning system shows different assignment

### Ticket Priority Auto-Suggestion Rules

- **High**: > 10 "not_found" records, or critical service impact reported
- **Medium**: Default for bulk operations (5-10 records)
- **Low**: Single record or low-impact mismatch

---

## 📖 Related Documentation

- **[CHANGELOG.md](./CHANGELOG.md)** — Feature history and commit details
- **[Infrastructure Architecture](../../../docs/architecture/)** — System design and deployment pipeline
- **[Maintenance Module](../maintenance/README.md)** — Ticket lifecycle and management
- **[Notifications Module](../notifications/README.md)** — Alert routing and delivery

---

## 🚀 Common Workflows

### Check Deployment Health After Release

1. Navigate to **System** → **Deployment Health**
2. Check overall status badge (should be green "Healthy")
3. Review metrics:
   - **Memory**: Should be < 80% after startup warmup
   - **CPU Load**: Should be normal (1.0-2.0 on multi-core)
   - **Error Rate**: Should be < 1% (expected spikes during data sync)
   - **Database**: Connection pool idle > 5 (indicates availability)
4. If **Degraded/Critical**:
   - Click error rate → view error logs
   - Check dependencies (is external service slow?)
   - Check cron job status (any failed jobs?)
5. Approve rollback if health not acceptable

### Investigate OLT Equipment Mismatch

1. Navigate to **System** → **OLT Report** → **Data Management**
2. View mismatch records filtered by status
3. Select records requiring investigation (checkbox mode)
4. Click **Create Tickets** button
5. Choose bulk or individual mode:
   - **Bulk**: One ticket for all records, faster processing
   - **Individual**: One ticket per record, better traceability
6. Set priority (auto-suggested if > 10 records)
7. Assign team (Field Ops, Network Ops, QA)
8. Submit → tickets created, emails sent
9. Assigned team receives ticket with investigation context
10. Team updates ticket with findings
11. Close ticket → OLT record status auto-updates to "resolved"

### Monitor System Health for Degradation

1. Navigate to **System** → **Infrastructure Health**
2. Review component status cards
3. Check trend charts for approaching thresholds
4. If trending toward **Degraded**:
   - Investigate root cause (check logs)
   - Plan capacity increase (if memory/disk)
   - Reach out to vendor (if external dependency slow)
5. System auto-escalates if critical threshold crossed (optional)

### Resolve Auto-Recovery Action

1. System detects failure pattern, executes recovery
2. For critical actions: Approval needed from manager
3. Navigate to **System** → **Self-Healing Dashboard**
4. Review pending recovery action
5. Approval options:
   - **Approve**: Execute action immediately
   - **Deny**: Cancel action, escalate manually
   - **View Logs**: See incident context and history
6. Action executed → incident status updates
7. Review result in health dashboard

---

## 🔍 Monitoring & Alerts

### Dashboard Auto-Refresh
- Default: Every 30 seconds
- Configurable: Use localStorage preference
- Pause when inactive (browser tab not focused)

### Alert Rules
- **Status becomes Degraded**: Minor notifications (console log)
- **Status becomes Critical**: Major alert (email to ops team)
- **OLT mismatch discovered**: Automated ticketing (if enabled)
- **Cron job fails**: Alert to on-call engineer
- **Error rate spikes**: Dashboard highlight, ops notification

### Key Metrics for Incident Detection
- Memory growth rate (detect memory leak before OOM)
- Error rate trend (detect cascading failure early)
- Dependency latency (detect external service slowness)
- Queue depth (detect processing backlog)
- Database connection exhaustion (detect connection leak)

---

**Owner**: velo  
**Last Updated**: 2026-03-15  
**Module Version**: 1.0.0 (Deployment Health, OLT Reporting, Infrastructure Monitoring)
