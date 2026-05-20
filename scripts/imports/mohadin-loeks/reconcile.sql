-- Review queries for loeks_field_mappings after running import.ts.
-- Read-only by default; the apply block at the bottom is commented out.

-- 1. Status distribution
SELECT match_status, COUNT(*) AS n
FROM loeks_field_mappings
GROUP BY match_status
ORDER BY n DESC;

-- 2. Safe to apply: drops with empty ont_serial that the sheet would fill
SELECT s.pon_no, s.dr_number, s.ont_serial AS sheet_serial,
       s.dwelling_label, s.notes_raw,
       d.address, d.status AS drop_status, d.zone_no
FROM loeks_field_mappings s
JOIN drops d ON d.id = s.match_drop_id
WHERE s.match_status = 'new_fill'
  AND s.apply_status IS NULL
ORDER BY s.pon_no, s.dr_number;

-- 3. Conflicts: DB has a different serial than the sheet
SELECT s.pon_no, s.dr_number,
       d.ont_serial AS db_serial,
       s.ont_serial AS sheet_serial,
       s.dwelling_label, s.notes_raw
FROM loeks_field_mappings s
JOIN drops d ON d.id = s.match_drop_id
WHERE s.match_status = 'conflict'
ORDER BY s.pon_no, s.dr_number;

-- 4. Pre-provisions: ONT captured on site, never linked to a DR
SELECT pon_no, property_number, ont_serial, notes_raw, dwelling_label
FROM loeks_field_mappings
WHERE match_status = 'pre_provision'
ORDER BY pon_no, property_number;

-- 5. DR needed: serial captured, but installer flagged that no DR exists yet
SELECT pon_no, property_number, ont_serial, dr_number, notes_raw
FROM loeks_field_mappings
WHERE match_status = 'needs_dr'
ORDER BY pon_no, property_number;

-- 6. DR present in sheet but not in DB (possible typo or wrong PON)
SELECT pon_no, property_number, dr_number, ont_serial, notes_raw, cross_pon_hint
FROM loeks_field_mappings
WHERE match_status = 'dr_not_found'
ORDER BY pon_no, dr_number;

-- 7. Invalid serial format — needs manual inspection
SELECT pon_no, dr_number, ont_serial, notes_raw
FROM loeks_field_mappings
WHERE match_status = 'invalid_serial'
ORDER BY pon_no, dr_number;

-- 8. Backroom / main-house split — verify two-DR-per-property pattern
SELECT pon_no, property_number,
       COUNT(*) FILTER (WHERE dwelling_label = 'MAIN HOUSE') AS main_house,
       COUNT(*) FILTER (WHERE dwelling_label = 'BACK ROOM')  AS back_room,
       array_agg(DISTINCT dr_number) FILTER (WHERE dr_number IS NOT NULL) AS drs
FROM loeks_field_mappings
WHERE dwelling_label IS NOT NULL
GROUP BY pon_no, property_number
ORDER BY pon_no, property_number;

-- ============================================================================
-- APPLY (DO NOT RUN UNTIL REVIEWED).
-- Uncomment, wrap in BEGIN; … COMMIT;, and run after eyeballing #2 above.
-- ============================================================================
-- BEGIN;
--
-- UPDATE drops d
-- SET ont_serial = s.ont_serial,
--     notes = TRIM(BOTH E'\n' FROM
--             COALESCE(d.notes, '') ||
--             E'\nLoeks field PON ' || s.pon_no::text ||
--             COALESCE(' • ' || s.dwelling_label, '') ||
--             COALESCE(' • ' || s.notes_raw, ''))
-- FROM loeks_field_mappings s
-- WHERE s.match_status = 'new_fill'
--   AND s.apply_status IS NULL
--   AND s.match_drop_id = d.id;
--
-- UPDATE loeks_field_mappings
-- SET apply_status = 'applied', applied_at = NOW()
-- WHERE match_status = 'new_fill' AND apply_status IS NULL;
--
-- -- Sanity check (should be 0)
-- SELECT COUNT(*) FROM loeks_field_mappings
-- WHERE match_status = 'new_fill' AND apply_status IS NULL;
--
-- COMMIT;
