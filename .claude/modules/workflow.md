# Module: workflow

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Customizable workflow template management system with editor, project assignment, and analytics |
| **Status** | Active |
| **Complexity** | High |
| **Category** | core |

## Dependencies

### Internal FF Modules
None

### External Packages
- react-router-dom
- lucide-react
- react-dnd or similar (drag-drop)
- @tanstack/react-query

## Database

### Tables
None - mock implementation currently

### Key Queries
Mock implementation - no real database queries yet

## API Endpoints
None implemented

## Services

### WorkflowManagementService
```typescript
// Templates
loadTemplates(query)
createTemplate(template)
updateTemplate(id, template)
deleteTemplate(id)
duplicateTemplate(id, newName)

// Phases
loadPhases(templateId)
createPhase(phase)
updatePhase(id, phase)
deletePhase(id)

// Steps
loadSteps(phaseId)
createStep(step)
updateStep(id, step)
deleteStep(id)

// Tasks
loadTasks(stepId)
createTask(task)
updateTask(id, task)
deleteTask(id)

// Utilities
validateTemplate(templateId)
getAnalytics(dateRange)
exportTemplate(templateId)
importTemplate(data)
```

### WorkflowTemplateService
Template-specific operations

## Components (30+ total)

### Editor Components (8)
- WorkflowEditor - Main visual editor
- EditorCanvas - Drag-drop canvas
- EditorToolbar - Action buttons
- ComponentPalette - Draggable components
- WorkflowNode - Individual node
- NodeConnection - Node connections
- PropertiesPanel - Property editor
- ValidationPanel - Validation results

### Projects Components (7)
- ProjectWorkflowList - Assigned workflows
- ProjectWorkflowDetail - Single workflow view
- WorkflowProgress - Progress indicator
- WorkflowTimeline - Timeline view
- ExecutionLogs - Execution history
- WorkflowAnalytics - Project analytics
- WorkflowAssignmentModal - Project assignment

### Analytics Components (7)
- WorkflowCharts - Visual charts
- PerformanceMetrics - Performance dashboard
- TrendAnalysis - Trend visualization
- ComparisonTools - Template comparison
- ReportExporter - Export functionality
- LiveDashboard - Real-time dashboard

### Tab Components (4)
- TemplatesTab - Template management
- EditorTab - Visual editor
- ProjectsTab - Project assignments
- AnalyticsTab - Analytics dashboard

### Portal Components
- WorkflowPortalPage - Main portal container

### Analytics Sub-components (8)
- AnalyticsHeader, KeyMetricsGrid, MetricCard
- PhasePerformanceCard, BottlenecksCard, SuccessFactorsCard
- TemplateUsageChart, LoadingState, ErrorState

## Hooks
- `useWorkflowPortal()` - Portal context and state
- `useWorkflowAnalytics()` - Analytics data and calculations

## Workflow Hierarchy
```
Template
  └── Phase
       └── Step
            └── Task
```

## Patterns
- Context-based state management (WorkflowPortalContext, WorkflowEditorContext)
- Tab-based navigation (templates, editor, projects, analytics)
- Hierarchical structure (Template > Phase > Step > Task)
- Drag-drop ordering for phases, steps, and tasks
- Validation system for circular dependencies
- Mock data implementation (temporary)
- Template import/export capability

## Gotchas
- **MOCK DATA**: Currently using mock data - not connected to database
- **Temporary Service**: WorkflowManagementService is placeholder
- **No Tables**: No database tables defined - migrations pending
- **Mock Editor**: Editor uses mock data for demonstration
- **File Count**: 64 TypeScript files - significant complexity
- **Hierarchical Deps**: Phases depend on templates, steps on phases
- **Circular Detection**: Circular dependency detection needed in validation
- **Bulk Operations**: Bulk operations needed for reordering
- **Expensive Analytics**: Analytics calculations may need caching
- **Two Contexts**: Two context providers needed (Portal + Editor)
