# PRD-018: Dark Mode Styling (Comprehensive)

## Overview
Comprehensive dark mode styling fixes across ALL pages and modules in the FibreFlow application to ensure consistent theming.

## Reference Skill
**Use:** `.claude/skills/ff-dark-mode/skill.md` for conversion patterns and component examples.

## CSS Variable Mapping (Quick Reference)

| Light Mode (Old) | Dark Mode Compatible (New) |
|------------------|---------------------------|
| `bg-white` | `bg-[var(--ff-bg-secondary)]` or `bg-[var(--ff-surface-primary)]` |
| `bg-gray-50`, `bg-gray-100` | `bg-[var(--ff-bg-tertiary)]` |
| `text-gray-900/800/700` | `text-[var(--ff-text-primary)]` |
| `text-gray-600/500` | `text-[var(--ff-text-secondary)]` |
| `text-gray-400` | `text-[var(--ff-text-tertiary)]` |
| `border-gray-200/300` | `border-[var(--ff-border-light)]` |
| `divide-gray-200` | `divide-[var(--ff-border-light)]` |
| `hover:bg-gray-50` | `hover:bg-[var(--ff-bg-hover)]` |
| `bg-{color}-100 text-{color}-800` | `bg-{color}-500/20 text-{color}-400` |
| `text-red-600` (errors) | `text-red-400` |
| `text-green-600` (success) | `text-green-400` |

---

## Phase 1: Core Infrastructure (COMPLETED)

### CSS Variables
- [x] `styles/globals.css` - Add FF dark mode variables to `.dark` class
- [x] `styles/globals.css` - Add light mode aliases (`--ff-bg-*`, `--ff-border-light`)
- [x] `.claude/skills/ff-dark-mode/skill.md` - Create skill for reference

---

## Phase 2: Reference Pages (Already Correct)

These pages have CORRECT dark mode - use as reference patterns:

- [x] `src/modules/dashboard/Dashboard.tsx` - Main dashboard
- [x] `src/modules/ticketing/components/Dashboard/TicketingDashboard.tsx` - Ticketing
- [x] `pages/staff/index.tsx` - Staff listing

---

## Phase 3: Shared Components (Priority 1)

Fix these first as they affect multiple pages:

### Layout Components
- [ ] `src/components/layout/AppLayout.tsx`
- [ ] `src/components/layout/Sidebar.tsx`
- [ ] `src/components/layout/Topbar.tsx`
- [ ] `src/components/layout/Header.tsx`

### UI Components
- [ ] `src/shared/components/ui/Card.tsx`
- [ ] `src/shared/components/ui/Button.tsx`
- [ ] `src/shared/components/ui/Input.tsx`
- [ ] `src/shared/components/ui/Select.tsx`
- [ ] `src/shared/components/ui/Table.tsx`
- [ ] `src/shared/components/ui/Modal.tsx`
- [ ] `src/shared/components/ui/Badge.tsx`
- [ ] `src/shared/components/ui/Alert.tsx`

### Dashboard Components
- [ ] `src/components/dashboard/EnhancedStatCard.tsx`
- [ ] `src/components/dashboard/QuickActionCard.tsx`
- [ ] `src/components/dashboard/StatCard.tsx`
- [ ] `src/modules/dashboard/components/QuickActions.tsx`

---

## Phase 4: Core Pages (Pages Router)

### Dashboard & Home
- [ ] `pages/index.tsx` - Home/landing page
- [ ] `pages/dashboard/index.tsx` - Main dashboard

### Projects Module
- [ ] `pages/projects/index.tsx` - Projects list
- [ ] `pages/projects/[id]/index.tsx` - Project detail
- [ ] `pages/projects/[id]/edit.tsx` - Project edit
- [ ] `pages/projects/[id]/monitoring.tsx` - Project monitoring
- [ ] `pages/projects/[id]/sow.tsx` - Project SOW
- [ ] `pages/projects/[id]/workflow.tsx` - Project workflow
- [ ] `pages/projects/new.tsx` - New project
- [ ] `pages/projects/reports.tsx` - Project reports

### Clients Module
- [ ] `pages/clients/index.tsx` - Clients list
- [ ] `pages/clients/[id].tsx` - Client detail
- [ ] `pages/clients/new.tsx` - New client

