-- Rollback for 450_hs_checklist_seed_44.sql
--
-- Removes only seed items that were never used in any audit response, so
-- operator data and audit history are never destroyed. Templates are left in
-- place (they may be referenced by hs_project_config.template_id).

BEGIN;

-- Scoped to the default templates the seed targeted — an operator-created
-- item with identical text under a custom template is never touched.
DELETE FROM hs_checklist_items i
USING hs_checklist_templates t
WHERE i.template_id = t.id
AND t.is_default = true
AND i.item_text IN (
  'Fall protection plan available and communicated to workers',
  'Full body harnesses inspected and in good condition',
  'Anchor points certified and load-tested',
  'Ladders secured and at correct angle (4:1 ratio)',
  'Workers have valid medical fitness certificates for height work',
  'Guardrails installed where required (work >2m)',
  'Safety nets in place for elevated work areas',
  'Hard hats worn in designated areas',
  'Safety boots with steel toe caps worn by all workers',
  'Hi-visibility vests worn near traffic or vehicles',
  'Safety glasses available and used for fibre work',
  'Appropriate gloves provided for task',
  'Hearing protection available where noise exceeds 85dB',
  'Scaffold erected by competent person',
  'Weekly scaffold inspection records current',
  'Safe working load clearly displayed on scaffold',
  'Toe boards and guardrails in place',
  'Access ladders secured and positioned correctly',
  'Lock-out/tag-out procedures followed',
  'Permit to work in place for electrical tasks',
  'Safe working distance from power lines maintained',
  'Electrical tools inspected and tagged',
  'Extension cables protected from damage',
  'First aid kit stocked and accessible',
  'Trained first aider present on site',
  'Emergency contact numbers displayed',
  'Eye wash station available for fibre work',
  'Emergency evacuation plan communicated',
  'Fire extinguishers serviced and accessible',
  'Hot work permit in place where required',
  'Flammable materials stored correctly',
  'Fire escape routes clear and signed',
  'Fibre scraps disposed in sealed container',
  'No eating or drinking in splicing area',
  'Laser safety glasses worn for OTDR work',
  'Adequate ventilation for epoxy curing',
  'Warning signs for laser equipment displayed',
  'Cleave waste container on-site and used',
  'Site perimeter secured appropriately',
  'Adequate lighting for work areas',
  'Housekeeping maintained (no trip hazards)',
  'Welfare facilities adequate (toilets, water)',
  'Safety signage visible and current',
  'Excavations protected and supported'
)
AND NOT EXISTS (
  SELECT 1 FROM hs_audit_responses r WHERE r.checklist_item_id = i.id
);

COMMIT;
