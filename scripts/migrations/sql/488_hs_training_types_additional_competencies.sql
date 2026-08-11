-- 488: five additional statutory H&S training competencies.
--
-- Requested by Hein 2026-08-11. All five are OHS Act / Construction Regulation
-- competencies, so they extend the statutory block (sort_order 10-100) rather
-- than the technical-skills block (200+), and carry requires_certificate = true
-- like every other statutory row.
--
-- Validity periods confirmed by Hein rather than inferred: 24 months, except
-- Ladder Inspector at 12, because ladder inspection is an annual duty. These
-- drive expiry reporting and the contractor compliance gate, so a wrong value
-- expires a certificate early or lets a stale one keep counting.
--
-- ON CONFLICT DO NOTHING on the unique `code`: this table is a catalogue whose
-- rows an admin may legitimately edit afterwards (rename, adjust validity,
-- deactivate). A DO UPDATE would silently revert those edits on any re-run.
--
-- Rerunnable.

BEGIN;

INSERT INTO hs_training_types
  (code, name, description, validity_months, is_statutory, requires_certificate, sort_order)
VALUES
  ('legal_liability',
   'Legal Liability',
   'OHS Act legal liability for managers, supervisors and s16(2) appointees.',
   24, true, true, 110),

  ('incident_investigator',
   'Accident and Incident Investigator',
   'Investigating accidents and incidents under GSR 9 and the OHS Act.',
   24, true, true, 120),

  ('she_supervisor',
   'SHE Supervisor',
   'Construction Regulation 8(1) health and safety supervisor.',
   24, true, true, 130),

  ('ladder_inspector',
   'Ladder Inspector',
   'Inspection of ladders under the General Safety Regulations. Annual refresher.',
   12, true, true, 140),

  ('fall_protection_planner',
   'Fall Protection Planner',
   'Drawing up and maintaining the fall protection plan (Construction Regulation 10).',
   24, true, true, 150)

ON CONFLICT (code) DO NOTHING;

COMMIT;
