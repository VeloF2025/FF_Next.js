-- Migration 255: Conduit Prerequisites & Milestones
-- Creates:
--   conduit_milestone_items  — template items (seeded once, shared across all projects)
--   conduit_milestones       — per-project milestone rows (one per item per project)
--   conduit_selectlists      — dropdown values for Responsible and Status columns
--
-- Run: psql $DATABASE_URL -f scripts/migrations/sql/255_conduit_milestones.sql

-- ── Template items ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conduit_milestone_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase       TEXT NOT NULL,
  item_name   TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Per-project milestone rows ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conduit_milestones (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES conduit_projects(id) ON DELETE CASCADE,
  milestone_item_id     UUID NOT NULL REFERENCES conduit_milestone_items(id) ON DELETE CASCADE,
  responsible           TEXT,
  velocity_responsible  TEXT,
  fibertime_responsible TEXT,
  planned_date          DATE,
  due_date              DATE,
  actual_date           DATE,
  status                TEXT,
  comment               TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, milestone_item_id)
);

CREATE INDEX IF NOT EXISTS idx_conduit_milestones_project ON conduit_milestones (project_id);

-- ── Select lists ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conduit_selectlists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_name   TEXT NOT NULL,
  value       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (list_name, value)
);

CREATE INDEX IF NOT EXISTS idx_conduit_selectlists_name ON conduit_selectlists (list_name);

-- ── Seed: template milestone items ────────────────────────────────────────────

INSERT INTO conduit_milestone_items (phase, item_name, sort_order) VALUES
  -- Site Assignments
  ('Site Assignments',        'PM Assigned',                          10),
  ('Site Assignments',        'Foreman Assigned',                     20),
  ('Site Assignments',        'Site Agent Assigned',                  30),

  -- Prerequisites
  ('Prerequisites',           'Wayleave Application Submitted',       10),
  ('Prerequisites',           'Wayleave Approved',                    20),
  ('Prerequisites',           'Council Permit Obtained',              30),
  ('Prerequisites',           'Environmental Clearance',              40),
  ('Prerequisites',           'Power Utility Sign-off',               50),

  -- Site Establishment
  ('Site Establishment',      'Site Handover Received',               10),
  ('Site Establishment',      'Compound Setup',                       20),
  ('Site Establishment',      'Equipment Delivered',                  30),
  ('Site Establishment',      'Safety Files Submitted',               40),

  -- Contractor Engagements
  ('Contractor Engagements',  'Civils Contractor Confirmed',          10),
  ('Contractor Engagements',  'Fibre Contractor Confirmed',           20),
  ('Contractor Engagements',  'Splicing Contractor Confirmed',        30),
  ('Contractor Engagements',  'Activation Contractor Confirmed',      40),

  -- Key Milestones
  ('Key Milestones',          'First Pole Planted',                   10),
  ('Key Milestones',          'Stringing Complete',                   20),
  ('Key Milestones',          'Optical Testing Complete',             30),
  ('Key Milestones',          'First Activation',                     40),
  ('Key Milestones',          'Handover to Operations',               50)
ON CONFLICT DO NOTHING;

-- ── Seed: default select list values ─────────────────────────────────────────

INSERT INTO conduit_selectlists (list_name, value, sort_order) VALUES
  -- Responsible
  ('Responsible', 'Velocity',    10),
  ('Responsible', 'FiberTime',   20),
  ('Responsible', 'Joint',       30),
  ('Responsible', 'Client',      40),
  ('Responsible', 'Contractor',  50),

  -- Status
  ('Status', 'Not Started',  10),
  ('Status', 'In Progress',  20),
  ('Status', 'Completed',    30),
  ('Status', 'Blocked',      40),
  ('Status', 'N/A',          50)
ON CONFLICT DO NOTHING;
