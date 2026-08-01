-- Rollback: 473_backfill_unified_reviews_project.sql
--
-- Re-runnable: the only statement is an unconditional DELETE against
-- schema_migrations, which matches nothing on a second run rather than
-- aborting.
--
-- ⚠️ THIS DOES NOT RESTORE THE NULLs, DELIBERATELY.
--
-- 473 filled `dr_photo_unified_reviews.project` where it was NULL, using the
-- value `drops` already held. Re-NULLing those rows would be strictly worse
-- than leaving them:
--
--   * The written value is authoritative — `drops` is the source of truth for a
--     DR's project, and every other writer of this table resolves it the same
--     way. Reverting would reintroduce the "Unknown" grouping bug the migration
--     fixed.
--   * The forward migration is not reversible in a targeted way. It kept no
--     record of which rows it touched, and `project IS NOT NULL` cannot
--     distinguish a row 473 filled from a row a human or another writer filled
--     afterwards. A blanket re-NULL would destroy those too.
--
-- If a specific row's project is genuinely wrong, correct that row directly —
-- and fix it in `drops`, or the next writer will just resolve it back.
--
-- Rolling back the APPLICATION side (the ensure-data.ts insert that now
-- resolves project) needs nothing here: it only affects rows created after the
-- deploy, and reverting the code simply returns those to NULL going forward.

DELETE FROM schema_migrations
 WHERE filename = '473_backfill_unified_reviews_project.sql';
