# Cron Module Documentation

**Module**: Scheduled Jobs & Background Tasks
**Status**: Active Production
**Last Updated**: March 10, 2026

---

## 📋 Overview

The Cron module provides scheduled background jobs for FibreFlow, handling automated tasks across multiple domains including accounting synchronization, field operations, fleet management, communications, and data processing.

### Purpose

- **Automated Data Synchronization**: Keep external systems (Sage, Microsoft Graph, 1Map) in sync
- **Background Processing**: Handle compute-intensive tasks like VLM photo analysis
- **Scheduled Reminders**: Send timely notifications to users (fleet checks, meetings)
- **Recurring Operations**: Generate recurring invoices, journals, and reports
- **System Maintenance**: Backfill missing data, recheck statuses, cleanup tasks

---

## 🎯 Key Features

### Core Capabilities

1. **External System Integration**
   - Sage accounting synchronization (invoices, payments)
   - Microsoft Graph API polling (Teams meetings)
   - 1Map data backfilling and status checks

2. **Intelligent Processing**
   - VLM (Vision Language Model) queue processing for DR photo analysis
   - Parallel execution with configurable concurrency
   - Automatic retry and error handling

3. **Communication Automation**
   - Fleet driver check-in reminders (WhatsApp + Email)
   - Action item extraction from meeting transcripts
   - Graph subscription renewals

4. **Financial Automation**
   - Recurring invoice generation
   - Recurring journal entry posting
   - Scheduled Sage synchronization

5. **Security & Authentication**
   - CRON_SECRET header verification
   - Bearer token authentication
   - Production-only enforcement

---

## 📁 Module Structure

```
pages/api/cron/
├── backfill-onemap-data.ts         # Backfill missing ONT/UPS serials from 1Map (310 lines)
├── enable-auto-recording.ts        # Enable auto-recording for upcoming Teams meetings (63 lines)
├── fleet-check-reminders.ts        # Send daily/weekly vehicle check reminders to drivers (396 lines)
├── poll-teams.ts                   # Poll Microsoft Graph for new Teams meetings (116 lines)
├── process-vlm-queue.ts            # Process DR photos through VLM pipeline (404 lines)
├── recheck-onemap-status.ts        # Recheck 1Map activation status for pending DRs (144 lines)
├── recurring-invoices.ts           # Generate customer invoices from templates (74 lines)
├── recurring-journals.ts           # Post journal entries from templates (74 lines)
├── renew-graph-subscriptions.ts    # Renew Microsoft Graph change notifications (122 lines)
├── sage-sync.ts                    # Sync invoices & payments from Sage (201 lines)
├── sync-action-items.ts            # Extract action items from Fireflies meetings (98 lines)
└── sync-onemap-serials.ts          # Sync ONT/UPS serials from 1Map to DB (87 lines)

Total: 12 cron endpoints, 2,089 lines of code
```

---

## 🔧 Cron Jobs Detail

### Financial Operations

#### 1. **sage-sync.ts** - Sage Accounting Synchronization
- **Schedule**: Every 15 minutes (configured externally)
- **Purpose**: Pull new invoices and payments from Sage
- **Operations**:
  - Fetch new invoices since last sync
  - Fetch new payments since last sync
  - Update budget transactions
  - Refresh OAuth tokens automatically
- **Tables**: `sage_api_config`, `sage_sync_history`, `sage_invoices`, `sage_payments`
- **Auth**: CRON_SECRET or Bearer token

#### 2. **recurring-invoices.ts** - Recurring Invoice Generation
- **Schedule**: 0 6 * * * (6 AM daily)
- **Purpose**: Generate customer invoices from active templates
- **Operations**:
  - Find templates due today or earlier
  - Generate invoices via `generateInvoiceFromRecurring()`
  - Update next_run_date
- **Tables**: `recurring_invoices`, `accounting_invoices`
- **Auth**: CRON_SECRET or session cookie

#### 3. **recurring-journals.ts** - Recurring Journal Entry Posting
- **Schedule**: 0 6 * * * (6 AM daily)
- **Purpose**: Post journal entries from active templates
- **Operations**:
  - Find templates due today or earlier
  - Generate journals via `generateJournalFromRecurring()`
  - Update next_run_date
