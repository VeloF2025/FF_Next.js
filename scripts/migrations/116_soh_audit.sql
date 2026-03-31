-- Migration 116: SOH Audit Module
-- Creates tables for version-stamped stock on hand audit imports

CREATE TABLE IF NOT EXISTS soh_audit_warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'warehouse', -- 'warehouse' | 'project' | 'dc'
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO soh_audit_warehouses (name, type, sort_order) VALUES
  ('Lawley', 'project', 1),
  ('Mohadin', 'project', 2),
  ('Mamelodi POP 1', 'project', 3),
  ('Etwatwa POP 2', 'project', 4),
  ('Thembisa POP 1', 'project', 5),
  ('Thembisa POP 2', 'project', 6),
  ('Thembisa POP 3', 'project', 7),
  ('Themb''elihle', 'project', 8),
  ('Tonga', 'project', 9),
  ('Garsfontein', 'dc', 10)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS soh_audit_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_label TEXT NOT NULL,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS soh_audit_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID NOT NULL REFERENCES soh_audit_versions(id) ON DELETE CASCADE,
  item_code TEXT,
  item_name TEXT NOT NULL,
  category TEXT,
  uom TEXT DEFAULT 'units',
  boq_rate NUMERIC DEFAULT 0,
  quantities JSONB NOT NULL DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_soh_audit_entries_version ON soh_audit_entries(version_id);

COMMENT ON TABLE soh_audit_warehouses IS 'Fixed + user-addable warehouse/project/DC locations for SOH audit';
COMMENT ON TABLE soh_audit_versions IS 'Version-stamped SOH audit imports (one per physical stock take)';
COMMENT ON TABLE soh_audit_entries IS 'Per-item quantities per audit version, keyed by warehouse name in JSONB';
