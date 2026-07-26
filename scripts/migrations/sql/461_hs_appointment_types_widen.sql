-- 461: Widen hs_appointment_letters.letter_type to cover the full statutory set
--
-- Follow-up to the 2026-07-25 H&S docs-vs-module alignment audit
-- (project_hs_docs_alignment_audit.md): the CHECK constraint added in 455
-- only covered 4 appointment types (s16_2, s8_1, construction_supervisor,
-- annexure_3), but the real client H&S files (Herotel, Frogfoot, Light Fibre,
-- Fibre Time) evidence 18 more regulation-clause-specific statutory
-- appointments that this constraint rejects outright today.
--
-- Additive only: widens the constraint, does not touch existing rows/values.
-- Idempotent (checks current definition before dropping). Rollback:
-- rollback_461_hs_appointment_types_widen.sql (restores the original 4-value
-- constraint — will fail if any row already uses a new type; see rollback file).

BEGIN;

ALTER TABLE hs_appointment_letters DROP CONSTRAINT IF EXISTS hs_appointment_letters_type_check;

ALTER TABLE hs_appointment_letters ADD CONSTRAINT hs_appointment_letters_type_check
  CHECK (letter_type IN (
    -- original 4 (455_hs_appointment_letters.sql)
    's16_2','s8_1','construction_supervisor','annexure_3',
    -- widened set (461, this migration)
    's16_1',
    'cr8_5',
    'cr8_7',
    'cr9_1_risk_assessor',
    'cr10_fall_protection_planner',
    'cr13_excavation_supervisor',
    'cr23_mobile_plant_operator',
    'cr28a_stacking_storage',
    'cr29h_firefighting_inspector',
    'gsr3_4_first_aid',
    'gsr13a_ladder_inspector',
    'emr10_4_electrical_inspector',
    'gar9_2_incident_investigator',
    'section8_hand_tools_inspector',
    'chemical_control_coordinator',
    'annexure_2',
    's37_2_mandatary',
    'principal_contractor'
  ));

COMMIT;
