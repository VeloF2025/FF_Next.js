-- Rollback for migration 401: remove the counted-rows view and the two group flags.
-- NOTE: callers repointed at qa_photo_reviews_counted must be reverted to
--       `FROM qa_photo_reviews WHERE project != 'Marketing Activations'` BEFORE
--       running this, or those queries will error on the missing view.

DROP VIEW IF EXISTS qa_photo_reviews_counted;

ALTER TABLE wa_monitored_groups
  DROP COLUMN IF EXISTS counts_as_installation,
  DROP COLUMN IF EXISTS send_ack;
