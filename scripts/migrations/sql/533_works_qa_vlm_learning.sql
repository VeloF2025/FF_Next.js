-- Migration 533: connect Works QA human corrections to the universal VLM learning loop.
--
-- qa_correction_examples remains the immutable workflow-level source used by Works QA.
-- This migration mirrors its Works-QA rows into vlm_corrections so the system VLM
-- Learning dashboard can curate them and the production scorer can retrieve them.
-- Civil corrections remain isolated from optical dome/main-joint corrections.

CREATE UNIQUE INDEX IF NOT EXISTS uq_vlm_corrections_worksqa_source
  ON vlm_corrections (source_table, source_id, analysis_type)
  WHERE source_table = 'qa_correction_examples' AND source_id IS NOT NULL;

CREATE OR REPLACE FUNCTION sync_works_qa_vlm_learning_correction()
RETURNS TRIGGER AS $$
DECLARE
  lane TEXT;
  category TEXT;
BEGIN
  IF NEW.workflow_type <> 'works_qa' THEN
    RETURN NEW;
  END IF;

  category := COALESCE(NULLIF(NEW.correct_category, ''), NEW.vlm_predicted_category, '');
  lane := CASE
    WHEN category LIKE 'civil%' THEN 'works_qa_civil'
    WHEN category LIKE 'dome%' OR category LIKE 'main_joint%' THEN 'works_qa_optical'
    ELSE NULL
  END;

  -- Unknown/legacy categories remain in the source audit table but are not
  -- injected into either learning lane until a human classifies them.
  IF lane IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO vlm_corrections (
    module,
    analysis_type,
    source_id,
    source_table,
    photo_url,
    vlm_extracted_value,
    vlm_confidence,
    corrected_value,
    correction_reason,
    correction_notes,
    context_json,
    is_canonical,
    priority,
    corrected_by_name,
    created_at,
    updated_at
  ) VALUES (
    'works_qa',
    lane,
    NEW.id,
    'qa_correction_examples',
    NULL,
    NEW.vlm_predicted_category,
    NEW.vlm_confidence,
    NEW.correct_category,
    'other',
    NEW.correction_reason,
    jsonb_build_object(
      'photoFilename', NEW.photo_filename,
      'photoDescription', NEW.photo_description,
      'vlmPredictedStep', NEW.vlm_predicted_step,
      'correctStep', NEW.correct_step,
      'vlmReasoning', NEW.vlm_reasoning,
      'workflowType', NEW.workflow_type
    ),
    COALESCE(NEW.is_canonical, FALSE),
    LEAST(100, GREATEST(0, COALESCE(NEW.reviewed_count, 1))),
    NEW.corrected_by,
    NEW.created_at,
    NEW.updated_at
  )
  ON CONFLICT (source_table, source_id, analysis_type)
    WHERE source_table = 'qa_correction_examples' AND source_id IS NOT NULL
  DO UPDATE SET
    vlm_extracted_value = EXCLUDED.vlm_extracted_value,
    vlm_confidence = EXCLUDED.vlm_confidence,
    corrected_value = EXCLUDED.corrected_value,
    correction_notes = EXCLUDED.correction_notes,
    context_json = EXCLUDED.context_json,
    is_canonical = EXCLUDED.is_canonical,
    corrected_by_name = EXCLUDED.corrected_by_name,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_works_qa_vlm_learning ON qa_correction_examples;
CREATE TRIGGER trigger_sync_works_qa_vlm_learning
  AFTER INSERT OR UPDATE ON qa_correction_examples
  FOR EACH ROW
  EXECUTE FUNCTION sync_works_qa_vlm_learning_correction();

-- Backfill prior Works-QA corrections through the same function by touching only
-- their existing updated_at value. The table's own BEFORE UPDATE trigger advances
-- updated_at and the new AFTER UPDATE trigger performs an idempotent upsert.
UPDATE qa_correction_examples
SET updated_at = updated_at
WHERE workflow_type = 'works_qa';

COMMENT ON FUNCTION sync_works_qa_vlm_learning_correction() IS
  'Mirrors Works-QA civil and optical HITL corrections into the universal VLM learning system.';
