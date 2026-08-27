-- Rollback 532: unlink and deactivate the five QField registrations. Does not touch
-- qfield_photo_validations / pole_qa_photos rows that may already have been ingested.
BEGIN;
DELETE FROM qfield_project_links WHERE qfield_project_id IN (SELECT id FROM qfield_projects WHERE qfield_project_id IN ('d055742d-c5a0-439a-b270-70c63a9e0359','e867b23b-b44a-4655-a645-5040d3a0076c','3e0bf63f-b7c1-4f43-90b4-53d18dba3e6e','f8f51027-4b29-4c76-b4d4-ba8765e930ad','f8e4e754-fbc0-4485-89ce-c72ea9614c98'));
DELETE FROM qfield_projects WHERE qfield_project_id IN ('d055742d-c5a0-439a-b270-70c63a9e0359','e867b23b-b44a-4655-a645-5040d3a0076c','3e0bf63f-b7c1-4f43-90b4-53d18dba3e6e','f8f51027-4b29-4c76-b4d4-ba8765e930ad','f8e4e754-fbc0-4485-89ce-c72ea9614c98');
COMMIT;