- **Tables**: `recurring_journals`, `accounting_journals`
- **Auth**: CRON_SECRET or session cookie

### Field Operations & Data Processing

#### 4. **process-vlm-queue.ts** - VLM Photo Analysis
- **Schedule**: */5 * * * * (every 5 minutes)
- **Purpose**: Categorize and extract data from DR photos using Vision Language Models
- **Operations**:
  - Find DRs with uncategorized photos
  - Categorize photos by installation step (Step 6, 7, 9)
  - Extract power meter readings (dBm)
  - Extract ONT serials from Step 6 & Step 9 photos
  - Extract DR numbers from Step 9 photos
  - Validate serial number cross-references
  - Process up to 20 DRs per run with 3 concurrent workers
- **Tables**: `dr_photo_unified_reviews`
- **Services**: `categorizationVlmService`, `vlmExtractionService`, `qaAutoFailService`
- **Performance**: Parallel batches, prioritizes extraction-only DRs
- **Auth**: Bearer CRON_SECRET

#### 5. **backfill-onemap-data.ts** - 1Map Data Backfilling
- **Schedule**: */15 * * * * (every 15 minutes)
- **Purpose**: Backfill missing ONT/UPS serials from 1Map for historical DRs
- **Operations**:
  - Find DRs missing ONT/UPS serials
  - Query 1Map BOSS API for serial data
  - Update DR records with backfilled data
  - Log backfill operations
- **Tables**: `dr_photo_unified_reviews`
- **API**: 1Map BOSS API
- **Auth**: Bearer CRON_SECRET

#### 6. **recheck-onemap-status.ts** - 1Map Status Verification
- **Schedule**: */30 * * * * (every 30 minutes, typically)
- **Purpose**: Recheck 1Map activation status for pending DRs
- **Operations**:
  - Find DRs with status 'PENDING_ONEMAP'
  - Query 1Map for current status
  - Update DR status if changed
- **Tables**: `dr_photo_unified_reviews`
- **API**: 1Map BOSS API
- **Auth**: Bearer CRON_SECRET

#### 7. **sync-onemap-serials.ts** - 1Map Serial Synchronization
- **Schedule**: */5 * * * * (every 5 minutes)
- **Purpose**: Sync ONT/UPS serials from 1Map to database for active DRs
- **Operations**:
  - Find recently created/updated DRs
  - Fetch serial data from 1Map
  - Update DR records
- **Tables**: `dr_photo_unified_reviews`
- **API**: 1Map BOSS API
- **Auth**: Bearer CRON_SECRET

### Fleet Management

#### 8. **fleet-check-reminders.ts** - Vehicle Check-In Reminders
- **Schedule**: 0 7 * * 1-6 (7 AM Monday-Saturday)
- **Purpose**: Send daily and weekly vehicle check reminders to drivers
- **Operations**:
  - Find vehicles needing daily checks (odometer, fuel gauge photos)
  - Find vehicles needing weekly checks (full pre-trip inspection, Mondays only)
  - Send WhatsApp reminders (primary)
  - Fallback to email if WhatsApp fails
  - Log all reminder attempts
- **Tables**: `fleet_vehicles`, `fleet_check_schedule`, `fleet_check_reminders`, `staff`
- **Services**: `checkInService`
- **External APIs**: WAHA WhatsApp API, Resend Email API
- **Auth**: CRON_SECRET

### Communications & Collaboration

#### 9. **sync-action-items.ts** - Meeting Action Item Extraction
- **Schedule**: 0 */6 * * * (every 6 hours)
- **Purpose**: Extract action items from Fireflies meeting transcripts
- **Operations**:
  - Sync meetings from Fireflies API
  - Extract action items from transcripts
  - Store items in database
- **Tables**: `meetings`, `action_items`
- **External APIs**: Fireflies API
- **Auth**: Bearer CRON_SECRET

#### 10. **poll-teams.ts** - Microsoft Teams Meeting Polling
- **Schedule**: */10 * * * * (every 10 minutes, typically)
- **Purpose**: Poll Microsoft Graph API for new/upcoming Teams meetings
- **Operations**:
  - Query Graph API for calendar events
  - Identify Teams meetings
  - Store meeting metadata
  - Trigger recording setup if needed
