-- Migration 253: Add source tracking and visual frame reference to action items
-- Enables distinguishing transcript-extracted vs visual-frame-extracted vs manual items

ALTER TABLE meeting_action_items
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'transcript';

ALTER TABLE meeting_action_items
  ADD COLUMN IF NOT EXISTS visual_frame_ref VARCHAR(255);

COMMENT ON COLUMN meeting_action_items.source IS 'Origin: transcript, visual, manual, merged';
COMMENT ON COLUMN meeting_action_items.visual_frame_ref IS 'Frame timestamp (e.g. 00:14:30) where visual item was found';
