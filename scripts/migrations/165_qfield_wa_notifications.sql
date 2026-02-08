-- Migration 165: QField WhatsApp Notifications
-- Link QField projects to WhatsApp groups for photo rejection/escalation notifications

-- Add WhatsApp group reference to qfield_projects
ALTER TABLE qfield_projects
ADD COLUMN IF NOT EXISTS wa_group_id UUID REFERENCES wa_group_config(id);

-- Create index for lookups
CREATE INDEX IF NOT EXISTS idx_qfield_projects_wa_group ON qfield_projects(wa_group_id);

-- Create QField notification log table
CREATE TABLE IF NOT EXISTS qfield_qa_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_id UUID REFERENCES qfield_photo_validations(id) ON DELETE CASCADE,
  notification_type VARCHAR(50) NOT NULL, -- 'rejection', 'escalation', 'assignment', 'retake_reminder'
  recipient_phone VARCHAR(20),
  recipient_name VARCHAR(255),
  group_jid VARCHAR(100),
  message_content TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'sent', 'failed', 'skipped'
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  sent_by VARCHAR(255), -- Who triggered the notification
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_qfield_notifications_validation ON qfield_qa_notifications(validation_id);
CREATE INDEX IF NOT EXISTS idx_qfield_notifications_type ON qfield_qa_notifications(notification_type);
CREATE INDEX IF NOT EXISTS idx_qfield_notifications_status ON qfield_qa_notifications(status);
CREATE INDEX IF NOT EXISTS idx_qfield_notifications_created ON qfield_qa_notifications(created_at DESC);

-- Insert default message templates for QField QA
INSERT INTO wa_message_templates (template_key, template_name, template_content, category, variables, is_default)
VALUES
  ('qfield_photo_rejected', 'QField Photo Rejected',
   '📸 *Photo Rejected*

Photo: {{photo_name}}
Project: {{project_name}}
Reason: {{rejection_notes}}

Please retake this photo following the quality standards.

_Sent from FibreFlow QA_',
   'qfield', '["photo_name", "project_name", "rejection_notes"]'::jsonb, true),

  ('qfield_photo_escalated', 'QField Photo Escalated',
   '⚠️ *Photo Escalated*

Photo: {{photo_name}}
Project: {{project_name}}
Escalated by: {{escalated_by}}
Reason: {{escalation_reason}}

Please review this photo urgently.

_Sent from FibreFlow QA_',
   'qfield', '["photo_name", "project_name", "escalated_by", "escalation_reason"]'::jsonb, true),

  ('qfield_photos_assigned', 'QField Photos Assigned',
   '📋 *Photos Assigned for Review*

You have been assigned {{photo_count}} photo(s) for QA review.
Project: {{project_name}}
Due: {{due_date}}
Priority: {{priority}}

Please review in FibreFlow: {{review_link}}

_Sent from FibreFlow QA_',
   'qfield', '["photo_count", "project_name", "due_date", "priority", "review_link"]'::jsonb, true)

ON CONFLICT (template_key) DO UPDATE SET
  template_content = EXCLUDED.template_content,
  variables = EXCLUDED.variables,
  updated_at = NOW();