- **Tables**: `meetings`, `graph_api_config`
- **External APIs**: Microsoft Graph API
- **Auth**: Bearer CRON_SECRET

#### 11. **enable-auto-recording.ts** - Teams Auto-Recording Setup
- **Schedule**: */15 * * * * (every 15 minutes)
- **Purpose**: Enable auto-recording for upcoming Teams meetings
- **Operations**:
  - Find meetings starting in next 30 minutes
  - Enable recording via Graph API
  - Update meeting metadata
- **Tables**: `meetings`
- **External APIs**: Microsoft Graph API
- **Auth**: Bearer CRON_SECRET

#### 12. **renew-graph-subscriptions.ts** - Graph Subscription Renewal
- **Schedule**: Daily (before expiration)
- **Purpose**: Renew Microsoft Graph change notification subscriptions
- **Operations**:
  - Find subscriptions expiring soon (<24h)
  - Renew via Graph API
  - Update expiration timestamps
- **Tables**: `graph_subscriptions`
- **External APIs**: Microsoft Graph API
- **Auth**: Bearer CRON_SECRET

---

## 🔌 API Endpoints

All cron jobs are HTTP endpoints following this pattern:

```
POST /api/cron/{job-name}
Authorization: Bearer {CRON_SECRET}
```

### Common Request Headers

```http
POST /api/cron/sage-sync
Authorization: Bearer your-cron-secret-here
# OR
x-cron-secret: your-cron-secret-here
```

### Common Response Format

```json
{
  "success": true,
  "message": "Operation completed",
  "processed": 15,
  "succeeded": 14,
  "failed": 1,
  "results": [...],
  "timestamp": "2026-03-10T09:00:00.000Z"
}
```

### Error Response

```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing CRON_SECRET"
}
```

---

## 🗄️ Database Tables

### Core Logging Tables

- **sage_sync_history**: Logs all Sage synchronization operations
- **fleet_check_reminders**: Tracks sent vehicle check reminders
- **fleet_check_schedule**: Tracks reminder schedules per vehicle

### Data Tables Modified by Crons

- **dr_photo_unified_reviews**: Updated by VLM queue, 1Map sync jobs
- **sage_invoices**: Populated by sage-sync
- **sage_payments**: Populated by sage-sync
- **accounting_invoices**: Generated by recurring-invoices
- **accounting_journals**: Generated by recurring-journals
- **meetings**: Updated by poll-teams, sync-action-items
- **action_items**: Populated by sync-action-items
- **graph_subscriptions**: Updated by renew-graph-subscriptions

---

## 🔗 Dependencies

### Internal Services

- `@/lib/logger` - Structured logging with module tagging
- `@/lib/apiResponse` - Standardized API response formatting
- `@/lib/db` - Singleton PostgreSQL connection pool
- `@/lib/neon` - Neon serverless SQL client
- `@/services/sage` - Sage accounting API client
- `@/modules/activate/services/categorizationVlmService` - VLM photo categorization
- `@/modules/activate/services/vlmExtractionService` - VLM data extraction
- `@/modules/fleet/services/checkInService` - Fleet check management
- `@/modules/accounting/services/recurringInvoiceService` - Invoice generation
- `@/modules/accounting/services/recurringJournalService` - Journal generation

### External APIs

- **Sage Accounting API**: OAuth 2.0, invoice/payment sync
- **Microsoft Graph API**: OAuth 2.0, Teams meetings, subscriptions
- **1Map BOSS API**: ONT/UPS serial data, activation status
- **WAHA API**: WhatsApp message delivery
- **Resend API**: Transactional email delivery
- **Fireflies API**: Meeting transcript access

### NPM Packages

- `@neondatabase/serverless` - Neon PostgreSQL client
- `pg` - Node.js PostgreSQL client (fallback)
- `next` - Framework providing API routes

---

## ⚙️ Configuration

### Environment Variables

