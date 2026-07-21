-- scripts/migrations/sql/447_worksqa_vlm_backfill_pending.sql
-- Works QA: normalise never-scored placeholder VLM markers to pending.
--
-- Before the works-qa VLM scoring step existed, the QField sync stamped every
-- unscored photo with {valid:false, confidence:0, feedback:'Synced from QField'}
-- (plus a handful of sibling fallbacks). The Works-QA UI renders valid:false as a
-- red "VLM fail", so ~22k genuinely-unscored photos looked failed. The new scorer
-- treats "has a boolean valid" as "already scored" and would otherwise skip them
-- forever.
--
-- This one-time backfill rewrites those placeholder entries (matched by their
-- exact fallback feedback strings) to the pending marker {scored:false}. The UI
-- then shows a neutral "Awaiting AI", and works-qa-vlm-score picks them up (no
-- boolean `valid` -> eligible) and fills real scores over subsequent cron runs.
-- Genuine VLM verdicts (descriptive feedback) are left untouched -- e.g. the
-- "This image is not related to any civil construction step..." verdict is not in
-- the string set below.
--
-- Idempotent: converted entries lose their `valid`/`feedback` keys, so a re-run
-- matches nothing. Verified via dry-run: 22,208 entries across 6,379 rows.

UPDATE pole_qa_photos p
SET vlm_results = (
  SELECT jsonb_object_agg(
    e.key,
    CASE
      WHEN NOT (e.value ? 'scored')
       AND e.value->>'valid' = 'false'
       AND e.value->>'feedback' IN (
         'Synced from QField',
         'Synced from QField (optical)',
         'Historical photo',
         'Historical photo (qfield)',
         'Historical photo (local)',
         'AI validation unavailable — manual review required',
         'VLM validation failed — manual review required'
       )
      THEN '{"scored": false}'::jsonb
      ELSE e.value
    END
  )
  FROM jsonb_each(p.vlm_results) AS e(key, value)
)
WHERE p.vlm_results IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_each(p.vlm_results) AS e(key, value)
    WHERE NOT (e.value ? 'scored')
      AND e.value->>'valid' = 'false'
      AND e.value->>'feedback' IN (
        'Synced from QField',
        'Synced from QField (optical)',
        'Historical photo',
        'Historical photo (qfield)',
        'Historical photo (local)',
        'AI validation unavailable — manual review required',
        'VLM validation failed — manual review required'
      )
  );
