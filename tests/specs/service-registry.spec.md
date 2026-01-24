# Test Specification: Service Registry

## Source

- **PRD/Spec**: `.claude/plans/sequential-growing-brook.md`
- **Date Created**: 2026-01-24
- **Author**: Claude (TDD Implementation)

---

## Overview

The Service Registry is the central database of all monitored services. It defines service metadata, health endpoints, criticality levels, and recovery configurations. Used by the health daemon and recovery service.

---

## Feature Requirements

### FR-1: Service Definition Storage
- Store service definitions in `infrastructure_services` table
- Support categories: app, ai, messaging, database, infrastructure
- Track: name, endpoint, criticality, recovery enabled

### FR-2: Recovery Action Storage
- Store recovery actions in `recovery_actions` table
- Each action: command, risk level, requires approval, success/failure counts
- Link actions to services (many-to-one)

### FR-3: Service Registry API
- CRUD operations for services (admin only)
- List all services with status aggregation
- Get service with its recovery actions
- Bulk status check endpoint

### FR-4: Seeded Services
Pre-populate with 14+ known services:
- FibreFlow Production, Staging, Dev, Backup
- VLM (Qwen3), Ollama, Qdrant
- WA Feedback, WA Sender VPS, WA Bridge VPS
- Neon Production, Neon Dev, QField Postgres
- Cloudflared, PDFCraft, Grafana, Portainer

---

## Unit Tests - Service Definition

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| SD-001 | Create service with valid data | Full definition | Service created | HIGH |
| SD-002 | Reject service without name | name=null | Validation error | HIGH |
| SD-003 | Reject service without endpoint | endpoint=null | Validation error | HIGH |
| SD-004 | Validate category enum | category=invalid | Validation error | HIGH |
| SD-005 | Default isCritical to false | No value | isCritical=false | MEDIUM |
| SD-006 | Default recoveryEnabled to false | No value | recoveryEnabled=false | MEDIUM |
| SD-007 | Update service name | New name | Name updated | HIGH |
| SD-008 | Update service endpoint | New endpoint | Endpoint updated | HIGH |
| SD-009 | Delete service | Valid ID | Service removed | HIGH |
| SD-010 | Delete cascades recovery actions | Service with actions | Actions deleted | HIGH |

### Test File Location
`tests/unit/modules/system/serviceRegistry.test.ts`

---

## Unit Tests - Recovery Action

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| RA-001 | Create action with valid data | Full definition | Action created | HIGH |
| RA-002 | Reject action without command | command=null | Validation error | HIGH |
| RA-003 | Validate risk level enum | riskLevel=invalid | Validation error | HIGH |
| RA-004 | Safe risk defaults no approval | riskLevel=safe | requiresApproval=false | HIGH |
| RA-005 | Dangerous risk requires approval | riskLevel=dangerous | requiresApproval=true | HIGH |
| RA-006 | Track success count | Increment | count+1 | HIGH |
| RA-007 | Track failure count | Increment | count+1 | HIGH |
| RA-008 | Get actions for service | Service ID | Linked actions | HIGH |
| RA-009 | Delete action | Valid ID | Action removed | HIGH |
| RA-010 | Update last executed timestamp | Execute | Timestamp updated | MEDIUM |

### Test File Location
`tests/unit/modules/system/recoveryActions.test.ts`

---

## Unit Tests - Registry Functions

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| RF-001 | getAllServices returns all | 14 services | 14 returned | HIGH |
| RF-002 | getServiceById returns one | Valid ID | Service object | HIGH |
| RF-003 | getServiceById returns null | Invalid ID | null | HIGH |
| RF-004 | getServicesByCategory filters | category=ai | AI services only | HIGH |
| RF-005 | getCriticalServices filters | isCritical=true | Critical only | HIGH |
| RF-006 | getServicesWithRecovery filters | recoveryEnabled=true | Recovery enabled only | HIGH |
| RF-007 | getServiceWithActions joins | Valid ID | Service + actions | HIGH |
| RF-008 | bulkUpdateStatus updates all | Status map | All updated | HIGH |
| RF-009 | getRecoveryActionsForService | Service ID | Actions array | HIGH |
| RF-010 | countServicesByStatus groups | Mixed statuses | Count per status | MEDIUM |

### Test File Location
`tests/unit/modules/system/registryFunctions.test.ts`

---

## Integration Tests

| ID | Description | Components Involved | Expected Behavior | Priority |
|----|-------------|---------------------|-------------------|----------|
| IT-001 | GET /api/system/services lists all | API, DB | All services returned | HIGH |
| IT-002 | GET /api/system/services/:id returns one | API, DB | Single service | HIGH |
| IT-003 | POST /api/system/services creates | API, DB | Service created | HIGH |
| IT-004 | PUT /api/system/services/:id updates | API, DB | Service updated | HIGH |
| IT-005 | DELETE /api/system/services/:id removes | API, DB | Service deleted | HIGH |
| IT-006 | Seed data present after migration | DB | 14+ services exist | HIGH |
| IT-007 | Recovery actions linked correctly | API, DB | Actions returned | HIGH |
| IT-008 | Auth required for mutations | API | 401 without token | HIGH |