```bash
# Core Configuration
CRON_SECRET=your-secret-here              # Required for auth
DATABASE_URL=postgresql://...             # Neon/PostgreSQL connection string
NODE_ENV=production                       # Enable strict auth checks

# External Services
SAGE_CLIENT_ID=...                        # Sage OAuth client ID
SAGE_CLIENT_SECRET=...                    # Sage OAuth secret
GRAPH_CLIENT_ID=...                       # Microsoft Graph app ID
GRAPH_CLIENT_SECRET=...                   # Microsoft Graph secret
ONEMAP_HOST=http://...                    # 1Map BOSS API host
WAHA_API_URL=http://...                   # WAHA WhatsApp API
WAHA_SESSION=default                      # WAHA session name
RESEND_API_KEY=...                        # Resend email API key
FIREFLIES_API_KEY=...                     # Fireflies transcript API key

# Application
NEXT_PUBLIC_APP_URL=https://app.fibreflow.app  # Base URL for links in messages
VERCEL_URL=app.fibreflow.app              # Vercel deployment URL
```

### Vercel Cron Configuration (vercel.json)

```json
{
  "functions": {
    "pages/api/cron/process-vlm-queue.ts": {
      "maxDuration": 60
    }
  },
  "crons": [
    {
      "path": "/api/cron/sync-action-items",
      "schedule": "0 */6 * * *"
    },
    {
      "path": "/api/cron/sync-onemap-serials",
      "schedule": "*/5 * * * *"
    },
    {
      "path": "/api/cron/backfill-onemap-data",
      "schedule": "*/15 * * * *"
    },
    {
      "path": "/api/cron/process-vlm-queue",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

---

## 🏗️ Architecture

### Design Patterns

1. **Webhook/Polling Hybrid**: Most jobs use scheduled polling; some could be migrated to webhooks
2. **Idempotent Operations**: Jobs can safely retry without duplicating data
3. **Graceful Degradation**: Multi-channel communication (WhatsApp → Email fallback)
4. **Parallel Processing**: VLM queue uses batched concurrency for throughput
5. **Token Management**: OAuth tokens auto-refresh (Sage, Graph)

### Execution Flow (Typical)

```
┌──────────────────┐
│ Vercel Cron      │ Triggers at scheduled time
│ Scheduler        │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Verify Auth      │ Check CRON_SECRET header
│ (Middleware)     │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Query Database   │ Find pending work (DRs, templates, etc.)
│                  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Process Items    │ Loop/batch process (with error handling)
│                  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Call External    │ APIs: Sage, Graph, 1Map, WAHA, etc.
│ Services         │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Update Database  │ Store results, update timestamps
│                  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Log Results      │ Structured logging with @/lib/logger
│                  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Return JSON      │ { success, processed, results }
│ Response         │
└──────────────────┘
```

### Security Architecture

- **CRON_SECRET Verification**: Production-only enforcement, flexible header names
- **OAuth Token Management**: Automatic refresh with database persistence
- **Rate Limiting**: External APIs respected (backoff, concurrency limits)
- **Logging**: All operations logged for audit trail

---

## 🚀 Development & Testing

### Running Locally

```bash
# Set environment variables
export CRON_SECRET=test-secret
export DATABASE_URL=postgresql://localhost/fibreflow_dev

# Start dev server
npm run dev

# Trigger a cron job manually
curl -X POST http://localhost:3005/api/cron/sage-sync \
  -H "Authorization: Bearer test-secret"