### Staff Module
- [ ] `pages/staff/index.tsx` - Staff list (REFERENCE)
- [ ] `pages/staff/[id].tsx` - Staff detail
- [ ] `pages/staff/edit/[id].tsx` - Staff edit
- [ ] `pages/staff/import-export.tsx` - Staff import/export
- [ ] `pages/staff/new.tsx` - New staff

### Contractors/Onboarding
- [ ] `pages/contractors/index.tsx` - Contractors list
- [ ] `pages/contractors/[contractorId]/index.tsx` - Contractor detail
- [ ] `pages/contractors/[contractorId]/onboarding.tsx` - Contractor onboarding
- [ ] `pages/contractors/import-excel.tsx` - Import contractors
- [ ] `pages/contractors/new.tsx` - New contractor
- [ ] `pages/onboarding/index.tsx` - Onboarding hub

### Ticketing Module
- [ ] `pages/ticketing/index.tsx` - Ticketing dashboard (REFERENCE)
- [ ] `pages/ticketing/[ticketId]/edit.tsx` - Edit ticket
- [ ] `pages/ticketing/new.tsx` - New ticket

### SOW Module
- [ ] `pages/sow/index.tsx` - SOW list
- [ ] `pages/sow/drops/index.tsx` - Drops list
- [ ] `pages/sow/drops/[dropId].tsx` - Drop detail
- [ ] `pages/sow/fibre/index.tsx` - Fibre list
- [ ] `pages/sow/fibre/[fibreId].tsx` - Fibre detail
- [ ] `pages/sow/projects/[projectId].tsx` - SOW by project

### Procurement Module
- [ ] `pages/procurement/index.tsx` - Procurement hub
- [ ] `pages/procurement/assets.tsx` - Assets
- [ ] `pages/procurement/boq.tsx` - BOQ
- [ ] `pages/procurement/new-asset.tsx` - New asset
- [ ] `pages/procurement/new-rfq.tsx` - New RFQ
- [ ] `pages/procurement/rfq.tsx` - RFQ list
- [ ] `pages/procurement/suppliers.tsx` - Suppliers

### Workflow Module
- [ ] `pages/workflow/index.tsx` - Workflow hub
- [ ] `pages/workflow/[workflowId]/edit.tsx` - Edit workflow
- [ ] `pages/workflow/drops/[dropId].tsx` - Drop workflow
- [ ] `pages/workflow/new.tsx` - New workflow
- [ ] `pages/workflow/templates/index.tsx` - Templates

### Analytics & Reports
- [ ] `pages/analytics/index.tsx` - Analytics hub
- [ ] `pages/analytics/map.tsx` - Map analytics
- [ ] `pages/kpis.tsx` - KPIs page
- [ ] `pages/reports/index.tsx` - Reports hub
- [ ] `pages/reports/daily.tsx` - Daily reports
- [ ] `pages/reports/drops.tsx` - Drops report
- [ ] `pages/reports/weekly.tsx` - Weekly reports

### Monitoring
- [ ] `pages/wa-monitor/index.tsx` - WA Monitor
- [ ] `pages/wa-monitor/daily.tsx` - Daily monitoring
- [ ] `pages/foto-review/index.tsx` - Foto review

### Admin & Settings
- [ ] `pages/settings/index.tsx` - Settings
- [ ] `pages/admin/index.tsx` - Admin panel
- [ ] `pages/admin/firebase-storage.tsx` - Firebase storage admin

### Communication
- [ ] `pages/meetings/index.tsx` - Meetings hub
- [ ] `pages/meetings/[meetingId].tsx` - Meeting detail
- [ ] `pages/meetings/new.tsx` - New meeting
- [ ] `pages/communications/index.tsx` - Communications

### Misc Pages
- [ ] `pages/action-items.tsx` - Action items
- [ ] `pages/tasks/index.tsx` - Tasks
- [ ] `pages/map.tsx` - Map view
- [ ] `pages/rag/index.tsx` - RAG dashboard

---

## Phase 5: App Router Pages

### Main App Routes
- [ ] `app/(main)/page.tsx` - Main app home
- [ ] `app/(main)/projects/page.tsx` - Projects
- [ ] `app/(main)/projects/[id]/page.tsx` - Project detail
- [ ] `app/(main)/projects/new/page.tsx` - New project
- [ ] `app/(main)/clients/page.tsx` - Clients
- [ ] `app/(main)/clients/[id]/page.tsx` - Client detail
- [ ] `app/(main)/clients/new/page.tsx` - New client
- [ ] `app/(main)/admin/page.tsx` - Admin
- [ ] `app/(main)/dashboard/page.tsx` - Dashboard
- [ ] `app/(main)/dashboard/components/page.tsx` - Dashboard components
- [ ] `app/(main)/onboarding/page.tsx` - Onboarding
- [ ] `app/(main)/settings/page.tsx` - Settings
- [ ] `app/(main)/sow/page.tsx` - SOW
- [ ] `app/(main)/staff/page.tsx` - Staff

