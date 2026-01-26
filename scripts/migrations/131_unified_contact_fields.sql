-- Migration 131: Add contact fields to dr_photo_unified_reviews
--
-- Purpose: Store subscriber contact info directly in unified table
-- instead of querying BOSS API/maintenance_tickets live on every request.
--
-- This follows the UNIFIED architecture principle:
-- ALL DR data should be stored in dr_photo_unified_reviews during processing,
-- not queried from multiple sources at runtime.

-- Subscriber contact from 1Map (populated during process-new-dr)
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS subscriber_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS subscriber_phone VARCHAR(50),
ADD COLUMN IF NOT EXISTS subscriber_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS subscriber_language VARCHAR(50);

-- QContact/Maintenance contact (populated during process-new-dr)
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS qcontact_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS qcontact_phone VARCHAR(50),
ADD COLUMN IF NOT EXISTS qcontact_email VARCHAR(255);

-- Signup agent and installer from 1Map
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS signup_agent VARCHAR(255),
ADD COLUMN IF NOT EXISTS installer_name VARCHAR(255);

-- Add comments for documentation
COMMENT ON COLUMN dr_photo_unified_reviews.subscriber_name IS 'Contact name from 1Map (nme + srnme)';
COMMENT ON COLUMN dr_photo_unified_reviews.subscriber_phone IS 'Contact phone from 1Map (cell01/whatsapp)';
COMMENT ON COLUMN dr_photo_unified_reviews.subscriber_email IS 'Contact email from 1Map (email)';
COMMENT ON COLUMN dr_photo_unified_reviews.subscriber_language IS 'Preferred language from 1Map (lang)';
COMMENT ON COLUMN dr_photo_unified_reviews.qcontact_name IS 'Client name from QContact/maintenance_tickets';
COMMENT ON COLUMN dr_photo_unified_reviews.qcontact_phone IS 'Client phone from QContact/maintenance_tickets';
COMMENT ON COLUMN dr_photo_unified_reviews.qcontact_email IS 'Client email from QContact/maintenance_tickets';
COMMENT ON COLUMN dr_photo_unified_reviews.signup_agent IS 'Signup agent from 1Map (fieldnme2)';
COMMENT ON COLUMN dr_photo_unified_reviews.installer_name IS 'Installer name from 1Map (fieldnme1)';
