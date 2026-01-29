# Procurement Settings Tab - Implementation Plan

## Overview
Add a "Procurement" tab to the existing Settings page (`/settings`) that provides visual management of approval workflows, number sequences, default terms, and notification preferences for the procurement module.

## Problem
- Approval levels reference roles (`procurement_manager`, `director`) that don't exist in the users table
- No UI to configure approval thresholds, assign specific users as approvers, or manage procurement settings
- All PRs under R10,000 auto-approve but there's no way to change this threshold
- No way to configure number sequences, default terms, or notification preferences

## Implementation Steps

### Step 1: Database Migration (143_procurement_settings.sql)
Create 3 new tables:

**`procurement_sequences`** - Number sequence configuration
- `id`, `entity_type` (PR/PO/RFQ/GRN), `prefix` (e.g. "PR26-"), `next_number`, `padding` (5 digits), `reset_period` (yearly/monthly/never)

**`procurement_settings`** - Key-value settings store
- `id`, `setting_key`, `setting_value` (JSONB), `category` (general/terms/workflow)
- Seed with defaults: payment_terms (30 days), delivery_terms, currency (ZAR), tax_rate (15%)

**`procurement_notifications`** - Notification preferences
- `id`, `event_type` (pr_submitted/po_approved/grn_received/etc.), `enabled`, `channels` (JSONB: email/in_app/whatsapp), `recipients` (JSONB: roles/user_ids)

Also: Update `approval_levels` to support `approver_user_id` (UUID FK to users) alongside existing `approver_type`/`approver_role`.

### Step 2: API Endpoints

**`pages/api/settings/procurement/workflows.ts`** - GET/PUT approval workflows + levels
- GET: Return all workflows with their levels, include user names for assigned approvers
- PUT: Update workflow settings (enable/disable, escalation hours, levels)

**`pages/api/settings/procurement/sequences.ts`** - GET/PUT number sequences
- GET: Return all sequence configs with current next_number
- PUT: Update prefix, padding, reset_period

**`pages/api/settings/procurement/terms.ts`** - GET/PUT default terms
- GET: Return all procurement_settings where category = 'terms' or 'general'
- PUT: Update setting values

**`pages/api/settings/procurement/notifications.ts`** - GET/PUT notification config
- GET: Return all notification preferences
- PUT: Update enabled/channels/recipients per event type

### Step 3: UI Components

**`src/components/settings/ProcurementSettingsTab.tsx`** (~200 lines)
- Main container with 4 collapsible sections
- Each section uses consistent card styling with dark mode CSS variables

**`src/components/settings/procurement/ApprovalWorkflowsSection.tsx`** (~250 lines)
- Visual workflow diagram showing approval levels as a flow
- For each workflow (PR, PO): show levels with amount ranges, approver info
- Edit mode: adjust thresholds, assign users/roles, add/remove levels
- Visual indicator showing current coverage (gaps in amount ranges)
- Stats cards: total workflows, active levels, pending approvals count

**`src/components/settings/procurement/NumberSequencesSection.tsx`** (~150 lines)
- Table showing each entity type, current prefix, next number, reset period
- Inline edit for prefix and padding
- Preview of next generated number

**`src/components/settings/procurement/DefaultTermsSection.tsx`** (~150 lines)
- Form fields for: payment terms (Net 30/60/90), delivery terms, currency, tax rate
- Dropdown selects for standard options

**`src/components/settings/procurement/NotificationsSection.tsx`** (~150 lines)
- Table of event types with toggle switches for enabled/disabled
- Channel checkboxes (email, in-app, WhatsApp)
- Recipient configuration (roles or specific users)

### Step 4: Settings Page Integration

**Modify `src/pages/Settings.tsx`**:
- Add `'procurement'` to `SettingsTab` type union
- Add tab entry: `{ id: 'procurement', label: 'Procurement', icon: ShoppingCart }`
- Add lazy-loaded component rendering for procurement tab
- Position after "Workflow Management" tab

### Step 5: Fix Approval Level User Assignment

**Update `src/services/procurement/approval/poApprovalService.ts`**:
- Check `approver_user_id` first, then fall back to role-based matching
- This allows specific users to be assigned as approvers via the new settings UI

**Update `pages/api/procurement/approvals/pending.ts`**:
- Filter by current user: check if user matches `approver_user_id` OR user's role matches `approver_role`

## Files to Create
1. `scripts/migrations/143_procurement_settings.sql`
2. `scripts/migrations/run-migration-143.js`
3. `pages/api/settings/procurement/workflows.ts`
4. `pages/api/settings/procurement/sequences.ts`
5. `pages/api/settings/procurement/terms.ts`
6. `pages/api/settings/procurement/notifications.ts`
7. `src/components/settings/ProcurementSettingsTab.tsx`
8. `src/components/settings/procurement/ApprovalWorkflowsSection.tsx`
9. `src/components/settings/procurement/NumberSequencesSection.tsx`
10. `src/components/settings/procurement/DefaultTermsSection.tsx`
11. `src/components/settings/procurement/NotificationsSection.tsx`

## Files to Modify
1. `src/pages/Settings.tsx` - Add procurement tab
2. `src/services/procurement/approval/poApprovalService.ts` - Support user-based approval
3. `pages/api/procurement/approvals/pending.ts` - Filter by user/role
4. `scripts/migrations/052_approval_workflows.sql` - Reference only (existing schema)

## Architectural Notes
- All API routes use `withAuth(withRole('admin'))` since these are admin settings
- Use `apiResponse` pattern from `@/lib/apiResponse`
- Use `log` from `@/lib/logger` (no console.log)
- CSS variables for dark mode: `--ff-bg-primary`, `--ff-bg-secondary`, `--ff-text-primary`, `--ff-border-light`
- Standard AppLayout wrapping (inherited from Settings page)
