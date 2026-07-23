-- 450: Idempotent H&S checklist seed — full 44-item set (goal D5, PR-3)
--
-- Live has 24 items across 5 templates; Electrical/Fire/Scaffolding templates
-- have 0 items so any audit scoped to them is empty. This re-seeds the full
-- 44-item set from migration 113 (the correct count — docs claiming 48 are
-- wrong) using ON CONFLICT (template_id, item_text) DO NOTHING on the natural
-- key added by migration 449, so existing rows (and any operator edits to
-- their severity/sort order) are preserved.
--
-- Requires: 449 (unique index hs_checklist_items_template_text_key).
-- Rollback: rollback_450_hs_checklist_seed_44.sql

BEGIN;

-- Ensure the 8 default templates exist (matches migration 113's set)
INSERT INTO hs_checklist_templates (name, category, description, is_default, is_active)
SELECT v.name, v.category, v.description, true, true
FROM (VALUES
  ('Working at Heights - Standard', 'working_at_heights', 'Fall protection and height work safety per Construction Reg 8'),
  ('PPE Compliance - Standard', 'ppe', 'Personal protective equipment checks per OHS Act s8(2)(d)'),
  ('Scaffolding Safety - SANS 10085', 'scaffolding', 'Scaffolding safety per SANS 10085 and Construction Reg 16'),
  ('Electrical Safety - Standard', 'electrical', 'Electrical safety and lock-out/tag-out procedures'),
  ('First Aid Readiness', 'first_aid', 'First aid equipment and personnel per General Safety Reg 3'),
  ('Fire Safety - Standard', 'fire', 'Fire prevention and emergency equipment per Construction Reg 29'),
  ('Fibre-Specific Safety', 'fibre_specific', 'Fibre optic installation specific hazards (glass, laser, chemicals)'),
  ('Site Conditions - General', 'site_conditions', 'General site housekeeping and welfare per Construction Reg 24-26')
) AS v(name, category, description)
WHERE NOT EXISTS (
  SELECT 1 FROM hs_checklist_templates t
  WHERE t.category = v.category AND t.is_default = true
);

DO $$
DECLARE
  v_heights_id UUID;
  v_ppe_id UUID;
  v_scaffolding_id UUID;
  v_electrical_id UUID;
  v_first_aid_id UUID;
  v_fire_id UUID;
  v_fibre_id UUID;
  v_site_id UUID;
BEGIN
  SELECT id INTO v_heights_id FROM hs_checklist_templates WHERE category = 'working_at_heights' AND is_default = true LIMIT 1;
  SELECT id INTO v_ppe_id FROM hs_checklist_templates WHERE category = 'ppe' AND is_default = true LIMIT 1;
  SELECT id INTO v_scaffolding_id FROM hs_checklist_templates WHERE category = 'scaffolding' AND is_default = true LIMIT 1;
  SELECT id INTO v_electrical_id FROM hs_checklist_templates WHERE category = 'electrical' AND is_default = true LIMIT 1;
  SELECT id INTO v_first_aid_id FROM hs_checklist_templates WHERE category = 'first_aid' AND is_default = true LIMIT 1;
  SELECT id INTO v_fire_id FROM hs_checklist_templates WHERE category = 'fire' AND is_default = true LIMIT 1;
  SELECT id INTO v_fibre_id FROM hs_checklist_templates WHERE category = 'fibre_specific' AND is_default = true LIMIT 1;
  SELECT id INTO v_site_id FROM hs_checklist_templates WHERE category = 'site_conditions' AND is_default = true LIMIT 1;

  INSERT INTO hs_checklist_items (template_id, item_text, category, severity, regulation_reference, sort_order, is_mandatory, requires_photo) VALUES
  (v_heights_id, 'Fall protection plan available and communicated to workers', 'working_at_heights', 'critical', 'Construction Reg 8(1)', 1, true, false),
  (v_heights_id, 'Full body harnesses inspected and in good condition', 'working_at_heights', 'critical', 'Construction Reg 8(5)', 2, true, true),
  (v_heights_id, 'Anchor points certified and load-tested', 'working_at_heights', 'critical', 'Construction Reg 8(6)', 3, true, false),
  (v_heights_id, 'Ladders secured and at correct angle (4:1 ratio)', 'working_at_heights', 'high', 'Construction Reg 13', 4, true, false),
  (v_heights_id, 'Workers have valid medical fitness certificates for height work', 'working_at_heights', 'critical', 'Construction Reg 8(7)', 5, true, false),
  (v_heights_id, 'Guardrails installed where required (work >2m)', 'working_at_heights', 'critical', 'Construction Reg 10', 6, true, true),
  (v_heights_id, 'Safety nets in place for elevated work areas', 'working_at_heights', 'high', 'Construction Reg 10(2)', 7, false, true),
  (v_ppe_id, 'Hard hats worn in designated areas', 'ppe', 'high', 'OHS Act s8(2)(d)', 1, true, false),
  (v_ppe_id, 'Safety boots with steel toe caps worn by all workers', 'ppe', 'high', 'General Safety Reg 2', 2, true, false),
  (v_ppe_id, 'Hi-visibility vests worn near traffic or vehicles', 'ppe', 'high', 'General Safety Reg 2', 3, true, false),
  (v_ppe_id, 'Safety glasses available and used for fibre work', 'ppe', 'high', 'General Safety Reg 2', 4, true, false),
  (v_ppe_id, 'Appropriate gloves provided for task', 'ppe', 'medium', 'General Safety Reg 2', 5, true, false),
  (v_ppe_id, 'Hearing protection available where noise exceeds 85dB', 'ppe', 'medium', 'Noise Induced Hearing Loss Reg', 6, false, false),
  (v_scaffolding_id, 'Scaffold erected by competent person', 'scaffolding', 'critical', 'Construction Reg 16(1)', 1, true, false),
  (v_scaffolding_id, 'Weekly scaffold inspection records current', 'scaffolding', 'high', 'Construction Reg 16(3)', 2, true, false),
  (v_scaffolding_id, 'Safe working load clearly displayed on scaffold', 'scaffolding', 'high', 'SANS 10085', 3, true, true),
  (v_scaffolding_id, 'Toe boards and guardrails in place', 'scaffolding', 'high', 'Construction Reg 16(2)', 4, true, true),
  (v_scaffolding_id, 'Access ladders secured and positioned correctly', 'scaffolding', 'high', 'Construction Reg 13', 5, true, false),
  (v_electrical_id, 'Lock-out/tag-out procedures followed', 'electrical', 'critical', 'Electrical Installation Reg', 1, true, false),
  (v_electrical_id, 'Permit to work in place for electrical tasks', 'electrical', 'critical', 'OHS Act s8(2)(h)', 2, true, false),
  (v_electrical_id, 'Safe working distance from power lines maintained', 'electrical', 'critical', 'Construction Reg 22', 3, true, false),
  (v_electrical_id, 'Electrical tools inspected and tagged', 'electrical', 'high', 'General Safety Reg 2A', 4, true, false),
  (v_electrical_id, 'Extension cables protected from damage', 'electrical', 'medium', 'General Safety Reg 2A', 5, true, false),
  (v_first_aid_id, 'First aid kit stocked and accessible', 'first_aid', 'high', 'General Safety Reg 3', 1, true, true),
  (v_first_aid_id, 'Trained first aider present on site', 'first_aid', 'high', 'General Safety Reg 3', 2, true, false),
  (v_first_aid_id, 'Emergency contact numbers displayed', 'first_aid', 'medium', 'General Safety Reg 3', 3, true, true),
  (v_first_aid_id, 'Eye wash station available for fibre work', 'first_aid', 'high', 'General Safety Reg 3', 4, true, true),
  (v_first_aid_id, 'Emergency evacuation plan communicated', 'first_aid', 'high', 'General Safety Reg 9', 5, true, false),
  (v_fire_id, 'Fire extinguishers serviced and accessible', 'fire', 'high', 'Construction Reg 29', 1, true, true),
  (v_fire_id, 'Hot work permit in place where required', 'fire', 'critical', 'Construction Reg 29(2)', 2, false, false),
  (v_fire_id, 'Flammable materials stored correctly', 'fire', 'high', 'Construction Reg 29(1)', 3, true, false),
  (v_fire_id, 'Fire escape routes clear and signed', 'fire', 'high', 'General Safety Reg 9', 4, true, true),
  (v_fibre_id, 'Fibre scraps disposed in sealed container', 'fibre_specific', 'high', 'Best Practice', 1, true, true),
  (v_fibre_id, 'No eating or drinking in splicing area', 'fibre_specific', 'medium', 'Best Practice', 2, true, false),
  (v_fibre_id, 'Laser safety glasses worn for OTDR work', 'fibre_specific', 'critical', 'Best Practice', 3, true, false),
  (v_fibre_id, 'Adequate ventilation for epoxy curing', 'fibre_specific', 'high', 'Hazardous Chemical Substances Reg', 4, true, false),
  (v_fibre_id, 'Warning signs for laser equipment displayed', 'fibre_specific', 'high', 'Best Practice', 5, true, true),
  (v_fibre_id, 'Cleave waste container on-site and used', 'fibre_specific', 'medium', 'Best Practice', 6, true, true),
  (v_site_id, 'Site perimeter secured appropriately', 'site_conditions', 'medium', 'Construction Reg 24', 1, true, false),
  (v_site_id, 'Adequate lighting for work areas', 'site_conditions', 'medium', 'Construction Reg 25', 2, true, false),
  (v_site_id, 'Housekeeping maintained (no trip hazards)', 'site_conditions', 'medium', 'Construction Reg 26', 3, true, true),
  (v_site_id, 'Welfare facilities adequate (toilets, water)', 'site_conditions', 'medium', 'Construction Reg 30', 4, true, false),
  (v_site_id, 'Safety signage visible and current', 'site_conditions', 'medium', 'Construction Reg 24(b)', 5, true, true),
  (v_site_id, 'Excavations protected and supported', 'site_conditions', 'critical', 'Construction Reg 13', 6, false, true)
  ON CONFLICT (template_id, item_text) DO NOTHING;
END $$;

COMMIT;
