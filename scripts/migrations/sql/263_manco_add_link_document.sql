-- Migration 263: Add reference_link and document fields to manco_action_items
ALTER TABLE manco_action_items ADD COLUMN IF NOT EXISTS reference_link TEXT;
ALTER TABLE manco_action_items ADD COLUMN IF NOT EXISTS document_url TEXT;
ALTER TABLE manco_action_items ADD COLUMN IF NOT EXISTS document_name TEXT;