### Auth Routes
- [ ] `app/auth/login/page.tsx` - Login
- [ ] `app/auth/register/page.tsx` - Register
- [ ] `app/auth/forgot-password/page.tsx` - Forgot password

### Error Pages
- [ ] `app/not-found.tsx` - 404 page
- [ ] `app/error.tsx` - Error page

---

## Phase 6: Module Components

### Dashboard Module (`src/modules/dashboard/`)
- [ ] `components/Dashboard.tsx` (REFERENCE)
- [ ] `components/DashboardContent.tsx`
- [ ] `components/QuickActions.tsx`
- [ ] `components/AnalyticsChart.tsx`

### Projects Module (`src/modules/projects/`)
- [ ] `components/ProjectCard.tsx`
- [ ] `components/ProjectForm.tsx`
- [ ] `components/ProjectList.tsx`
- [ ] `components/ProjectDetails.tsx`

### Clients Module (`src/modules/clients/`)
- [ ] `components/ClientList.tsx`
- [ ] `components/ClientSummaryCards.tsx`
- [ ] `components/ClientTable.tsx`
- [ ] `components/ClientTableRow.tsx`
- [ ] `components/ClientForm.tsx`

### Staff Module (`src/modules/staff/`)
- [ ] `components/StaffAnalytics.tsx`
- [ ] `components/StaffDetail.tsx`
- [ ] `components/StaffFilters.tsx`
- [ ] `components/StaffForm.tsx`
- [ ] `components/StaffListHeader.tsx`
- [ ] `components/StaffImportAdvanced/StaffImportAdvanced.tsx`
- [ ] `components/StaffImportAdvanced/components/FileUploadArea.tsx`
- [ ] `components/StaffImportAdvanced/components/ImportProgress.tsx`
- [ ] `components/StaffImportAdvanced/components/ImportResults.tsx`
- [ ] `components/analytics/ContractTypes.tsx`
- [ ] `components/analytics/DepartmentDistribution.tsx`
- [ ] `components/analytics/ExperienceLevels.tsx`
- [ ] `components/analytics/SkillsOverview.tsx`
- [ ] `components/analytics/StaffKeyMetrics.tsx`
- [ ] `components/analytics/TopPerformersTable.tsx`
- [ ] `components/form-sections/AvailabilitySection.tsx`
- [ ] `components/form-sections/ContactSection.tsx`
- [ ] `components/form-sections/EmploymentSection.tsx`
- [ ] `components/form-sections/PersonalInfoSection.tsx`
- [ ] `components/form-sections/SkillsSection.tsx`

### Ticketing Module (`src/modules/ticketing/`)
- [ ] `components/Dashboard/TicketingDashboard.tsx` (REFERENCE)
- [ ] `components/TicketCard.tsx`
- [ ] `components/TicketForm.tsx`
- [ ] `components/TicketList.tsx`
- [ ] `components/TicketFilters.tsx`

### SOW Module (`src/modules/sow/`)
- [ ] `components/DropList.tsx`
- [ ] `components/DropDetail.tsx`
- [ ] `components/FibreList.tsx`
- [ ] `components/SOWTable.tsx`

### Workflow Module (`src/modules/workflow/`)
- [ ] `components/WorkflowBuilder.tsx`
- [ ] `components/WorkflowCard.tsx`
- [ ] `components/WorkflowSteps.tsx`
- [ ] `components/StageCard.tsx`

### Procurement Module (`src/modules/procurement/`)
- [ ] `components/AssetList.tsx`
- [ ] `components/RFQList.tsx`
- [ ] `components/BOQTable.tsx`
- [ ] `components/SupplierList.tsx`

### WA Monitor Module (`src/modules/wa-monitor/`)
- [ ] `components/Dashboard.tsx`
- [ ] `components/PhotoReviewCard.tsx`
- [ ] `components/ReviewList.tsx`
- [ ] `components/StatsCards.tsx`

### Foto Review Module (`src/modules/foto-review/`)
- [ ] `components/FotoReviewDashboard.tsx`
- [ ] `components/AIReviewCard.tsx`
- [ ] `components/ReviewTable.tsx`

