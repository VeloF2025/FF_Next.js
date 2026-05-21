-- 361_oes_propagate_serial_to_drops.sql
-- One-time backfill: propagate oes_activations.serial_number into drops.ont_serial
-- where the drops row currently has no serial. Pairs with the runtime fix in
-- src/modules/activate/services/oes/oesImportService.ts which adds the same
-- propagation step to every subsequent OES import.
--
-- Guards:
--   * Only fills drops where ont_serial IS NULL or empty (never overwrites).
--   * Only valid ALCLB+hex serials (skips garbage / Gizzu strings in oes_activations).
--   * Appends a one-line provenance marker to drops.notes ('OES propagation')
--     matching the runtime path in oesImportService.ts; doubles as an
--     idempotency guard if the migration is somehow re-run.
--
-- Expected impact (per cross-reference 2026-05-21):
--   Lawley   ~4,749
--   Mohadin  ~5,185
--   Mamelodi ~2,649
--   Thembisa   ~265
--   ──────  ~12,848 drops affected.

DO $$
DECLARE
  v_updated INT;
BEGIN
  WITH src AS (
    SELECT DISTINCT ON (oa.drop_number)
           oa.drop_number, oa.serial_number
    FROM oes_activations oa
    WHERE oa.serial_number IS NOT NULL
      AND oa.serial_number <> ''
      AND oa.serial_number ~* '^ALCLB[A-F0-9]{7,13}$'
    ORDER BY oa.drop_number, oa.created_at DESC
  )
  UPDATE drops d
  SET ont_serial = src.serial_number,
      notes = TRIM(BOTH E'\n' FROM
              COALESCE(d.notes, '') || E'\nOES propagation'),
      updated_at = NOW()
  FROM src
  WHERE d.drop_number = src.drop_number
    AND (d.ont_serial IS NULL OR d.ont_serial = '')
    AND (d.notes IS NULL OR d.notes NOT LIKE '%OES propagation%');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'OES propagation (361): % drops updated', v_updated;
END $$;
