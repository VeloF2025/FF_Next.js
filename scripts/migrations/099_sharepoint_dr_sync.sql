-- Migration 099: SharePoint DR Sync Tracking
-- Tracks folder creation and photo sync status for DR photos to SharePoint
--
-- SharePoint Path: \blitzfibre.com\Velocity_Manco - Documents\Velocity_Quality_Assurance\Regional Home Drops\Projects
-- Structure: Projects/{Project}/{Zone}/{PON}/{Pole}/{DR}/photos
--
-- Status: NEW
-- NLNH Confidence: HIGH

-- Main tracking table
CREATE TABLE IF NOT EXISTS sharepoint_dr_sync (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_number VARCHAR(50) UNIQUE NOT NULL,

  -- Folder hierarchy info (from drops table)
  project VARCHAR(100),
  zone_no INTEGER,
  pon_no INTEGER,
  pole_number VARCHAR(100),

  -- Folder tracking
  folder_created BOOLEAN DEFAULT false,
  folder_created_at TIMESTAMP WITH TIME ZONE,
  folder_id VARCHAR(255),              -- SharePoint item ID for DR folder
  folder_path TEXT,                    -- Full SharePoint path

  -- Parent folder IDs (for faster subsequent operations)
  project_folder_id VARCHAR(255),
  zone_folder_id VARCHAR(255),
  pon_folder_id VARCHAR(255),
  pole_folder_id VARCHAR(255),

  -- Photo sync tracking
  photos_synced BOOLEAN DEFAULT false,
  photos_synced_at TIMESTAMP WITH TIME ZONE,
  photos_count INTEGER DEFAULT 0,
  photos_total INTEGER DEFAULT 0,      -- Total photos available

  -- Error handling
  last_sync_attempt_at TIMESTAMP WITH TIME ZONE,
  sync_error TEXT,
  sync_retry_count INTEGER DEFAULT 0,

  -- Source tracking
  source VARCHAR(50),                  -- 'whatsapp', 'oes_import', 'manual', 'batch'

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sp_sync_drop_number ON sharepoint_dr_sync(drop_number);
CREATE INDEX IF NOT EXISTS idx_sp_sync_project ON sharepoint_dr_sync(project);
CREATE INDEX IF NOT EXISTS idx_sp_sync_folder_created ON sharepoint_dr_sync(folder_created);
CREATE INDEX IF NOT EXISTS idx_sp_sync_photos_synced ON sharepoint_dr_sync(photos_synced);

-- Index for finding DRs that need photo sync (folder created but photos not synced)
CREATE INDEX IF NOT EXISTS idx_sp_sync_pending_photos ON sharepoint_dr_sync(folder_created, photos_synced)
  WHERE folder_created = true AND photos_synced = false;

-- Index for finding DRs with errors
CREATE INDEX IF NOT EXISTS idx_sp_sync_errors ON sharepoint_dr_sync(sync_error)
  WHERE sync_error IS NOT NULL;

-- Comments
COMMENT ON TABLE sharepoint_dr_sync IS 'Tracks SharePoint folder creation and photo sync status for DR photos';
COMMENT ON COLUMN sharepoint_dr_sync.folder_id IS 'SharePoint item ID for the DR folder';
COMMENT ON COLUMN sharepoint_dr_sync.folder_path IS 'Full SharePoint path: /Projects/{Project}/{Zone}/{PON}/{Pole}/{DR}';
COMMENT ON COLUMN sharepoint_dr_sync.source IS 'How sync was triggered: whatsapp, oes_import, manual, batch';