### RAG Module (`src/modules/rag/`)
- [ ] `components/RAGDashboard.tsx`
- [ ] `components/ContractorHealthCard.tsx`
- [ ] `components/ComplianceTable.tsx`

### Analytics Module (`src/modules/analytics/`)
- [ ] `components/AnalyticsDashboard.tsx`
- [ ] `components/ChartCard.tsx`
- [ ] `components/MetricCard.tsx`
- [ ] `components/MapView.tsx`

### Onboarding Module (`src/modules/onboarding/`)
- [ ] `components/OnboardingWizard.tsx`
- [ ] `components/StageProgress.tsx`
- [ ] `components/DocumentUpload.tsx`

### Meetings Module (`src/modules/meetings/`)
- [ ] `components/MeetingList.tsx`
- [ ] `components/MeetingForm.tsx`
- [ ] `components/MeetingDetail.tsx`

### Admin Module (`src/modules/admin/`)
- [ ] `components/AdminDashboard.tsx`
- [ ] `components/UserManagement.tsx`
- [ ] `components/SystemSettings.tsx`

### Settings Module (`src/modules/settings/`)
- [ ] `components/SettingsPage.tsx`
- [ ] `components/ProfileSettings.tsx`
- [ ] `components/NotificationSettings.tsx`

---

## Phase 7: Additional Shared Components

### Common UI Elements
- [ ] `src/components/common/Breadcrumb.tsx`
- [ ] `src/components/common/EmptyState.tsx`
- [ ] `src/components/common/ErrorMessage.tsx`
- [ ] `src/components/common/LoadingSpinner.tsx`
- [ ] `src/components/common/Pagination.tsx`
- [ ] `src/components/common/SearchInput.tsx`
- [ ] `src/components/common/StatusBadge.tsx`
- [ ] `src/components/common/Tabs.tsx`
- [ ] `src/components/common/Tooltip.tsx`

### Form Components
- [ ] `src/components/forms/FormField.tsx`
- [ ] `src/components/forms/FormSelect.tsx`
- [ ] `src/components/forms/DatePicker.tsx`
- [ ] `src/components/forms/FileUpload.tsx`

### Table Components
- [ ] `src/components/tables/DataTable.tsx`
- [ ] `src/components/tables/TableHeader.tsx`
- [ ] `src/components/tables/TableFilters.tsx`
- [ ] `src/components/tables/TablePagination.tsx`

---

## Phase 8: Modal & Dialog Components

- [ ] `src/components/modals/ConfirmDialog.tsx`
- [ ] `src/components/modals/FormModal.tsx`
- [ ] `src/components/modals/ImagePreview.tsx`
- [ ] `src/components/modals/DeleteConfirmation.tsx`

---

## Phase 9: Final Sweep

### Third-party Component Wrappers
- [ ] Check shadcn/ui components for theme compatibility
- [ ] Check Lucide icon colors
- [ ] Check Recharts theming

### Review & Test
- [ ] Full dark mode toggle test on all pages
- [ ] Accessibility audit (contrast ratios)
- [ ] Browser compatibility check

---

## Testing Checklist

For each component/page:
1. [ ] Toggle dark mode
2. [ ] All text readable (good contrast)
3. [ ] All backgrounds change appropriately
4. [ ] Status badges visible in both modes
5. [ ] Form inputs properly styled
6. [ ] Hover states work correctly
7. [ ] No "flash" of wrong colors on page load

---

## Progress Tracking

| Phase | Total | Done | Remaining |
|-------|-------|------|-----------|
| Phase 1 - Infrastructure | 3 | 3 | 0 |
| Phase 2 - Reference | 3 | 3 | 0 |
| Phase 3 - Shared Components | 16 | 0 | 16 |
| Phase 4 - Core Pages | 55 | 0 | 55 |
| Phase 5 - App Router | 17 | 0 | 17 |
| Phase 6 - Module Components | 60+ | 0 | 60+ |
| Phase 7 - Additional Shared | 17 | 0 | 17 |
| Phase 8 - Modals | 4 | 0 | 4 |
| Phase 9 - Final | 3 | 0 | 3 |
| **TOTAL** | **178+** | **6** | **172+** |

---

## Original PR
- PR #18: https://github.com/VelocityFibre/FF_Next.js/pull/18
- 34 files changed, +570 additions, -574 deletions
