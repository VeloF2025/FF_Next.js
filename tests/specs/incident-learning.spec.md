# Test Specification: Incident Learning

## Source

- **PRD/Spec**: `.claude/plans/sequential-growing-brook.md`
- **Date Created**: 2026-01-24
- **Author**: Claude (TDD Implementation)

---

## Overview

The Incident Learning Service accumulates knowledge from recovery attempts. It tracks success/failure rates, automatically adjusts action risk classifications, respects human overrides, and exports learnings to knowledge base files for permanence.

---

## Feature Requirements

### FR-1: Success/Failure Tracking
- Track success count per recovery action
- Track failure count per recovery action
- Calculate success rate (success / (success + failure))
- Track time-to-resolution per incident

### FR-2: Auto-Classification Adjustment
- If safe action succeeds 5+ consecutive times → stays safe
- If safe action fails 3+ consecutive times → promote to moderate
- If moderate action succeeds 10+ times without issue → demote to safe
- Dangerous actions never auto-adjust (always require HITL)

### FR-3: Human Override Learning
- Track when humans override auto-fix decisions
- If human approves action 5+ times → suggest demotion
- If human rejects action 3+ times → suggest promotion
- Store override reasons for context

### FR-4: Knowledge Base Export
- Export incident summaries to `.claude/knowledge-base/incidents/`
- One file per incident with full context
- Include: service, issue, actions tried, resolution, duration, learnings
- Index file for quick reference

### FR-5: Statistics & Reporting
- Overall success rate across all actions
- Per-service success rate
- Mean time to resolution (MTTR)
- Most common failure types
- Actions with improving/declining success

---

## Unit Tests - Success/Failure Tracking

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| SF-001 | Track successful action | Action succeeds | successCount++ | HIGH |
| SF-002 | Track failed action | Action fails | failureCount++ | HIGH |
| SF-003 | Calculate success rate | 8/10 success | 80% rate | HIGH |
| SF-004 | Zero attempts = N/A | 0 attempts | rate=null | HIGH |
| SF-005 | 100% success rate | 10/10 | 100% rate | HIGH |
| SF-006 | 0% success rate | 0/10 | 0% rate | HIGH |
| SF-007 | Track resolution time | Incident resolved | duration stored | HIGH |
| SF-008 | Resolution time in seconds | 45s resolution | duration=45 | MEDIUM |
| SF-009 | Track attempts per incident | 3 attempts | attemptCount=3 | HIGH |
| SF-010 | Track final resolution method | 2nd action works | resolvedBy stored | MEDIUM |

### Test File Location
`tests/unit/modules/system/successTracking.test.ts`

---

## Unit Tests - Auto-Classification Adjustment

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| AC-001 | Safe stays safe after 5 success | 5 consecutive | riskLevel=safe | HIGH |
| AC-002 | Safe promotes after 3 failures | 3 consecutive fails | riskLevel=moderate | HIGH |
| AC-003 | Moderate demotes after 10 success | 10 consecutive | riskLevel=safe | HIGH |
| AC-004 | Dangerous never auto-demotes | 100 success | riskLevel=dangerous | HIGH |
| AC-005 | Mixed results don't trigger | 2 success, 1 fail | No change | HIGH |
| AC-006 | Consecutive resets on opposite | 2 fail, 1 success | Counter reset | HIGH |
| AC-007 | Promotion logged | Promoted | Event logged | MEDIUM |
| AC-008 | Demotion logged | Demoted | Event logged | MEDIUM |
| AC-009 | No change if disabled | autoAdjust=false | No change | MEDIUM |
| AC-010 | Thresholds configurable | Custom threshold | Uses custom | LOW |

### Test File Location
`tests/unit/modules/system/autoClassification.test.ts`

---

## Unit Tests - Human Override Learning

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| HO-001 | Track human approval | Human approves | Override recorded | HIGH |
| HO-002 | Track human rejection | Human rejects | Override recorded | HIGH |
| HO-003 | Store override reason | Reason provided | Reason stored | HIGH |
| HO-004 | Suggest demotion after 5 approvals | 5 approvals | Suggestion created | HIGH |
| HO-005 | Suggest promotion after 3 rejections | 3 rejections | Suggestion created | HIGH |
| HO-006 | Track overrider identity | User overrides | User ID stored | MEDIUM |
| HO-007 | Override reason optional | No reason | Still recorded | MEDIUM |
| HO-008 | Suggestions don't auto-apply | Suggestion | Requires confirm | HIGH |
| HO-009 | Confirmed suggestion applied | Admin confirms | Risk level changed | HIGH |
| HO-010 | Dismissed suggestion logged | Admin dismisses | Dismissal logged | MEDIUM |

### Test File Location
`tests/unit/modules/system/humanOverride.test.ts`

---

## Unit Tests - Knowledge Base Export

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| KB-001 | Create incident file | Incident resolved | .md file created | HIGH |
| KB-002 | File includes service name | VLM incident | "VLM" in file | HIGH |
| KB-003 | File includes issue type | Connection timeout | "timeout" in file | HIGH |
| KB-004 | File includes actions tried | 2 actions | Both in file | HIGH |
| KB-005 | File includes resolution | Restart worked | Resolution in file | HIGH |
| KB-006 | File includes duration | 45s resolution | "45s" in file | HIGH |
| KB-007 | File includes learnings | Insights | Learnings section | MEDIUM |
| KB-008 | Index file updated | New incident | Index has entry | HIGH |
| KB-009 | Filename uses date | Jan 24 | 2026-01-24 prefix | MEDIUM |
| KB-010 | Filename uses incident ID | ID=abc123 | abc123 in name | MEDIUM |
| KB-011 | Directory created if missing | First incident | Dir created | MEDIUM |

