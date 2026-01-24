# Test Specification: Escalation Service

## Source

- **PRD/Spec**: `.claude/plans/sequential-growing-brook.md`
- **Date Created**: 2026-01-24
- **Author**: Claude (TDD Implementation)

---

## Overview

The Escalation Service handles alerting and human-in-the-loop (HITL) approval workflows. It sends notifications via WhatsApp for critical issues, manages the approval queue, and tracks escalation status.

---

## Feature Requirements

### FR-1: WhatsApp Alerts
- Send critical alerts to designated WhatsApp group/number
- Format messages with service name, status, issue details, suggested action
- Include approve/reject instructions in message
- Track message delivery status

### FR-2: Approval Queue Management
- Queue pending approvals in database
- Support approve/reject actions via API
- Auto-expire approvals after configurable time (default 1 hour)
- Track who approved/rejected and when

### FR-3: Escalation Levels
- **Level 1 (Info)**: Dashboard only, no notification
- **Level 2 (Warning)**: Dashboard + WhatsApp (non-critical down)
- **Level 3 (Critical)**: Dashboard + WhatsApp + Sound/Urgent (critical down)

### FR-4: Escalation Rules
- First failure: Level 1 (dashboard only)
- 3 consecutive failures: Level 2 (WhatsApp)
- Critical service down: Immediate Level 3
- 5+ failures or 10+ min down: Level 3

### FR-5: Alert Suppression
- Suppress duplicate alerts within 5 minutes
- Support maintenance windows (scheduled downtime)
- Manual "acknowledge" to suppress for 1 hour
- Rate limit: max 10 alerts per hour per service

---

## Unit Tests - WhatsApp Alerts

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| WA-001 | Send alert message | Critical incident | Message sent | HIGH |
| WA-002 | Message includes service name | VLM incident | "VLM" in message | HIGH |
| WA-003 | Message includes status | DOWN status | "DOWN" in message | HIGH |
| WA-004 | Message includes issue type | Connection timeout | "timeout" in message | HIGH |
| WA-005 | Message includes suggested action | Restart available | "Restart" suggested | HIGH |
| WA-006 | Message includes approve instruction | HITL action | "Reply 'approve'" | HIGH |
| WA-007 | Delivery status tracked | Message sent | Delivery confirmed | MEDIUM |
| WA-008 | Failed delivery logged | Send fails | Error logged | HIGH |
| WA-009 | Retry on failure | First fail | 3 retries attempted | HIGH |
| WA-010 | Uses correct group JID | Lawley project | Correct JID used | HIGH |

### Test File Location
`tests/unit/modules/system/whatsappAlerts.test.ts`

---

## Unit Tests - Approval Queue

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| AQ-001 | Create approval in queue | New action | Approval created | HIGH |
| AQ-002 | Approval includes action details | Action data | Details stored | HIGH |
| AQ-003 | Approval includes requester | Created by | Requester stored | MEDIUM |
| AQ-004 | Approve updates status | Approve called | status=approved | HIGH |
| AQ-005 | Reject updates status | Reject called | status=rejected | HIGH |
| AQ-006 | Approval triggers action | Approved | Action executed | HIGH |
| AQ-007 | Rejection logs reason | Reject with reason | Reason stored | MEDIUM |
| AQ-008 | Get pending approvals | Query | Pending list | HIGH |
| AQ-009 | Approver identity stored | User approves | User ID stored | HIGH |
| AQ-010 | Approval timestamp stored | Approved | Timestamp stored | HIGH |
| AQ-011 | Auto-expire after 1h | 1h elapsed | status=expired | HIGH |
| AQ-012 | Expired not executable | Expired approval | Cannot approve | HIGH |

### Test File Location
`tests/unit/modules/system/approvalQueue.test.ts`

---

## Unit Tests - Escalation Levels

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| EL-001 | Level 1 no notification | Info level | Dashboard only | HIGH |
| EL-002 | Level 2 sends WhatsApp | Warning level | WhatsApp sent | HIGH |
| EL-003 | Level 3 urgent WhatsApp | Critical level | Urgent message | HIGH |
| EL-004 | Level 3 includes urgency | Critical level | "CRITICAL" prefix | HIGH |
| EL-005 | First failure is Level 1 | 1st failure | Level 1 | HIGH |
| EL-006 | 3 failures is Level 2 | 3rd failure | Level 2 | HIGH |
| EL-007 | Critical service is Level 3 | Critical + down | Level 3 | HIGH |
| EL-008 | 5 failures is Level 3 | 5th failure | Level 3 | HIGH |
| EL-009 | 10 min down is Level 3 | 10 min elapsed | Level 3 | HIGH |
| EL-010 | Level calculated correctly | Complex scenario | Correct level | MEDIUM |

### Test File Location
`tests/unit/modules/system/escalationLevels.test.ts`

