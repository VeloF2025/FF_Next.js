/**
 * Migration 174: Serial Duplicate Indexes
 *
 * Purpose: Add indexes for fast duplicate serial lookups on dr_photo_unified_reviews.
 * Used by dr-acknowledgment API to warn when the same ONT/UPS serial appears on multiple DRs.
 *
 * Date: 2026-02-10
 */

CREATE INDEX IF NOT EXISTS idx_unified_ont_serial_upper
  ON dr_photo_unified_reviews (UPPER(ont_serial_scanned));

CREATE INDEX IF NOT EXISTS idx_unified_ups_serial_upper
  ON dr_photo_unified_reviews (UPPER(ups_serial_scanned));

CREATE INDEX IF NOT EXISTS idx_unified_oes_serial_upper
  ON dr_photo_unified_reviews (UPPER(oes_serial));
