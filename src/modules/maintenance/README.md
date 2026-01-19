# FibreFlow Ticketing Module - Phase 1 Core

## Overview

The FibreFlow Ticketing Module is a comprehensive system for managing fiber network issues, faults, and maintenance requests. This module replaces 6 parallel Excel spreadsheets and integrates with QContact, WhatsApp, and internal systems.

**Module Version:** 1.0.0 (Phase 1 Core)
**Status:** 🚧 In Development
**Database:** Neon PostgreSQL (direct SQL, no ORM)
**Development Methodology:** TDD/BMAD (Tests FIRST, Code SECOND)

---

## Features

### ✅ Phase 1: Foundation - Database & Core CRUD (Weeks 1-2)
- [x] Database schema with 12 tables (8 core + 4 maintenance)
- [ ] Basic ticket CRUD operations
- [ ] DR number lookup from SOW module
- [ ] Module structure setup

### 🚧 Phase 2: Verification & QA Readiness (Weeks 3-4)
- [ ] 12-step verification workflow
- [ ] QA readiness validation system
- [ ] Photo upload integration
- [ ] Risk acceptance workflow

### 🔜 Phase 3: Fault Attribution & Handover (Weeks 5-6)
- [ ] Fault cause classification (7 categories)
- [ ] Handover snapshot system
- [ ] Repeat fault detection & escalation
- [ ] Maintenance handover gates

### 🔜 Phase 4: QContact Integration (Weeks 7-8)
- [ ] Bidirectional sync with QContact
- [ ] Webhook handlers
- [ ] Sync monitoring & audit logging

### 🔜 Phase 5: Weekly Import & WhatsApp (Weeks 9-10)
- [ ] Excel import wizard (93+ items)
- [ ] WhatsApp notifications via WAHA
- [ ] Dashboard & analytics

---

## Module Structure

```
src/modules/ticketing/
├── types/              # TypeScript type definitions
├── services/           # Business logic and data access
├── components/         # React components
├── hooks/              # Custom React hooks
├── utils/              # Utility functions
├── constants/          # Enums and constant values
├── __tests__/          # Test files (TDD approach)
│   ├── services/
│   ├── utils/
│   ├── api/
│   ├── components/
│   └── hooks/
├── migrations/         # Database migration files
├── index.ts            # Server exports
├── client.ts           # Client-safe exports
└── README.md           # This file
```

---

## Usage

### Server-Side Usage

```typescript
// Import from main index.ts
import { ticketService, drLookupService } from '@/modules/ticketing';

// Use services in API routes
const ticket = await ticketService.create({
  title: 'Fiber outage',
  type: 'maintenance',
  priority: 'high'
});
```

### Client-Side Usage

```typescript
'use client';

// Import from client.ts for client components
import { useTickets, TicketList } from '@/modules/ticketing/client';

export default function TicketsPage() {
  const { tickets, loading } = useTickets();
  return <TicketList tickets={tickets} loading={loading} />;
}
```

---

## API Endpoints

### Ticket CRUD
- `GET /api/ticketing/tickets` - List tickets with filters
- `POST /api/ticketing/tickets` - Create ticket
- `GET /api/ticketing/tickets/{id}` - Get ticket detail
- `PUT /api/ticketing/tickets/{id}` - Update ticket
- `DELETE /api/ticketing/tickets/{id}` - Delete ticket

### DR Lookup
- `GET /api/ticketing/dr-lookup/{drNumber}` - Lookup DR from SOW module

### Verification
- `GET /api/ticketing/tickets/{id}/verification` - Get verification steps
- `PUT /api/ticketing/tickets/{id}/verification/{step}` - Update step

### QA Readiness
- `POST /api/ticketing/tickets/{id}/qa-readiness-check` - Run readiness check
- `GET /api/ticketing/tickets/{id}/qa-readiness` - Get readiness status

### Handover
- `POST /api/ticketing/tickets/{id}/handover` - Create handover snapshot
- `GET /api/ticketing/tickets/{id}/handover-history` - Get handover history

### Weekly Import
- `POST /api/ticketing/import/weekly` - Upload weekly report Excel
- `GET /api/ticketing/import/weekly/{id}` - Get import status

### Dashboard
- `GET /api/ticketing/dashboard/summary` - Dashboard summary stats
- `GET /api/ticketing/dashboard/sla` - SLA compliance stats

---

## Database Schema

### Core Tables (8)
1. **tickets** - Main ticket table with all core fields
2. **verification_steps** - 12-step verification tracking
3. **weekly_reports** - Import batch tracking
4. **qcontact_sync_log** - Bidirectional sync audit
5. **guarantee_periods** - Guarantee configuration by project
6. **whatsapp_notifications** - Notification delivery tracking
7. **ticket_attachments** - File metadata
8. **ticket_notes** - Internal/client notes