---

## Unit Tests - Alert Suppression

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| AS-001 | Suppress duplicate in 5 min | Same alert 2x | 1 sent | HIGH |
| AS-002 | Allow after 5 min | Same alert after 6 min | Both sent | HIGH |
| AS-003 | Maintenance window suppresses | In window | No alert | HIGH |
| AS-004 | After maintenance window sends | After window | Alert sent | HIGH |
| AS-005 | Acknowledge suppresses 1h | Acknowledged | No alerts 1h | HIGH |
| AS-006 | After acknowledge sends | 1h+ elapsed | Alert sent | HIGH |
| AS-007 | Rate limit 10/hour | 11 alerts | 11th blocked | HIGH |
| AS-008 | Rate limit resets hourly | New hour | Alerts allowed | MEDIUM |
| AS-009 | Different services not deduped | VLM + WA | Both sent | HIGH |
| AS-010 | Critical bypasses rate limit | Critical + limited | Alert sent | HIGH |

### Test File Location
`tests/unit/modules/system/alertSuppression.test.ts`

---

## Integration Tests

| ID | Description | Components Involved | Expected Behavior | Priority |
|----|-------------|---------------------|-------------------|----------|
| IT-001 | Full escalation flow | Incident → Alert → Approve | Action executed | HIGH |
| IT-002 | WhatsApp delivery e2e | Alert → WA Service | Message delivered | HIGH |
| IT-003 | Approval via API | POST /approve | Approval processed | HIGH |
| IT-004 | Rejection via API | POST /reject | Rejection logged | HIGH |
| IT-005 | Maintenance window blocks | Window active | No alerts | MEDIUM |
| IT-006 | Auto-expire cleans up | 1h elapsed | Expired status | MEDIUM |
| IT-007 | Rate limiting works | 11 alerts | 11th blocked | MEDIUM |
| IT-008 | Dashboard shows pending | Pending exists | Shown in UI | HIGH |

### Test File Location
`tests/integration/api/system/escalation.test.ts`

---

## Acceptance Criteria Mapping

- [x] **AC1**: Send WhatsApp alerts → `WA-001` - `WA-010`
- [x] **AC2**: Manage approval queue → `AQ-001` - `AQ-012`
- [x] **AC3**: Three escalation levels → `EL-001` - `EL-010`
- [x] **AC4**: Escalation rules based on severity → `EL-005` - `EL-009`
- [x] **AC5**: Suppress duplicates → `AS-001`, `AS-002`
- [x] **AC6**: Maintenance windows → `AS-003`, `AS-004`
- [x] **AC7**: Rate limiting → `AS-007`, `AS-008`
- [x] **AC8**: Auto-expire approvals → `AQ-011`, `AQ-012`

---

## Message Templates

```typescript
// Level 2 (Warning)
const warningTemplate = `
⚠️ INFRASTRUCTURE WARNING

Service: {{serviceName}}
Status: {{status}}
Issue: {{issueType}}
Duration: {{duration}}

Suggested Action: {{suggestedAction}}
Risk Level: {{riskLevel}}

Reply "approve {{approvalId}}" to execute
Reply "reject {{approvalId}}" to dismiss
`;

// Level 3 (Critical)
const criticalTemplate = `
🚨 CRITICAL INFRASTRUCTURE ALERT 🚨

Service: {{serviceName}}
Status: {{status}} ({{failureCount}} consecutive failures)
Issue: {{issueType}}
First Detected: {{firstDetected}}

Attempted Fixes:
{{#each attempts}}
{{@index}}. {{status}} {{actionName}} → {{result}}
{{/each}}

Suggested Action: {{suggestedAction}}
Risk Level: {{riskLevel}}

⚡ Reply "approve {{approvalId}}" to execute NOW
❌ Reply "reject {{approvalId}}" to dismiss
`;
```

---

## API Endpoints

```typescript
// POST /api/system/approve-recovery
interface ApproveRequest {
  approvalId: string;
  action: 'approve' | 'reject';
  notes?: string;
}

// GET /api/system/pending-approvals
interface PendingApprovalsResponse {
  approvals: PendingApproval[];
  count: number;
}

// POST /api/system/acknowledge-alert
interface AcknowledgeRequest {
  serviceId: string;
  duration?: number; // minutes, default 60
}

// POST /api/system/maintenance-window
interface MaintenanceWindowRequest {
  serviceId?: string; // null = all services
  startTime: string;
  endTime: string;
  reason: string;
}
```

---

## Notes

- Use WA Feedback service (port 8092) which proxies to VPS sender
- Message parsing for "approve XXX" should be in WA Bridge
- Store approval history for audit trail
- Consider webhook for external alerting systems (PagerDuty, OpsGenie)
- Rate limit per service, not globally

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
