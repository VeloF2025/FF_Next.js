-- Migration 470: audited Zone Delivery and Handover state.
-- Additive and idempotent. Existing tracker, snag, user, and RBAC rows are
-- retained as canonical evidence.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS ux_pon_stage_tracking_owner ON pon_stage_tracking(id, project_id, zone_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_snags_project_owner ON snags(id, project_id);
CREATE TABLE IF NOT EXISTS zone_delivery_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  zone_no INTEGER NOT NULL,
  scope_approved_at TIMESTAMPTZ,
  scope_approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  eligible_for_zone_qa_at TIMESTAMPTZ,
  civil_qa_status TEXT NOT NULL DEFAULT 'not_started',
  civil_qa_notes TEXT NOT NULL DEFAULT '',
  civil_qa_effective_at TIMESTAMPTZ,
  civil_qa_approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  optical_qa_status TEXT NOT NULL DEFAULT 'not_started',
  optical_qa_notes TEXT NOT NULL DEFAULT '',
  optical_qa_effective_at TIMESTAMPTZ,
  optical_qa_approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  handed_over_at TIMESTAMPTZ,
  handover_snapshot JSONB,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT zone_delivery_state_project_zone_key UNIQUE (project_id, zone_no),
  CONSTRAINT zone_delivery_state_zone_no_check CHECK (zone_no > 0),
  CONSTRAINT zone_delivery_state_civil_qa_status_check
    CHECK (civil_qa_status IN ('not_started', 'in_progress', 'passed', 'failed')),
  CONSTRAINT zone_delivery_state_optical_qa_status_check
    CHECK (optical_qa_status IN ('not_started', 'in_progress', 'passed', 'failed')),
  CONSTRAINT zone_delivery_state_scope_approval_check
    CHECK ((scope_approved_at IS NULL) = (scope_approved_by IS NULL)),
  CONSTRAINT zone_delivery_state_civil_qa_evidence_check CHECK (
    (civil_qa_status = 'not_started'
      AND civil_qa_effective_at IS NULL AND civil_qa_approved_by IS NULL)
    OR (civil_qa_status <> 'not_started'
      AND civil_qa_effective_at IS NOT NULL AND civil_qa_approved_by IS NOT NULL)
  ),
  CONSTRAINT zone_delivery_state_optical_qa_evidence_check CHECK (
    (optical_qa_status = 'not_started'
      AND optical_qa_effective_at IS NULL AND optical_qa_approved_by IS NULL)
    OR (optical_qa_status <> 'not_started'
      AND optical_qa_effective_at IS NOT NULL AND optical_qa_approved_by IS NOT NULL)
  ),
  CONSTRAINT zone_delivery_state_row_version_check CHECK (row_version > 0),
  CONSTRAINT zone_delivery_state_handover_snapshot_check
    CHECK (
      (handed_over_at IS NULL AND handover_snapshot IS NULL)
      OR (handed_over_at IS NOT NULL AND handover_snapshot IS NOT NULL)
    )
);
CREATE OR REPLACE FUNCTION enforce_zone_delivery_canonical_zone() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pon_stage_tracking
    WHERE project_id = NEW.project_id AND zone_no = NEW.zone_no) THEN
    RAISE EXCEPTION 'Zone delivery state requires a canonical PON' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_zone_delivery_canonical_zone ON zone_delivery_state;
CREATE TRIGGER trg_zone_delivery_canonical_zone
  BEFORE INSERT OR UPDATE OF project_id, zone_no ON zone_delivery_state FOR EACH ROW
  EXECUTE FUNCTION enforce_zone_delivery_canonical_zone();
CREATE OR REPLACE FUNCTION protect_zone_delivery_handover()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.handed_over_at IS NOT NULL
     AND (
       NEW.handed_over_at IS DISTINCT FROM OLD.handed_over_at
       OR NEW.handover_snapshot IS DISTINCT FROM OLD.handover_snapshot
     ) THEN
    RAISE EXCEPTION 'handed_over_at is immutable once recorded';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_zone_delivery_handover_immutable ON zone_delivery_state;
CREATE TRIGGER trg_zone_delivery_handover_immutable
  BEFORE UPDATE ON zone_delivery_state FOR EACH ROW EXECUTE FUNCTION protect_zone_delivery_handover();
