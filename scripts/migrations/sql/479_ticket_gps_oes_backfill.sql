-- Migration 479: backfill NOC ticket GPS from the daily OES report
--
-- Field techs reported the coordinates on mismatch / no-entry / pre-provision
-- tickets do not match where the ONT actually is, and that the daily OES report
-- is right. They are: every location FibreFlow held came from ONE lineage — the
-- SOW/HLD design import mirrored into `drops`, `sow_drops` and
-- `onemap_properties` (they agree to a metre because they ARE each other), i.e.
-- where the drop was *planned*. `oes_activations.latitude/longitude` are
-- explicit columns in Fibertime's activation sheet, recorded at activation and
-- keyed to the ONT serial — an independent second opinion we never read.
--
-- Measured before writing this (25,285 DRs present in both sources):
--   p50 22.6 m · p90 268 m · 6,295 >=50 m · 3,065 >=200 m · 384 >=1 km
-- On the OLT-mismatch records that generate these tickets: p50 30.8 m, p90
-- 278 m, worst live open ticket 6.1 km out.
--
-- Why these categories specifically: a mismatch / no-entry / PP ticket exists
-- BECAUSE the DR<->serial link is in doubt. Deriving the location from the DR is
-- circular — it inherits the very error under investigation. The OES coordinate
-- is anchored to the serial, which is the fact not in dispute.
--
-- Ranking (PAIR-WISE — a pair always comes from ONE source; mixing a latitude
-- from one with a longitude from another yields a plausible point that is
-- nowhere):
--   1. OES activation matched on drop_number
--   2. OES activation matched on ONT serial  (the DR may be the wrong one)
--   3. `drops` design position                (fill-empty only, never overwrite)
--
-- 13 of 25,414 OES rows (0.05%) carry coordinates from Nepal, Indonesia and
-- Iraq — a few activation devices report a bogus fix. The SA bounding box below
-- rejects them so they fall through to the design coordinate instead of
-- replacing a merely-imprecise point with a continent-scale error. `drops` has
-- zero out-of-bounds rows.
--
-- Open tickets only. Resolved/closed/cancelled tickets are history and are left
-- exactly as they were.
--
-- NOT wrapped in BEGIN/COMMIT: the runner manages the transaction, and a forward
-- file that opens its own leaves the tracker INSERT outside it.

-- --------------------------------------------------------------------------
-- 1. Snapshot every value this migration is about to change.
--    A GPS backfill overwrites data, so the rollback needs the prior value to
--    restore — without this table rollback_479 could only null the column out.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maintenance_tickets_gps_backup_479 (
  ticket_id        uuid PRIMARY KEY,
  gps_coordinates  text,
  captured_at      timestamptz NOT NULL DEFAULT NOW()
);

-- --------------------------------------------------------------------------
-- 2. Resolve the best coordinate per open ticket.
-- --------------------------------------------------------------------------
CREATE TEMP TABLE tmp_479_resolved AS
WITH targets AS (
  SELECT id, dr_number, ont_serial, gps_coordinates
    FROM maintenance_tickets
   WHERE source IN ('olt_mismatch', 'wa_no_oes', 'pp_data')
     AND status NOT IN ('resolved', 'closed', 'cancelled', 'verified')
),
oes_by_dr AS (
  SELECT DISTINCT ON (t.id) t.id AS ticket_id, o.latitude, o.longitude
    FROM targets t
    JOIN oes_activations o
      ON UPPER(o.drop_number) = UPPER(t.dr_number)
     AND o.latitude IS NOT NULL AND o.longitude IS NOT NULL
     AND o.latitude BETWEEN -35 AND -22
     AND o.longitude BETWEEN 16 AND 33
   ORDER BY t.id, o.activation_date DESC NULLS LAST, o.imported_at DESC NULLS LAST, o.id DESC
),
oes_by_serial AS (
  SELECT DISTINCT ON (t.id) t.id AS ticket_id, o.latitude, o.longitude
    FROM targets t
    JOIN oes_activations o
      ON LOWER(o.serial_number) = LOWER(t.ont_serial)
     AND o.latitude IS NOT NULL AND o.longitude IS NOT NULL
     AND o.latitude BETWEEN -35 AND -22
     AND o.longitude BETWEEN 16 AND 33
     -- Placeholder serials resolve to a stranger's address. 50 oes_activations
     -- rows have serial_number = '-' across 50 unrelated DRs ~115km apart, and
     -- 105 olt_mismatch_records carry the same placeholder. Mirrors
     -- isResolvableSerial() in modules/noc/utils/gps.ts.
     AND o.serial_number ~ '[A-Za-z0-9]{6,}'
     AND t.ont_serial ~ '[A-Za-z0-9]{6,}'
   ORDER BY t.id, o.activation_date DESC NULLS LAST, o.imported_at DESC NULLS LAST, o.id DESC
),
design AS (
  -- DISTINCT ON: a DR can appear more than once in `drops` (qfield + sow rows).
  -- Pick deterministically rather than letting the planner choose.
  SELECT DISTINCT ON (t.id) t.id AS ticket_id, d.latitude, d.longitude
    FROM targets t
    JOIN drops d
      ON UPPER(d.drop_number) = UPPER(t.dr_number)
     AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL
   ORDER BY t.id, d.updated_at DESC NULLS LAST, d.id DESC
)
SELECT
  t.id AS ticket_id,
  CASE
    WHEN od.ticket_id IS NOT NULL THEN 'oes_dr'
    WHEN os.ticket_id IS NOT NULL THEN 'oes_serial'
    WHEN dz.ticket_id IS NOT NULL THEN 'design'
  END AS gps_source,
  COALESCE(od.latitude,  os.latitude,  dz.latitude)  AS latitude,
  COALESCE(od.longitude, os.longitude, dz.longitude) AS longitude,
  -- trim_scale, not a bare ::text cast. numeric(10,7) always renders 7 decimals
  -- ("-26.3784200"), while the application writes JS Number stringification and
  -- drops the trailing zeros ("-26.37842"). 5,866 of 25,414 OES rows (23%) end
  -- in a zero, so a bare cast makes the migration and the runtime disagree on
  -- the text for the SAME point — defeating both idempotence guards, which
  -- compare strings: this migration's `IS DISTINCT FROM` and the PP backfill's
  -- `next !== ticket.gps_coordinates`. Every such row would be rewritten on
  -- every run.
  trim_scale(COALESCE(od.latitude,  os.latitude,  dz.latitude))::text || ','
    || trim_scale(COALESCE(od.longitude, os.longitude, dz.longitude))::text AS new_gps
