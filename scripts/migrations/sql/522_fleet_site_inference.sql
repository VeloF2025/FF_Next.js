-- 522_fleet_site_inference.sql
-- GPS dwell -> operational-site inference. Proposals only; nothing here is
-- automatically true and nothing here writes to the roster.
--
-- The evidence and the human decision live in two tables ON PURPOSE. The
-- requirement is that a recompute can never overwrite a human's answer, and a
-- convention ("remember not to touch these columns") is not a guard. Splitting
-- them means the inference writer's statement does not contain the decision
-- columns at all - there is no column for it to clobber.
--
-- The decision row is also self-contained: it stores the project the human
-- settled on, not a pointer into the evidence. A later recompute that flips a
-- vehicle from `confident` to `roaming` therefore cannot strand or silently
-- reinterpret a decision that was already made.

CREATE TABLE IF NOT EXISTS fleet_site_inference_evidence (
  vehicle_id UUID PRIMARY KEY REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL,
  inferred_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  dominant_share NUMERIC(7,6),
  pings NUMERIC NOT NULL DEFAULT 0,
  dwell_seconds NUMERIC NOT NULL DEFAULT 0,
  distinct_days INTEGER NOT NULL DEFAULT 0,
  total_positions INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_site_inference_evidence_outcome_check CHECK (outcome IN (
    'confident', 'roaming', 'insufficient_data', 'no_aoi_coverage'
  )),
  -- A project is named if and only if we were confident about it. Without this
  -- a `roaming` row could still carry a project and be read as an answer.
  CONSTRAINT fleet_site_inference_evidence_project_matches_outcome CHECK (
    (outcome = 'confident') = (inferred_project_id IS NOT NULL)
  ),
  CONSTRAINT fleet_site_inference_evidence_share_range CHECK (
    dominant_share IS NULL OR (dominant_share >= 0 AND dominant_share <= 1)
  ),
  CONSTRAINT fleet_site_inference_evidence_counts_nonnegative CHECK (
    pings >= 0 AND dwell_seconds >= 0 AND distinct_days >= 0 AND total_positions >= 0
  ),
  CONSTRAINT fleet_site_inference_evidence_window_order CHECK (window_end > window_start),
  CONSTRAINT fleet_site_inference_evidence_breakdown_is_array CHECK (
    jsonb_typeof(breakdown) = 'array'
  )
);

CREATE INDEX IF NOT EXISTS ix_fleet_site_inference_evidence_outcome
  ON fleet_site_inference_evidence (outcome);