```

### Testing Individual Jobs

```typescript
// Use query parameter for local testing
curl "http://localhost:3005/api/cron/recurring-invoices?secret=test-secret" -X POST
```

### Monitoring

- **Vercel Dashboard**: Cron execution logs, failures
- **Database Logs**: `sage_sync_history`, `fleet_check_reminders` tables
- **Application Logs**: Check `@/lib/logger` output in Vercel logs

---

## 📈 Performance Considerations

### VLM Queue Optimization

- **Batch Processing**: Process 20 DRs per run (configurable)
- **Concurrency**: 3 parallel workers (configurable)
- **Prioritization**: Extraction-only DRs processed first (faster)
- **Deduplication**: Skip already-processed DRs

### Database Performance

- **Indexes**: All cron-related queries use indexed columns
- **Connection Pooling**: Singleton pool prevents connection exhaustion
- **Neon Serverless**: Auto-scales with load

### External API Limits

- **Sage API**: Rate-limited, respects 429 responses
- **Microsoft Graph**: Throttling-aware with retry logic
- **1Map BOSS**: Configurable delays between requests
- **WAHA**: Queue-based delivery, respects API limits

---

## 🔧 Troubleshooting

### Common Issues

#### 1. **401 Unauthorized**
- **Cause**: Missing or incorrect CRON_SECRET
- **Fix**: Verify `CRON_SECRET` environment variable matches request header

#### 2. **Cron Not Executing**
- **Cause**: Vercel cron not configured or schedule incorrect
- **Fix**: Check `vercel.json` cron configuration, redeploy

#### 3. **VLM Queue Not Processing**
- **Cause**: Photos missing, VLM service down, categorization incomplete
- **Fix**: Check photo availability, VLM service status, logs

#### 4. **OAuth Token Expired**
- **Cause**: Sage/Graph tokens not refreshing
- **Fix**: Check `sage_api_config`/`graph_api_config` token expiry, manually refresh if needed

#### 5. **WhatsApp Messages Failing**
- **Cause**: WAHA service down, invalid phone numbers
- **Fix**: Check WAHA API health, phone number formatting, fallback to email

### Debugging Tips

```bash
# Check recent cron executions in Vercel
vercel logs --follow

# Query sync history
psql $DATABASE_URL -c "SELECT * FROM sage_sync_history ORDER BY started_at DESC LIMIT 10;"

# Check fleet reminders
psql $DATABASE_URL -c "SELECT * FROM fleet_check_reminders WHERE sent_at > NOW() - INTERVAL '24 hours';"

# Test VLM queue manually
curl -X POST https://app.fibreflow.app/api/cron/process-vlm-queue \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d '{"limit": 5, "concurrency": 1}'
```

---

## 🎯 Future Enhancements

### Planned Improvements

1. **Webhook Migration**: Replace polling (poll-teams, sync-onemap-serials) with webhooks where possible
2. **Retry Logic**: Exponential backoff for failed jobs
3. **Dead Letter Queue**: Store failed jobs for manual review/retry
4. **Metrics Dashboard**: Real-time cron execution monitoring
5. **Job Dependency Graph**: Visualize job dependencies and execution order
6. **Configurable Schedules**: Database-driven cron schedules (no redeployment needed)
7. **Job Cancellation**: Graceful shutdown for long-running jobs
8. **Distributed Locking**: Prevent concurrent execution of same job

### Performance Enhancements

- **Smart Batching**: Dynamically adjust batch size based on system load
- **Adaptive Concurrency**: Auto-tune worker count based on API response times
- **Incremental Processing**: Checkpoint long-running jobs for resume capability
- **Parallel VLM Models**: Use multiple VLM instances for higher throughput

---

## 📞 Support & Maintenance

### Monitoring Checklist

- [ ] Check Vercel Cron dashboard daily for failures
- [ ] Review `sage_sync_history` for sync errors
- [ ] Monitor `fleet_check_reminders` delivery rates
- [ ] Verify VLM queue processing times (<5min average)
- [ ] Check OAuth token expiry dates (Sage, Graph)

### Maintenance Tasks

- **Weekly**: Review cron execution logs, check for new errors
- **Monthly**: Optimize slow queries, review database indexes
- **Quarterly**: Review external API usage, optimize costs
- **Annually**: Audit CRON_SECRET rotation, review security posture

---

## 📚 Related Documentation

- [Database Schema](../../../scripts/migrations/) - Migration files for cron-related tables
- [API Response Standards](../../../CLAUDE.md#api-response-standards) - Project conventions
- [Sage Integration](../sage/README.md) - Sage API client documentation
- [Fleet Module](../fleet/README.md) - Fleet management context
- [Activate Module](../activate/README.md) - DR photo review context
- [Vercel Cron Documentation](https://vercel.com/docs/cron-jobs) - Official Vercel cron guide

---

**Last Updated**: March 10, 2026
**Module Maintainer**: Dev Team
**Next Review**: April 10, 2026
