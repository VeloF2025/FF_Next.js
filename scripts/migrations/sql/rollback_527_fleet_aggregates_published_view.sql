-- rollback_527_fleet_aggregates_published_view.sql
--
-- Reverses 527_fleet_aggregates_published_view.sql by dropping the published
-- view. The descriptor after the number matches the forward file's exactly — a
-- rollback whose name does not match its migration is how the wrong rollback
-- gets applied silently.
--
-- No aggregate row is deleted, altered, or exposed by this file: dropping a
-- view removes a way of reading rows, never the rows themselves. The base table
-- and every generation it holds are untouched.
--
-- Applying this while a read path is deployed breaks that read path loudly —
-- `relation "fleet_operational_monthly_aggregates_published" does not exist` —
-- which is the intended behaviour. The alternative, a read path silently
-- falling back to the base table, is the exact failure the view exists to
-- prevent: it would begin returning superseded, pre-tightening generations
-- without any error at all.

DROP VIEW IF EXISTS fleet_operational_monthly_aggregates_published;
