-- Migration 236: Add user notes column to meetings
-- Allows users to add free-text notes to meetings

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS user_notes TEXT;