FROM targets t
LEFT JOIN oes_by_dr     od ON od.ticket_id = t.id
LEFT JOIN oes_by_serial os ON os.ticket_id = t.id
LEFT JOIN design        dz ON dz.ticket_id = t.id
WHERE COALESCE(od.ticket_id, os.ticket_id, dz.ticket_id) IS NOT NULL;

-- Deliberately NOT captured here: the ticket's current gps_coordinates. Reading
-- it now and writing it later is a read-then-write across two statements, and
-- under READ COMMITTED each statement takes a fresh snapshot — so a technician
-- editing a targeted ticket in between would make the captured value stale. That
-- desynchronises the snapshot from the rows actually updated, in BOTH
-- directions: a row snapshotted but not updated (rollback then overwrites the
-- technician's edit with the stale value), and a row updated but not
-- snapshotted (rollback cannot restore it at all). Reproduced on PG 15 before
-- this was rewritten. The previous value is now taken from the UPDATE itself
-- in step 3, which cannot drift from what the UPDATE actually changed.

-- COALESCE across three sources resolves each axis independently, so a source
-- with exactly one NULL axis could contribute half a pair — and `new_gps` would
-- silently become NULL (|| propagates), writing nothing. Every source above
-- already requires BOTH axes non-null, which makes that impossible — assert it
-- rather than trusting the reasoning.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM tmp_479_resolved
   WHERE latitude IS NULL OR longitude IS NULL OR gps_source IS NULL OR new_gps IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION 'migration 479: % rows resolved to a partial coordinate', bad;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- 3. Write, snapshotting exactly what the write replaced.
--
--    ONE statement, not two. The snapshot is the UPDATE's own RETURNING, so the
--    set of snapshotted rows and the set of changed rows are identical by
--    construction — they cannot drift the way a separate SELECT-then-UPDATE can
--    (see the note in step 2).
--
--    `maintenance_tickets cur` in the FROM clause is a second scan of the target
--    table on the statement's snapshot, so `cur.gps_coordinates` is the value as
--    it stood BEFORE this UPDATE — that is what gets snapshotted, and it is the
--    same value the guards below test. Verified on PG 15: within one statement
--    `cur.gps_coordinates` returns the old value while `mt.gps_coordinates`
--    returns the new one.
--
--    The design coordinate is fill-empty-only: it is no better than what a
--    ticket already had (it IS what it already had), so overwriting with it
--    would churn rows for nothing. An OES coordinate always wins.
-- --------------------------------------------------------------------------
WITH updated AS (
  UPDATE maintenance_tickets mt
     SET gps_coordinates = r.new_gps,
         updated_at = NOW()
    FROM tmp_479_resolved r, maintenance_tickets cur
   WHERE mt.id = r.ticket_id
     AND cur.id = mt.id
     AND (r.gps_source LIKE 'oes_%' OR cur.gps_coordinates IS NULL OR cur.gps_coordinates = '')
     AND cur.gps_coordinates IS DISTINCT FROM r.new_gps
  RETURNING mt.id AS ticket_id, cur.gps_coordinates AS prev_gps
)
INSERT INTO maintenance_tickets_gps_backup_479 (ticket_id, gps_coordinates)
SELECT ticket_id, prev_gps FROM updated
-- Only on a re-run, which changes nothing: keep the ORIGINAL pre-migration
-- value so rollback still targets it rather than an intermediate.
ON CONFLICT (ticket_id) DO NOTHING;

DROP TABLE IF EXISTS tmp_479_resolved;
