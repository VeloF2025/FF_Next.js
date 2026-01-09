# Module: onboarding

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Multi-entity workflow management for contractors, suppliers, staff, and partners |
| **Status** | Active |
| **Complexity** | Medium |
| **Category** | admin |

## Dependencies

### Internal FF Modules
None

### External Packages
None defined

## Database

### Tables
- `onboarding_workflows` - Workflow state
- `onboarding_stages` - Individual steps
- `workflow_templates` - Predefined configurations

### Key Queries
- Get workflow by entity (contractor/supplier/staff)
- Get workflow progress and completion percentage
- Track completed stages and required documents

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| * | `/api/contractors-onboarding-complete.ts` | Complete onboarding |
| * | `/api/contractors-onboarding-stages.ts` | Get stages |
| * | `/api/contractors-onboarding-stages-update.ts` | Update stages |

## Services

### WorkflowTemplates
```typescript
getTemplateByName(templateName)
getTemplatesByEntityType(entityType)
getAllActiveTemplates()
```

## Components
None defined in module

## Hooks
None

## Supported Entity Types
- Contractor
- Supplier
- Staff
- Partner

## Patterns
- Predefined workflow templates (Basic, Express for contractors)
- Multi-stage approval flow with document requirements
- Role-based assignment (admin, compliance_officer, finance_officer, etc.)
- Progress tracking by percentage and stage completion

## Gotchas
- **Generic Module**: Works across 4 entity types - must specify entityType in requests
- **Stage Flags**: Optional vs required stages marked with isRequired flag
- **Estimated Duration**: Estimated durations provided but not enforced
- **Immutable Templates**: Templates are definitions (id, createdAt, updatedAt added at runtime)
