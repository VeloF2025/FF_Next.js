/**
 * Migration 087: Add WhatsApp Message Threading Support
 *
 * Purpose: Store original WhatsApp message ID for threaded feedback replies
 * Date: 2026-01-19
 * Author: PAI System
 *
 * When a user submits a DR to WhatsApp, the Go Bridge captures the message ID.
 * This migration adds columns to store that ID so QA feedback can be sent
 * as a threaded reply to the original submission.
 *
 * Threading Requirements (Go Bridge):
 * - wa_message_id: Original message stanza ID for QuotedMessage
 * - wa_sender_jid: Original sender JID (may be LID format)
 * - wa_original_text: Original message text (for QuotedMessage content)
 */

-- ====================================================================================
-- 1. ADD WHATSAPP THREADING COLUMNS TO dr_photo_unified_reviews
-- ====================================================================================

-- Original WhatsApp message ID (for threading replies)
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS wa_message_id VARCHAR(100);

-- Original sender JID (may be LID format like 155228775178345@lid)
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS wa_sender_jid VARCHAR(100);

-- Original message text (for QuotedMessage display in reply)
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS wa_original_text TEXT;

-- WhatsApp group JID where message was sent
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS wa_group_jid VARCHAR(100);

-- Timestamp when WhatsApp message was received
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS wa_received_at TIMESTAMP WITH TIME ZONE;

-- Comment for context
COMMENT ON COLUMN dr_photo_unified_reviews.wa_message_id IS 'Original WhatsApp message ID (stanza ID) for threaded replies';
COMMENT ON COLUMN dr_photo_unified_reviews.wa_sender_jid IS 'Original sender JID (may be LID format for modern WhatsApp)';
COMMENT ON COLUMN dr_photo_unified_reviews.wa_original_text IS 'Original message text for QuotedMessage in replies';
COMMENT ON COLUMN dr_photo_unified_reviews.wa_group_jid IS 'WhatsApp group JID where DR was submitted';
COMMENT ON COLUMN dr_photo_unified_reviews.wa_received_at IS 'Timestamp when WhatsApp message was received';

-- ====================================================================================
-- 2. CREATE INDEX FOR LOOKUP BY MESSAGE ID
-- ====================================================================================

CREATE INDEX IF NOT EXISTS idx_unified_wa_message_id
  ON dr_photo_unified_reviews(wa_message_id)
  WHERE wa_message_id IS NOT NULL;

-- ====================================================================================
-- 3. VERIFICATION
-- ====================================================================================

DO $$
DECLARE
  col_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_name = 'dr_photo_unified_reviews'
    AND column_name IN ('wa_message_id', 'wa_sender_jid', 'wa_original_text', 'wa_group_jid', 'wa_received_at');

  IF col_count >= 5 THEN
    RAISE NOTICE 'Migration 087: WhatsApp threading columns added successfully (% columns)', col_count;
  ELSE
    RAISE WARNING 'Migration 087: Only % of 5 expected columns found', col_count;
  END IF;
END $$;

-- ====================================================================================
-- 4. MIGRATION SUMMARY
-- ====================================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '====================================================================';
  RAISE NOTICE 'Migration 087: WhatsApp Message Threading - COMPLETE';
  RAISE NOTICE '====================================================================';
  RAISE NOTICE 'Added columns to dr_photo_unified_reviews:';
  RAISE NOTICE '  - wa_message_id: Original message ID for threading';
  RAISE NOTICE '  - wa_sender_jid: Original sender JID (LID support)';
  RAISE NOTICE '  - wa_original_text: Message text for QuotedMessage';
  RAISE NOTICE '  - wa_group_jid: WhatsApp group JID';
  RAISE NOTICE '  - wa_received_at: Message receive timestamp';
  RAISE NOTICE '';
  RAISE NOTICE 'Next Steps:';
  RAISE NOTICE '  1. Update Go Bridge to populate these fields on DR receive';
  RAISE NOTICE '  2. Update send-feedback API to pass quotedMessageId';
  RAISE NOTICE '  3. Test threaded replies in WhatsApp groups';
  RAISE NOTICE '====================================================================';
END $$;