### Maintenance Enhancement Tables (4)
9. **qa_readiness_checks** - Pre-QA validation log
10. **qa_risk_acceptances** - Conditional approval tracking
11. **handover_snapshots** - Immutable audit trail
12. **repeat_fault_escalations** - Infrastructure-level escalation

See `migrations/` folder for full schema.

---

## Testing

This module follows **TDD (Test-Driven Development)** methodology.

### Test Structure
- **Unit Tests:** Services and utilities (90-95% coverage target)
- **Integration Tests:** API endpoints (85% coverage target)
- **Component Tests:** React components (70% coverage target)
- **E2E Tests:** Critical user flows

### Running Tests

```bash
# Run all tests
npm run test

# Run tests for ticketing module
npm run test src/modules/ticketing

# Run with coverage
npm run test:coverage

# Run specific test file
npm run test src/modules/ticketing/__tests__/services/ticketService.test.ts
```

---

## Development Workflow

### TDD Approach (MANDATORY)

1. **Write Tests First** - Before any implementation
2. **Implement Code** - Make tests pass
3. **Refactor** - Clean up while keeping tests green
4. **Verify Coverage** - Ensure coverage meets targets

### Example TDD Workflow

```bash
# Step 1: Write test file
touch src/modules/ticketing/__tests__/services/ticketService.test.ts

# Step 2: Write failing tests
# ... write tests that describe expected behavior

# Step 3: Run tests (they should fail)
npm run test ticketService.test.ts

# Step 4: Implement code to make tests pass
touch src/modules/ticketing/services/ticketService.ts

# Step 5: Run tests again (they should pass)
npm run test ticketService.test.ts

# Step 6: Check coverage
npm run test:coverage
```

---

## Code Quality Standards

### NLNH Protocol (No Lies, No Hallucinations)
- Mark ALL code with honest status markers
- 🟢 WORKING: Tested and functional
- 🟡 PARTIAL: Basic functionality only
- 🔴 BROKEN: Does not work
- 🔵 MOCK: Placeholder/fake data
- ⚪ UNTESTED: Written but not verified

### DGTS Protocol (Don't Game The System)
- Write REAL tests, not trivial assertions
- No `assert True` or `assert 1 == 1`
- Test actual functionality, not mock returns

### Zero Tolerance Rules
- ❌ No `console.log` in production code
- ❌ No empty catch blocks
- ❌ No error swallowing (`except: pass`)
- ❌ No `print()` in production library code

---

## Dependencies

- **Database:** Neon PostgreSQL (serverless)
- **Auth:** Clerk
- **Storage:** Firebase Storage
- **External APIs:** QContact, WAHA (WhatsApp)
- **Excel Parsing:** xlsx library

---

## Acceptance Criteria

### Phase 1 Success Criteria
- ✅ All 12 database tables deployed
- [ ] CRUD APIs functional for tickets
- [ ] DR lookup working from SOW module
- [ ] 90%+ test coverage on services

### Phase 2 Success Criteria
- [ ] 12-step verification workflow functional
- [ ] QA readiness checks blocking incomplete tickets
- [ ] Risk acceptance workflow operational

### Phase 3 Success Criteria
- [ ] Fault attribution tracking all 7 categories
- [ ] Handover snapshots immutable and locked
- [ ] Repeat fault escalation auto-creating infrastructure tickets

### Phase 4 Success Criteria
- [ ] QContact bidirectional sync at 90%+ success rate
- [ ] Webhook handlers processing real-time updates

### Phase 5 Success Criteria
- [ ] Weekly import completing in <15 minutes for 100+ items
- [ ] WhatsApp notifications 100% compliant
- [ ] Dashboard live with real-time stats

---

## Contributing

### Before Marking Subtask Complete
- [ ] Tests written FIRST (TDD approach)
- [ ] All tests passing
- [ ] Coverage meets threshold (90%+ services, 95%+ utils, 85%+ API, 70%+ components)
- [ ] No skipped tests without documented reason
- [ ] No console.log/print debugging statements
- [ ] Error handling in place
- [ ] Code follows NLNH protocol (honest status markers)
- [ ] Code follows DGTS protocol (real tests, not gaming)
- [ ] Code follows Zero Tolerance rules

---

## Support

For questions or issues:
- Check the [implementation_plan.json](./.auto-claude/specs/001-ticketing-phase1-core/implementation_plan.json)
- Review the [spec.md](./.auto-claude/specs/001-ticketing-phase1-core/spec.md)
- Check [build-progress.txt](./.auto-claude/specs/001-ticketing-phase1-core/build-progress.txt)

---

**Last Updated:** 2025-12-27
**Current Phase:** Phase 1 - Foundation
**Next Milestone:** Complete basic ticket CRUD operations