### Test File Location
`tests/integration/api/system/services.test.ts`

---

## Acceptance Criteria Mapping

- [x] **AC1**: Store service definitions → `SD-001` - `SD-010`
- [x] **AC2**: Store recovery actions → `RA-001` - `RA-010`
- [x] **AC3**: CRUD API for services → `IT-001` - `IT-007`
- [x] **AC4**: Pre-seeded with 14+ services → `IT-006`
- [x] **AC5**: Track success/failure counts → `RA-006`, `RA-007`
- [x] **AC6**: Risk level determines approval → `RA-004`, `RA-005`
- [x] **AC7**: Filter by category/criticality → `RF-004`, `RF-005`

---

## Database Schema

```sql
CREATE TABLE infrastructure_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL CHECK (category IN ('app', 'ai', 'messaging', 'database', 'infrastructure')),
  health_endpoint VARCHAR(500) NOT NULL,
  is_critical BOOLEAN DEFAULT false,
  recovery_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE recovery_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID REFERENCES infrastructure_services(id) ON DELETE CASCADE,
  action_name VARCHAR(100) NOT NULL,
  description TEXT,
  command TEXT NOT NULL,
  risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('safe', 'moderate', 'dangerous')),
  requires_approval BOOLEAN DEFAULT false,
  success_indicator VARCHAR(200),
  rollback_command TEXT,
  success_count INT DEFAULT 0,
  failure_count INT DEFAULT 0,
  last_executed TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_services_category ON infrastructure_services(category);
CREATE INDEX idx_services_critical ON infrastructure_services(is_critical);
CREATE INDEX idx_actions_service ON recovery_actions(service_id);
CREATE INDEX idx_actions_risk ON recovery_actions(risk_level);
```

---

## Seed Data (14+ Services)

```typescript
const SEED_SERVICES = [
  // App (4)
  { name: 'FibreFlow Production', category: 'app', endpoint: 'https://app.fibreflow.app/api/health', isCritical: true },
  { name: 'FibreFlow Staging', category: 'app', endpoint: 'https://vf.fibreflow.app/api/health', isCritical: false },
  { name: 'FibreFlow Dev', category: 'app', endpoint: 'https://dev.fibreflow.app/api/health', isCritical: false },
  { name: 'FibreFlow Backup', category: 'app', endpoint: 'https://backup.fibreflow.app/api/health', isCritical: false },

  // AI (3)
  { name: 'VLM (Qwen3)', category: 'ai', endpoint: 'http://100.96.203.105:8100/health', isCritical: true },
  { name: 'Ollama', category: 'ai', endpoint: 'http://100.96.203.105:11434/api/tags', isCritical: false },
  { name: 'Qdrant', category: 'ai', endpoint: 'http://100.96.203.105:6333/healthz', isCritical: false },

  // Messaging (3)
  { name: 'WA Feedback', category: 'messaging', endpoint: 'http://100.96.203.105:8092/health', isCritical: true },
  { name: 'WA Sender VPS', category: 'messaging', endpoint: 'http://72.61.197.178:8081/health', isCritical: true },
  { name: 'WA Bridge VPS', category: 'messaging', endpoint: 'http://72.61.197.178:8083/health', isCritical: true },

  // Database (3)
  { name: 'Neon Production', category: 'database', endpoint: 'neon://ep-dry-night-a9qyh4sj', isCritical: true },
  { name: 'Neon Dev', category: 'database', endpoint: 'neon://ep-aged-poetry-a9bbd8e9', isCritical: false },
  { name: 'QField Postgres', category: 'database', endpoint: 'postgres://qfield', isCritical: false },

  // Infrastructure (4)
  { name: 'Cloudflared', category: 'infrastructure', endpoint: 'systemd://cloudflared-tunnel.service', isCritical: true },
  { name: 'PDFCraft', category: 'infrastructure', endpoint: 'https://vf.fibreflow.app/pdf-tools/', isCritical: false },
  { name: 'Grafana', category: 'infrastructure', endpoint: 'http://100.96.203.105:3030/api/health', isCritical: false },
  { name: 'Portainer', category: 'infrastructure', endpoint: 'https://100.96.203.105:9443/api/status', isCritical: false },
];
```

---

## Notes

- Use UUID for IDs to support distributed systems
- ON DELETE CASCADE ensures actions are cleaned up with service
- Endpoint can be HTTP URL, systemd service, or Neon connection string
- Recovery actions are optional per service

---

## Checklist

Before implementation:
- [x] All acceptance criteria have mapped tests
- [x] Edge cases identified
- [x] Test file locations decided
- [x] Priority assigned to each test

After test creation:
- [ ] Tests are failing (RED phase)
- [ ] Test descriptions match behavior
- [ ] No trivial tests (DGTS compliant)