### Test File Location
`tests/unit/modules/system/kbExport.test.ts`

---

## Unit Tests - Statistics

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| ST-001 | Calculate overall success rate | All actions | Aggregate rate | HIGH |
| ST-002 | Calculate per-service rate | Service ID | Service rate | HIGH |
| ST-003 | Calculate MTTR | All incidents | Avg time | HIGH |
| ST-004 | Identify common failures | All incidents | Top 5 types | HIGH |
| ST-005 | Identify improving actions | Trend data | Improving list | MEDIUM |
| ST-006 | Identify declining actions | Trend data | Declining list | MEDIUM |
| ST-007 | Handle zero data | No incidents | Safe defaults | MEDIUM |
| ST-008 | Time range filter | Last 7 days | Filtered stats | HIGH |
| ST-009 | Compare time periods | Week vs week | Delta calculated | LOW |
| ST-010 | Export stats as JSON | Stats request | JSON response | MEDIUM |

### Test File Location
`tests/unit/modules/system/statistics.test.ts`

---

## Integration Tests

| ID | Description | Components Involved | Expected Behavior | Priority |
|----|-------------|---------------------|-------------------|----------|
| IT-001 | Track full incident lifecycle | Incident → Actions → Resolve | All tracked | HIGH |
| IT-002 | Auto-promote after failures | 3 failures | Risk level changed | HIGH |
| IT-003 | Human override recorded | HITL action | Override in DB | HIGH |
| IT-004 | KB file created on resolve | Incident resolved | File exists | HIGH |
| IT-005 | Stats endpoint returns data | GET /stats | JSON response | HIGH |
| IT-006 | Suggestions created | Threshold met | Suggestion in queue | MEDIUM |
| IT-007 | Index file accurate | Multiple incidents | All indexed | MEDIUM |
| IT-008 | Historical data preserved | Old incidents | Still queryable | MEDIUM |

### Test File Location
`tests/integration/api/system/learning.test.ts`

---

## Acceptance Criteria Mapping

- [x] **AC1**: Track success/failure per action → `SF-001` - `SF-010`
- [x] **AC2**: Auto-adjust risk classification → `AC-001` - `AC-010`
- [x] **AC3**: Respect human overrides → `HO-001` - `HO-010`
- [x] **AC4**: Export to knowledge base → `KB-001` - `KB-011`
- [x] **AC5**: Calculate statistics → `ST-001` - `ST-010`
- [x] **AC6**: MTTR tracking → `ST-003`
- [x] **AC7**: Identify trends → `ST-005`, `ST-006`

---

## Database Schema

```sql
-- Add to recovery_actions table
ALTER TABLE recovery_actions ADD COLUMN consecutive_success INT DEFAULT 0;
ALTER TABLE recovery_actions ADD COLUMN consecutive_failure INT DEFAULT 0;
ALTER TABLE recovery_actions ADD COLUMN auto_adjust_enabled BOOLEAN DEFAULT true;

-- Human overrides table
CREATE TABLE recovery_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID REFERENCES recovery_actions(id),
  incident_id UUID REFERENCES infrastructure_incidents(id),
  override_type VARCHAR(20) NOT NULL CHECK (override_type IN ('approve', 'reject')),
  overrider_id UUID REFERENCES users(id),
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Suggestions table
CREATE TABLE classification_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID REFERENCES recovery_actions(id),
  current_level VARCHAR(20) NOT NULL,
  suggested_level VARCHAR(20) NOT NULL,
  reason TEXT NOT NULL,
  override_count INT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'dismissed')),
  decided_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  decided_at TIMESTAMP
);

CREATE INDEX idx_overrides_action ON recovery_overrides(action_id);
CREATE INDEX idx_suggestions_pending ON classification_suggestions(status) WHERE status = 'pending';
```

---

## KB File Format

```markdown
# Incident: {{incidentId}}

**Date:** {{date}}
**Service:** {{serviceName}}
**Issue Type:** {{issueType}}
**Duration:** {{duration}}

## Timeline

| Time | Event |
|------|-------|
| {{startTime}} | Issue detected |
{{#each actions}}
| {{time}} | {{actionName}} - {{result}} |
{{/each}}
| {{endTime}} | Resolved |

## Actions Attempted

1. **{{action1Name}}** ({{risk1}}) - {{result1}}
2. **{{action2Name}}** ({{risk2}}) - {{result2}}

## Resolution

**Resolved by:** {{resolutionMethod}}
**Human intervention:** {{humanIntervention ? 'Yes' : 'No'}}

## Learnings

- {{learning1}}
- {{learning2}}

## Related Incidents

- {{#each related}}
  - [{{id}}](./{{filename}}) - Similar issue on {{date}}
{{/each}}
```

---

## Notes

- KB files serve as permanent record even if DB is wiped
- Consider using git to version KB files
- Learning adjustments should be gradual, not abrupt
- Human overrides are golden - never ignore them
- Statistics should be cached with 5-minute TTL for dashboard

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