CREATE TABLE IF NOT EXISTS fleet_site_inference_decisions (
  vehicle_id UUID PRIMARY KEY REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  -- The project the human settled on. Self-contained by design: never a
  -- reference to whatever the evidence table currently happens to say.
  decided_project_id UUID REFERENCES projects(id) ON DELETE RESTRICT,
  -- Whether the human took the machine's word or picked a different project.
  decided_from TEXT,
  -- The evidence generation this decision was taken against, so drift is
  -- visible without anything being rewritten.
  evidence_computed_at TIMESTAMPTZ,
  note TEXT,
  decided_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Compare-and-set token for concurrent editors. A monotonic counter rather
  -- than decided_at: timestamptz keeps microseconds that a JS Date cannot
  -- round-trip, and two writes inside one millisecond are indistinguishable by
  -- clock. Neither problem exists for an integer.
  revision INTEGER NOT NULL DEFAULT 1,
  applied_assignment_id UUID REFERENCES fleet_operational_assignments(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ,
  applied_by UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fleet_site_inference_decisions_decision_check CHECK (decision IN (
    'assigned', 'rejected', 'roaming_confirmed'
  )),
  CONSTRAINT fleet_site_inference_decisions_project_matches_decision CHECK (
    (decision = 'assigned') = (decided_project_id IS NOT NULL)
  ),
  CONSTRAINT fleet_site_inference_decisions_from_matches_decision CHECK (
    (decision = 'assigned') = (decided_from IS NOT NULL)
  ),
  CONSTRAINT fleet_site_inference_decisions_from_check CHECK (
    decided_from IS NULL OR decided_from IN ('inference', 'override')
  ),
  CONSTRAINT fleet_site_inference_decisions_note_nonblank CHECK (
    note IS NULL OR btrim(note) <> ''
  ),
  CONSTRAINT fleet_site_inference_decisions_revision_positive CHECK (revision > 0),
  -- Only an `assigned` decision can have been pushed onto the roster.
  CONSTRAINT fleet_site_inference_decisions_applied_requires_assigned CHECK (
    applied_assignment_id IS NULL OR decision = 'assigned'
  ),
  CONSTRAINT fleet_site_inference_decisions_applied_is_complete CHECK (
    (applied_assignment_id IS NULL AND applied_at IS NULL AND applied_by IS NULL)
    OR (applied_assignment_id IS NOT NULL AND applied_at IS NOT NULL AND applied_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS ix_fleet_site_inference_decisions_unapplied
  ON fleet_site_inference_decisions (decision)
  WHERE applied_assignment_id IS NULL;

-- Defence in depth behind the table split: any statement that changes what was
-- decided has to re-stamp who decided it and when. A background recompute has
-- no user to name, so it cannot satisfy this even if someone later points it at
-- the wrong table.
CREATE OR REPLACE FUNCTION fleet_site_inference_decision_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.decision, NEW.decided_project_id, NEW.decided_from)
       IS DISTINCT FROM (OLD.decision, OLD.decided_project_id, OLD.decided_from)
     AND (NEW.decided_at, NEW.decided_by) IS NOT DISTINCT FROM (OLD.decided_at, OLD.decided_by) THEN
    RAISE EXCEPTION
      'A changed site-inference decision must re-stamp decided_at and decided_by'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fleet_site_inference_decision_guard
  ON fleet_site_inference_decisions;
CREATE TRIGGER trg_fleet_site_inference_decision_guard
  BEFORE UPDATE ON fleet_site_inference_decisions
  FOR EACH ROW EXECUTE FUNCTION fleet_site_inference_decision_guard();

-- Read surface. `effective_project_id` is the human's answer when there is one
-- and the machine's suggestion otherwise, and `decision_matches_inference`
-- makes any drift between the two visible without resolving it.
CREATE OR REPLACE VIEW fleet_site_inference_proposals AS
SELECT
  e.vehicle_id,
  v.registration,
  e.outcome,
  e.inferred_project_id,
  ip.project_name AS inferred_project_name,
  e.dominant_share,
  e.pings,
  e.dwell_seconds,
  e.distinct_days,
  e.total_positions,
  e.window_start,
  e.window_end,
  e.breakdown,
  e.computed_at,
  d.decision,
  d.decided_project_id,
  dp.project_name AS decided_project_name,
  d.decided_from,
  d.note,
  d.decided_by,
  d.decided_at,
  d.evidence_computed_at AS decided_against_computed_at,
  d.applied_assignment_id,
  d.applied_at,
  d.applied_by,
  COALESCE(d.decided_project_id, e.inferred_project_id) AS effective_project_id,
  -- NULL means "not applicable", not "they agree". A rejected or
  -- roaming_confirmed decision names no project, so there is nothing to compare
  -- against the inference; reading NULL = NULL as agreement said the opposite.
  CASE
    WHEN d.decision IS NULL OR d.decided_project_id IS NULL THEN NULL
    ELSE d.decided_project_id IS NOT DISTINCT FROM e.inferred_project_id
  END AS decision_matches_inference,
  COALESCE(dr.drivers, '[]'::jsonb) AS drivers,
  -- Appended, not inserted mid-list: CREATE OR REPLACE VIEW only permits adding
  -- columns at the END of the select list, so putting this in the middle would
  -- make the file un-re-runnable over a previous version of itself.
  d.revision AS decision_revision
FROM fleet_site_inference_evidence e
JOIN fleet_vehicles v ON v.id = e.vehicle_id
LEFT JOIN projects ip ON ip.id = e.inferred_project_id
LEFT JOIN fleet_site_inference_decisions d ON d.vehicle_id = e.vehicle_id
LEFT JOIN projects dp ON dp.id = d.decided_project_id
LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object(
    'staffId', s.id,
    'staffName', btrim(CONCAT_WS(' ', s.first_name, s.last_name)),
    'vehicleAssignmentId', va.id,
    -- vehicle_assignments carries its own registration string, and on
    -- production 5 of 24 active rows disagree with fleet_vehicles.registration
    -- for the same fleet_vehicle_id. Surface both rather than pick one.
    'assignmentRegistration', va.vehicle_registration
  ) ORDER BY va.assignment_start DESC, va.id) AS drivers
  FROM vehicle_assignments va
  JOIN staff s ON s.id = va.staff_id
  WHERE va.fleet_vehicle_id = e.vehicle_id AND va.is_active
) dr ON TRUE;

INSERT INTO schema_migrations (filename)
VALUES ('522_fleet_site_inference.sql')
ON CONFLICT (filename) DO NOTHING;
