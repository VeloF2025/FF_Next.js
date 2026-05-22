-- works-qa AI auto-sort: per-photo slot suggestions for items in the
-- per-pole unassigned bucket. Populated by /api/works-qa/auto-sort; UI
-- renders a "→ slot · confidence%" badge on each thumbnail.
--
-- Shape:
--   { "<photo_key>": {
--       "suggested_slot": "civil_03",
--       "confidence": 0.87,
--       "generated_at": "2026-05-21T19:30:00Z"
--   } }
--
-- Non-breaking: defaults to '{}', existing code paths ignore the column.

ALTER TABLE pole_qa_photos
  ADD COLUMN unassigned_suggestions JSONB NOT NULL DEFAULT '{}';

CREATE INDEX idx_pole_qa_photos_unassigned_suggestions
  ON pole_qa_photos USING GIN (unassigned_suggestions);

INSERT INTO migrations (version, name, executed_at)
VALUES ('368', 'works_qa_unassigned_suggestions', NOW());
