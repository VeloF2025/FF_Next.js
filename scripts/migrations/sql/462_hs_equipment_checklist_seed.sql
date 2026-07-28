-- 462: Seed 7 daily-equipment checklist templates
--
-- Follow-up to the 2026-07-25 H&S docs-vs-module alignment audit
-- (project_hs_docs_alignment_audit.md, rec #5): the real client H&S files
-- (Herotel, Frogfoot, Light Fibre, Fibre Time) include daily pre-use
-- equipment checklists -- ladder, hand tools, fire equipment, road cutter,
-- compactor, barricading, traffic signage -- that had no template in the 8
-- seeded by migration 113/450.
--
-- Inactive by default (is_active = false, is_default = false), unlike the
-- original 8: these are equipment-specific daily pre-use checks, not
-- domain-wide periodic audit categories, and hs_checklist_templates has no
-- project scoping -- an is_active=true template's items are automatically
-- pulled into every future "all active templates" audit across every
-- project (pages/api/health-safety/project/[projectId]/audits.ts), whether
-- or not that project has a ladder or road cutter on site. Someone
-- explicitly activates the ones relevant to a given project.
--
-- No schema change -- hs_checklist_templates.category and
-- hs_checklist_items.category are unconstrained VARCHAR(100), pure seed data.
-- Idempotent (WHERE NOT EXISTS on templates, ON CONFLICT DO NOTHING on items
-- via the hs_checklist_items_template_text_key natural key from migration 449).
-- Rollback: rollback_462_hs_equipment_checklist_seed.sql

BEGIN;

INSERT INTO hs_checklist_templates (name, category, description, is_default, is_active)
SELECT v.name, v.category, v.description, false, false
FROM (VALUES
  ('Ladder Inspection - Standard', 'ladder', 'Daily pre-use ladder inspection per General Safety Reg 13A'),
  ('Hand Tool Inspection - Standard', 'hand_tools', 'Daily pre-use hand and power tool inspection per General Safety Regulations Section 8'),
  ('Fire Equipment Inspection - Standard', 'fire_equipment', 'Periodic fire extinguisher and fire-fighting equipment inspection per Construction Reg 29'),
  ('Road Cutter Daily Checklist', 'road_cutter', 'Daily pre-use road cutter / concrete saw checklist'),
  ('Compactor Daily Checklist', 'compactor', 'Daily pre-use plate compactor / wacker checklist'),
  ('Barricading Daily Checklist', 'barricading', 'Daily excavation and trench barricading checklist per Construction Reg 13'),
  ('Traffic Signage Daily Checklist', 'traffic_signage', 'Daily traffic accommodation signage checklist per the site Traffic Management Plan')
) AS v(name, category, description)
WHERE NOT EXISTS (
  SELECT 1 FROM hs_checklist_templates t WHERE t.category = v.category
);

DO $$
DECLARE
  v_ladder_id UUID;
  v_hand_tools_id UUID;
  v_fire_equipment_id UUID;
  v_road_cutter_id UUID;
  v_compactor_id UUID;
  v_barricading_id UUID;
  v_traffic_signage_id UUID;
BEGIN
  SELECT id INTO v_ladder_id FROM hs_checklist_templates WHERE category = 'ladder' LIMIT 1;
  SELECT id INTO v_hand_tools_id FROM hs_checklist_templates WHERE category = 'hand_tools' LIMIT 1;
  SELECT id INTO v_fire_equipment_id FROM hs_checklist_templates WHERE category = 'fire_equipment' LIMIT 1;
  SELECT id INTO v_road_cutter_id FROM hs_checklist_templates WHERE category = 'road_cutter' LIMIT 1;
  SELECT id INTO v_compactor_id FROM hs_checklist_templates WHERE category = 'compactor' LIMIT 1;
  SELECT id INTO v_barricading_id FROM hs_checklist_templates WHERE category = 'barricading' LIMIT 1;
  SELECT id INTO v_traffic_signage_id FROM hs_checklist_templates WHERE category = 'traffic_signage' LIMIT 1;

  INSERT INTO hs_checklist_items (template_id, item_text, category, severity, regulation_reference, sort_order, is_mandatory, requires_photo) VALUES
  (v_ladder_id, 'Ladder free of visible damage (cracks, bends, corrosion)', 'ladder', 'critical', 'General Safety Reg 13A', 1, true, true),
  (v_ladder_id, 'Rubber feet / non-slip base present and intact', 'ladder', 'high', 'General Safety Reg 13A', 2, true, false),
  (v_ladder_id, 'Ladder positioned at correct angle (4:1 ratio) and secured', 'ladder', 'critical', 'Construction Reg 13', 3, true, false),
  (v_ladder_id, 'Load rating label legible and not exceeded', 'ladder', 'medium', 'General Safety Reg 13A', 4, true, false),
  (v_ladder_id, 'Current inspection tag attached and within date', 'ladder', 'high', 'General Safety Reg 13A', 5, true, false),

  (v_hand_tools_id, 'Tool handles free of cracks, splinters, or looseness', 'hand_tools', 'high', 'General Safety Regulations Section 8', 1, true, false),
  (v_hand_tools_id, 'Cutting edges and blades sharp and guarded', 'hand_tools', 'medium', 'General Safety Regulations Section 8', 2, true, false),
  (v_hand_tools_id, 'Power tool cords and plugs undamaged, no exposed wiring', 'hand_tools', 'critical', 'General Safety Regulations Section 8', 3, true, true),
  (v_hand_tools_id, 'Tool inspected and tagged before issue to a worker', 'hand_tools', 'high', 'General Safety Regulations Section 8', 4, true, false),
  (v_hand_tools_id, 'Damaged tools removed from service and reported', 'hand_tools', 'high', 'General Safety Regulations Section 8', 5, true, false),

  (v_fire_equipment_id, 'Extinguisher pressure gauge in serviceable (green) range', 'fire_equipment', 'critical', 'Construction Reg 29', 1, true, true),
  (v_fire_equipment_id, 'Service tag current (within the last 12 months)', 'fire_equipment', 'critical', 'Construction Reg 29', 2, true, false),
  (v_fire_equipment_id, 'Extinguisher unobstructed and clearly signed', 'fire_equipment', 'high', 'Construction Reg 29', 3, true, false),
  (v_fire_equipment_id, 'Correct extinguisher type selected for the area fire risk', 'fire_equipment', 'high', 'Construction Reg 29', 4, true, false),
  (v_fire_equipment_id, 'Fire blanket present and accessible where required', 'fire_equipment', 'medium', 'Construction Reg 29', 5, false, false),

  (v_road_cutter_id, 'Blade guard fitted and functional', 'road_cutter', 'critical', 'General Safety Regulations', 1, true, true),
  (v_road_cutter_id, 'Water suppression / dust control operating', 'road_cutter', 'high', 'General Safety Regulations', 2, true, false),
  (v_road_cutter_id, 'Operator wearing hearing and eye protection', 'road_cutter', 'high', 'General Safety Reg 2', 3, true, false),
  (v_road_cutter_id, 'Fuel, oil, and coolant levels checked before start', 'road_cutter', 'medium', 'General Safety Regulations', 4, true, false),
  (v_road_cutter_id, 'Kickback / blade-lock guard functional', 'road_cutter', 'critical', 'General Safety Regulations', 5, true, false),

  (v_compactor_id, 'Engine and fluid levels checked before start', 'compactor', 'medium', 'General Safety Regulations', 1, true, false),
  (v_compactor_id, 'Vibration handle guards and dampers intact', 'compactor', 'high', 'General Safety Regulations', 2, true, false),
  (v_compactor_id, 'Emergency stop / kill switch functional', 'compactor', 'critical', 'General Safety Regulations', 3, true, false),
  (v_compactor_id, 'Operator holds current competency for the machine', 'compactor', 'high', 'General Safety Regulations', 4, true, false),
  (v_compactor_id, 'Hearing protection and vibration-rated gloves worn', 'compactor', 'high', 'General Safety Reg 2', 5, true, false),

  (v_barricading_id, 'Excavation / trench fully barricaded on all sides', 'barricading', 'critical', 'Construction Reg 13', 1, true, true),
  (v_barricading_id, 'Warning signage visible from approach', 'barricading', 'high', 'Construction Reg 13', 2, true, false),
  (v_barricading_id, 'Barriers stable and not displaced or damaged', 'barricading', 'high', 'Construction Reg 13', 3, true, false),
  (v_barricading_id, 'Reflective markers / lighting in place for night visibility', 'barricading', 'medium', 'Construction Reg 13', 4, true, false),
  (v_barricading_id, 'Pedestrian walkway maintained clear of the works', 'barricading', 'medium', 'Construction Reg 13', 5, true, false),

  (v_traffic_signage_id, 'Signage placed per the approved Traffic Management Plan', 'traffic_signage', 'critical', 'Site Traffic Management Plan', 1, true, true),
  (v_traffic_signage_id, 'Signs clean, undamaged, and clearly visible', 'traffic_signage', 'high', 'Site Traffic Management Plan', 2, true, false),
  (v_traffic_signage_id, 'Correct advance-warning placement distances', 'traffic_signage', 'high', 'Site Traffic Management Plan', 3, true, false),
  (v_traffic_signage_id, 'Cones / delineators correctly spaced and upright', 'traffic_signage', 'medium', 'Site Traffic Management Plan', 4, true, false),
  (v_traffic_signage_id, 'Flagman / traffic controller present where required', 'traffic_signage', 'critical', 'Site Traffic Management Plan', 5, true, false)
  ON CONFLICT (template_id, item_text) DO NOTHING;
END $$;

COMMIT;
