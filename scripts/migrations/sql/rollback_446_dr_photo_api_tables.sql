-- Rollback 446: dr-photo-api (BOSS) persistence tables
DROP TABLE IF EXISTS dr_sharepoint_sync_log;
DROP TABLE IF EXISTS dr_qa_audit_log;
DROP TABLE IF EXISTS dr_photo_downloads;
