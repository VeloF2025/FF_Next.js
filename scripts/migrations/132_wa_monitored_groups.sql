-- Migration 132: WhatsApp Monitored Groups
-- Moves group configuration from hardcoded Go map to database
-- Enables UI-based group management from WA Portal

-- Create the monitored groups table
CREATE TABLE IF NOT EXISTS wa_monitored_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_jid VARCHAR(50) UNIQUE NOT NULL,        -- e.g., "120363418298130331@g.us"
    group_name VARCHAR(100) NOT NULL,             -- e.g., "Lawley"
    project_name VARCHAR(100),                    -- e.g., "Lawley" (for DR association)
    group_type VARCHAR(20) NOT NULL DEFAULT 'dr_submission',  -- dr_submission, maintenance, admin
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_wa_monitored_groups_jid ON wa_monitored_groups(group_jid);
CREATE INDEX IF NOT EXISTS idx_wa_monitored_groups_type ON wa_monitored_groups(group_type);
CREATE INDEX IF NOT EXISTS idx_wa_monitored_groups_active ON wa_monitored_groups(is_active);
CREATE INDEX IF NOT EXISTS idx_wa_monitored_groups_project ON wa_monitored_groups(project_name);

-- Add check constraint for valid group types
ALTER TABLE wa_monitored_groups
ADD CONSTRAINT chk_group_type
CHECK (group_type IN ('dr_submission', 'maintenance', 'admin'));

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_wa_monitored_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wa_monitored_groups_updated_at ON wa_monitored_groups;
CREATE TRIGGER trg_wa_monitored_groups_updated_at
    BEFORE UPDATE ON wa_monitored_groups
    FOR EACH ROW
    EXECUTE FUNCTION update_wa_monitored_groups_updated_at();

-- Seed existing groups (matching current hardcoded PROJECTS map in Go bridge)
INSERT INTO wa_monitored_groups (group_jid, group_name, project_name, group_type, description) VALUES
-- DR Submission Groups
('120363418298130331@g.us', 'Lawley', 'Lawley', 'dr_submission', 'Lawley DR submissions'),
('120363421532174586@g.us', 'Mohadin', 'Mohadin', 'dr_submission', 'Mohadin DR submissions'),
('120363408849234743@g.us', 'Mamelodi', 'Mamelodi', 'dr_submission', 'Mamelodi POP1 activations'),
('120363422808656601@g.us', 'Marketing Activations', 'Marketing', 'dr_submission', 'Marketing DR submissions'),

-- Maintenance Groups
('120363424360693693@g.us', 'Mohadin Maintenance', 'Mohadin', 'maintenance', 'Mohadin maintenance photos'),
-- Lawley Maintenance JID to be added via UI after getting from invite link

-- Admin Groups
('120363421664266245@g.us', 'Velo Test', NULL, 'admin', 'Testing and admin commands'),
('120363423864087150@g.us', 'AI Recovery', NULL, 'admin', 'Admin commands and system alerts')

ON CONFLICT (group_jid) DO UPDATE SET
    group_name = EXCLUDED.group_name,
    project_name = EXCLUDED.project_name,
    group_type = EXCLUDED.group_type,
    description = EXCLUDED.description;

-- Add comment for documentation
COMMENT ON TABLE wa_monitored_groups IS 'WhatsApp groups monitored by the unified bridge. Group types: dr_submission (new installations), maintenance (follow-up photos), admin (commands/alerts)';
