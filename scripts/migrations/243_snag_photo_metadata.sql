-- Migration 243: Add GPS coordinates and photo timestamp to snag_photos
-- Latitude/longitude come from the TQR PDF grid text per photo slot.
-- pole_reference already exists on the table.

ALTER TABLE snag_photos ADD COLUMN IF NOT EXISTS latitude  NUMERIC;
ALTER TABLE snag_photos ADD COLUMN IF NOT EXISTS longitude NUMERIC;
ALTER TABLE snag_photos ADD COLUMN IF NOT EXISTS photo_timestamp TEXT;

COMMENT ON COLUMN snag_photos.latitude        IS 'GPS latitude extracted from TQR PDF grid text';
COMMENT ON COLUMN snag_photos.longitude       IS 'GPS longitude extracted from TQR PDF grid text';
COMMENT ON COLUMN snag_photos.photo_timestamp IS 'Raw timestamp string from TQR PDF if available';