CREATE TABLE IF NOT EXISTS zone_delivery_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  zone_no INTEGER NOT NULL,
  pon_stage_id UUID,
  document_type TEXT NOT NULL,
  document_source TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at TIMESTAMPTZ,
  superseded_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT zone_delivery_documents_zone_fk
    FOREIGN KEY (project_id, zone_no)
    REFERENCES zone_delivery_state(project_id, zone_no) ON DELETE RESTRICT,
  CONSTRAINT zone_delivery_documents_pon_owner_fk
    FOREIGN KEY (pon_stage_id, project_id, zone_no)
    REFERENCES pon_stage_tracking(id, project_id, zone_no) ON DELETE RESTRICT,
  CONSTRAINT zone_delivery_documents_id_pon_key UNIQUE (id, pon_stage_id),
  CONSTRAINT zone_delivery_documents_type_check
    CHECK (document_type IN ('test_pack', 'fac', 'cac')),
  CONSTRAINT zone_delivery_documents_source_check
    CHECK (document_source IN ('vf_storage', 'exfo_result')),
  CONSTRAINT zone_delivery_documents_owner_check
    CHECK (
      (document_type = 'test_pack' AND pon_stage_id IS NOT NULL)
      OR (document_type IN ('fac', 'cac') AND pon_stage_id IS NULL)
    ),
  CONSTRAINT zone_delivery_documents_size_check CHECK (size_bytes >= 0),
  CONSTRAINT zone_delivery_documents_checksum_check
    CHECK (checksum_sha256 ~ '^[0-9A-Fa-f]{64}$'),
  CONSTRAINT zone_delivery_documents_supersession_check
    CHECK ((superseded_at IS NULL) = (superseded_by IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_zone_delivery_documents_active_pon
  ON zone_delivery_documents(pon_stage_id, document_type)
  WHERE superseded_at IS NULL AND document_type = 'test_pack';
CREATE UNIQUE INDEX IF NOT EXISTS ux_zone_delivery_documents_active_zone
  ON zone_delivery_documents(project_id, zone_no, document_type)
  WHERE superseded_at IS NULL
    AND document_type IN ('fac', 'cac');
CREATE INDEX IF NOT EXISTS idx_zone_delivery_documents_zone ON zone_delivery_documents(project_id, zone_no, document_type, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_zone_delivery_documents_pon ON zone_delivery_documents(pon_stage_id, uploaded_at DESC) WHERE pon_stage_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS pon_delivery_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pon_stage_id UUID NOT NULL UNIQUE,
  scope_status TEXT NOT NULL DEFAULT 'included',
  scope_reason TEXT,
  civil_complete_at TIMESTAMPTZ,
  civil_confirmed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  optical_complete_at TIMESTAMPTZ,
  optical_confirmed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  testing_passed_at TIMESTAMPTZ,
  testing_confirmed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  testing_test_pack_document_id UUID,
  port_submitted_at TIMESTAMPTZ,
  port_submitted_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  port_approved_at TIMESTAMPTZ,
  port_approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  technically_live_at TIMESTAMPTZ,
  technically_live_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pon_delivery_state_pon_stage_fk FOREIGN KEY (pon_stage_id)
    REFERENCES pon_stage_tracking(id) ON DELETE RESTRICT,
  CONSTRAINT pon_delivery_state_testing_document_fk
    FOREIGN KEY (testing_test_pack_document_id, pon_stage_id)
    REFERENCES zone_delivery_documents(id, pon_stage_id) ON DELETE RESTRICT,
  CONSTRAINT pon_delivery_state_scope_status_check
    CHECK (scope_status IN ('included', 'excluded', 'cancelled')),
  CONSTRAINT pon_delivery_state_scope_reason_check
    CHECK (scope_status = 'included' OR NULLIF(BTRIM(scope_reason), '') IS NOT NULL),
  CONSTRAINT pon_delivery_state_row_version_check CHECK (row_version > 0),
  CONSTRAINT pon_delivery_state_civil_actor_check
    CHECK ((civil_complete_at IS NULL) = (civil_confirmed_by IS NULL)),
  CONSTRAINT pon_delivery_state_optical_actor_check
    CHECK ((optical_complete_at IS NULL) = (optical_confirmed_by IS NULL)),
  CONSTRAINT pon_delivery_state_testing_actor_check CHECK (
    (testing_passed_at IS NULL AND testing_confirmed_by IS NULL
      AND testing_test_pack_document_id IS NULL)
    OR (testing_passed_at IS NOT NULL AND testing_confirmed_by IS NOT NULL
      AND testing_test_pack_document_id IS NOT NULL)
  ),
  CONSTRAINT pon_delivery_state_port_submitted_actor_check
    CHECK ((port_submitted_at IS NULL) = (port_submitted_by IS NULL)),
  CONSTRAINT pon_delivery_state_port_approved_actor_check
    CHECK ((port_approved_at IS NULL) = (port_approved_by IS NULL)),
  CONSTRAINT pon_delivery_state_live_actor_check
    CHECK ((technically_live_at IS NULL) = (technically_live_by IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_pon_delivery_state_scope ON pon_delivery_state(scope_status, pon_stage_id);
CREATE TABLE IF NOT EXISTS zone_delivery_snag_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  zone_no INTEGER NOT NULL,
  snag_id UUID NOT NULL,
  pon_stage_id UUID,
  affected_gate TEXT,
  handover_blocking BOOLEAN NOT NULL DEFAULT TRUE,
  requires_reconfirmation BOOLEAN NOT NULL DEFAULT FALSE,
  linked_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reconfirmed_at TIMESTAMPTZ,
  reconfirmed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT zone_delivery_snag_links_zone_fk
    FOREIGN KEY (project_id, zone_no)
    REFERENCES zone_delivery_state(project_id, zone_no) ON DELETE RESTRICT,
  CONSTRAINT zone_delivery_snag_links_snag_owner_fk
    FOREIGN KEY (snag_id, project_id)
    REFERENCES snags(id, project_id) ON DELETE RESTRICT,
  CONSTRAINT zone_delivery_snag_links_pon_owner_fk
    FOREIGN KEY (pon_stage_id, project_id, zone_no)
    REFERENCES pon_stage_tracking(id, project_id, zone_no) ON DELETE RESTRICT,
  CONSTRAINT zone_delivery_snag_links_unique
    UNIQUE (snag_id, project_id, zone_no),
  CONSTRAINT zone_delivery_snag_links_gate_check
    CHECK (
      affected_gate IS NULL
      OR affected_gate IN (
        'civil_complete',
        'optical_complete',
        'testing_passed',
        'port_submitted',
        'port_approved',
        'technically_live'
      )
    ),
  CONSTRAINT zone_delivery_snag_links_reconfirmed_check
    CHECK ((reconfirmed_at IS NULL) = (reconfirmed_by IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_zone_delivery_snag_links_blocking ON zone_delivery_snag_links(project_id, zone_no, snag_id)
  WHERE handover_blocking;
CREATE INDEX IF NOT EXISTS idx_zone_delivery_snag_links_pon
  ON zone_delivery_snag_links(pon_stage_id)
  WHERE pon_stage_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS zone_delivery_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  zone_no INTEGER NOT NULL,
  pon_stage_id UUID,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_email TEXT NOT NULL,
  permission TEXT NOT NULL,
  source TEXT NOT NULL,
  reason TEXT,
  previous_value JSONB,
  new_value JSONB,
  CONSTRAINT zone_delivery_activity_zone_fk
    FOREIGN KEY (project_id, zone_no)
    REFERENCES zone_delivery_state(project_id, zone_no) ON DELETE RESTRICT,
  CONSTRAINT zone_delivery_activity_pon_owner_fk
    FOREIGN KEY (pon_stage_id, project_id, zone_no)
    REFERENCES pon_stage_tracking(id, project_id, zone_no) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_zone_delivery_activity_zone_time ON zone_delivery_activity(project_id, zone_no, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_zone_delivery_activity_pon_time
  ON zone_delivery_activity(pon_stage_id, recorded_at DESC) WHERE pon_stage_id IS NOT NULL;
CREATE OR REPLACE FUNCTION reject_zone_delivery_activity_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'zone_delivery_activity is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_zone_delivery_activity_append_only ON zone_delivery_activity;
CREATE TRIGGER trg_zone_delivery_activity_append_only
  BEFORE UPDATE OR DELETE ON zone_delivery_activity FOR EACH ROW
  EXECUTE FUNCTION reject_zone_delivery_activity_mutation();
INSERT INTO access_permissions
  (type, key, parent_key, label, description, sort_order, is_active) VALUES
  ('action', 'construction-qa.zone-delivery.scope-manage', 'construction-qa.qa-centre',
   'Zone Delivery - Manage Scope', 'Approve and maintain the included PON scope', 20, TRUE),
  ('action', 'construction-qa.zone-delivery.construction-confirm', 'construction-qa.qa-centre',
   'Zone Delivery - Confirm Construction', 'Confirm civil and optical construction milestones', 21, TRUE),
  ('action', 'construction-qa.zone-delivery.testing-confirm', 'construction-qa.qa-centre',
   'Zone Delivery - Confirm Testing', 'Confirm testing milestones and evidence', 22, TRUE),
  ('action', 'construction-qa.zone-delivery.operations-confirm', 'construction-qa.qa-centre',
   'Zone Delivery - Confirm Operations', 'Confirm port and technical-live milestones', 23, TRUE),
  ('action', 'construction-qa.zone-delivery.zone-qa-approve', 'construction-qa.qa-centre',
   'Zone Delivery - Approve Zone QA', 'Record civil and optical Zone QA decisions', 24, TRUE),
  ('action', 'construction-qa.zone-delivery.documents-manage', 'construction-qa.qa-centre',
   'Zone Delivery - Manage Documents', 'Register and supersede handover evidence', 25, TRUE)
ON CONFLICT (key) DO UPDATE SET
  type = EXCLUDED.type,
  parent_key = EXCLUDED.parent_key,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;
INSERT INTO role_permissions (role, permission_key, actions)
SELECT role_name, permission_key,
  '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
FROM (VALUES ('super_admin'), ('admin')) AS roles(role_name)
CROSS JOIN (
  VALUES
    ('construction-qa.zone-delivery.scope-manage'),
    ('construction-qa.zone-delivery.construction-confirm'),
    ('construction-qa.zone-delivery.testing-confirm'),
    ('construction-qa.zone-delivery.operations-confirm'),
    ('construction-qa.zone-delivery.zone-qa-approve'),
    ('construction-qa.zone-delivery.documents-manage')
) AS permissions(permission_key)
ON CONFLICT (role, permission_key) DO UPDATE SET
  actions = EXCLUDED.actions,
  updated_at = NOW();
INSERT INTO schema_migrations (filename, applied_at) VALUES ('470_zone_delivery_handover.sql', NOW())
ON CONFLICT (filename) DO NOTHING;
COMMIT;
