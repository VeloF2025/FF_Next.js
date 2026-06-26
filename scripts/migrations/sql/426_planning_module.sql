-- Migration: 426_planning_module.sql
-- Description: Planning module — NOC-style Kanban for planning work-items (6 stages)
-- Created: 2026-06-25
-- Note: relocated from scripts/migrations/247_planning_module.sql (parent dir) and
-- renumbered to 426 — the canonical runner (scripts/run-pending-migrations.sh) only
-- scans scripts/migrations/sql/*.sql, and 247 already exists there
-- (247_rbac_update_all_modules.sql). All DDL is IF NOT EXISTS, so this is a safe
-- no-op where the tables were already created manually (dev/shared DB).

-- ============================================================================
-- 1. ATOMIC UID SEQUENCE (mirrors maintenance_ticket_sequences)
-- ============================================================================
CREATE TABLE IF NOT EXISTS planning_item_sequences (
  sequence_date DATE PRIMARY KEY,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 2. PLANNING ITEMS
-- ============================================================================
CREATE TABLE IF NOT EXISTS planning_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_uid VARCHAR(32) UNIQUE NOT NULL,

  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  scope_area VARCHAR(255),

  stage VARCHAR(32) NOT NULL DEFAULT 'intake'
    CHECK (stage IN ('intake','hld','lld','splice','change_control','as_built','on_hold','cancelled')),
  assigned_to UUID REFERENCES staff(id) ON DELETE SET NULL,
  priority VARCHAR(16) NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  source VARCHAR(32) NOT NULL DEFAULT 'manual'
    CHECK (source IN ('pipeline_auto','manual')),

  stage_checklists JSONB NOT NULL DEFAULT '{}'::jsonb,

  pipeline_project_id UUID,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  closed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_planning_items_project ON planning_items(project_id);
CREATE INDEX IF NOT EXISTS idx_planning_items_stage ON planning_items(stage);
CREATE INDEX IF NOT EXISTS idx_planning_items_assigned ON planning_items(assigned_to);
-- One auto-created card per pipeline project (idempotent handoff in Task 11)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_planning_items_pipeline_auto
  ON planning_items(pipeline_project_id)
  WHERE pipeline_project_id IS NOT NULL AND source = 'pipeline_auto';

-- ============================================================================
-- 3. PLANNING ACTIVITIES (audit trail)
-- ============================================================================
CREATE TABLE IF NOT EXISTS planning_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planning_item_id UUID NOT NULL REFERENCES planning_items(id) ON DELETE CASCADE,
  activity_type VARCHAR(32) NOT NULL, -- created | stage_change | assignment | checklist | note | cancelled | update
  field_changed VARCHAR(64),
  old_value TEXT,
  new_value TEXT,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX IF NOT EXISTS idx_planning_activities_item ON planning_activities(planning_item_id);
