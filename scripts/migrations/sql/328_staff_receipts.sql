-- Migration 328: staff_receipts table + RBAC seed (PRD-040 receipts feature)
--
-- Field staff capture receipts/slips on the /my PWA (coffee, tools, parking,
-- tolls, fuel for personal vehicles, etc.). Image saved to VF Storage,
-- structured fields extracted by Qwen3 VLM, raw OCR retained for the
-- detail view + future re-extraction. Phase 1 lands capture+storage+
-- staff list; Phase 2 adds finance review queue.
--
-- POPIA: receipt images contain personal financial data + GPS — staff sees
-- only their own (queries.ts enforces staff_id scope); finance reviewers
-- gated by `receipts.review` permission.

-- =============================================================================
-- STEP 1: staff_receipts table
-- =============================================================================

CREATE TABLE IF NOT EXISTS staff_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,

  -- Header fields, mostly populated by VLM extraction then edited by staff.
  receipt_date DATE NOT NULL,
  vendor TEXT,
  total_cents BIGINT NOT NULL CHECK (total_cents >= 0),
  vat_cents BIGINT,                                   -- nullable; not all slips show VAT
  currency CHAR(3) NOT NULL DEFAULT 'ZAR',

  -- Closed taxonomy validated against RECEIPT_CATEGORIES in
  -- src/modules/receipts/categories.ts. Stored as TEXT (not enum) so
  -- adding categories is a code change, not a migration.
  category TEXT NOT NULL,

  -- Free-text sub-note: "lunch with client X", "spare 25mm bit set", etc.
  description TEXT,

  payment_method TEXT NOT NULL
    CHECK (payment_method IN ('company_card', 'personal_reimbursement')),

  -- Optional links. project_id auto-filled if staff picked one;
  -- vehicle_assignment_id auto-filled at save-time when staff has an
  -- active assignment, so trip-receipts get tied to the vehicle without
  -- friction (a contractor's bakkie fuelling counts as "personal").
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  vehicle_assignment_id UUID REFERENCES vehicle_assignments(id) ON DELETE SET NULL,

  -- VF Storage path of the captured image/PDF
  -- (staff/receipts/<staffId>/<receiptUuid>.<ext>)
  image_url TEXT NOT NULL,
  image_mime TEXT NOT NULL,

  -- Where the receipt was captured. Presence proof + later geo-search.
  captured_lat NUMERIC(9,6),
  captured_lon NUMERIC(9,6),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Raw VLM response (line items, etc.) for the detail view + future
  -- re-extraction without re-uploading. ocr_category_guess is what the
  -- VLM picked from the closed set BEFORE staff overrode (if they did).
  ocr_raw JSONB,
  ocr_category_guess TEXT,
  ocr_confidence NUMERIC(3,2),

  -- Lifecycle. Phase 1 only writes 'submitted'; Phase 2 review queue
  -- transitions to approved/rejected/reconciled.
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'approved', 'rejected', 'reconciled')),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Staff own-list query: most recent first, exclude rejected.
CREATE INDEX IF NOT EXISTS idx_staff_receipts_staff_recent
  ON staff_receipts (staff_id, receipt_date DESC)
  WHERE status != 'rejected';

-- Finance review queue: oldest pending first.
CREATE INDEX IF NOT EXISTS idx_staff_receipts_status_review
  ON staff_receipts (status, created_at DESC)
  WHERE status = 'submitted';

-- Project P&L roll-ups: receipts attributed to a project.
CREATE INDEX IF NOT EXISTS idx_staff_receipts_project
  ON staff_receipts (project_id, receipt_date DESC)
  WHERE project_id IS NOT NULL;

COMMENT ON TABLE staff_receipts IS
  'PRD-040 receipts feature: field-staff captured slips/receipts with VLM-extracted fields. POPIA-restricted.';
COMMENT ON COLUMN staff_receipts.ocr_category_guess IS
  'Closed-taxonomy category the VLM picked from line items + vendor name. Persisted alongside category (staff override) so we can measure VLM accuracy over time.';
COMMENT ON COLUMN staff_receipts.image_url IS
  'VF Storage relative path: /storage/staff/receipts/<staffId>/<uuid>.<ext>. Server-proxy download endpoint resolves to internal URL.';

-- ---------------------------------------------------------------------------
-- GRANTs — app runs as fibreflow_user (migration 310 pattern).
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, REFERENCES
  ON staff_receipts TO fibreflow_user;

-- =============================================================================
-- STEP 2: RBAC — receipts module + receipts.review page (Phase 2 admin queue)
-- =============================================================================

INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order, is_active)
VALUES
  ('module', 'receipts', NULL,
   'Receipts',
   'Field-staff receipt scanning + finance review queue.',
   NULL, 18, true),

  ('page', 'receipts.review', 'receipts',
   'Review Receipts',
   'Approve / reject / reconcile staff-submitted receipts.',
   '/staff/receipts', 1, true)

ON CONFLICT (key) DO NOTHING;

-- HR-style access. super_admin + admin can review; manager too because
-- they sign off on team expenses. Other roles explicitly denied.
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
  ('super_admin',     'receipts',         '{"view":true,"create":true,"edit":true,"delete":true}'),
  ('admin',           'receipts',         '{"view":true,"create":true,"edit":true,"delete":true}'),
  ('manager',         'receipts',         '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('technician',      'receipts',         '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('viewer',          'receipts',         '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('contractor',      'receipts',         '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('storeman',        'receipts',         '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('project_manager', 'receipts',         '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('qa_manager',      'receipts',         '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('site_supervisor', 'receipts',         '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('client',          'receipts',         '{"view":false,"create":false,"edit":false,"delete":false}'),

  ('super_admin',     'receipts.review',  '{"view":true,"create":true,"edit":true,"delete":true}'),
  ('admin',           'receipts.review',  '{"view":true,"create":true,"edit":true,"delete":true}'),
  ('manager',         'receipts.review',  '{"view":true,"create":false,"edit":true,"delete":false}'),
  ('technician',      'receipts.review',  '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('viewer',          'receipts.review',  '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('contractor',      'receipts.review',  '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('storeman',        'receipts.review',  '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('project_manager', 'receipts.review',  '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('qa_manager',      'receipts.review',  '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('site_supervisor', 'receipts.review',  '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('client',          'receipts.review',  '{"view":false,"create":false,"edit":false,"delete":false}')

ON CONFLICT (role, permission_key) DO NOTHING;
