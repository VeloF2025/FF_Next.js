-- Add MVP Pipeline tracking fields to wishlist_items table
-- Run this migration to enable wishlist → GitHub → Claude Code automation

-- Add GitHub integration columns
ALTER TABLE wishlist_items
ADD COLUMN IF NOT EXISTS github_issue_url VARCHAR(255),
ADD COLUMN IF NOT EXISTS github_pr_url VARCHAR(255);

-- Add build tracking columns
ALTER TABLE wishlist_items
ADD COLUMN IF NOT EXISTS build_status VARCHAR(50) DEFAULT NULL
  CHECK (build_status IS NULL OR build_status IN ('pending', 'building', 'complete', 'failed')),
ADD COLUMN IF NOT EXISTS build_progress INTEGER DEFAULT 0
  CHECK (build_progress >= 0 AND build_progress <= 100),
ADD COLUMN IF NOT EXISTS build_started_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS build_completed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS build_error TEXT;

-- Add creator email for notifications
ALTER TABLE wishlist_items
ADD COLUMN IF NOT EXISTS creator_email VARCHAR(255);

-- Add indexes for pipeline queries
CREATE INDEX IF NOT EXISTS idx_wishlist_items_build_status ON wishlist_items(build_status);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_github_issue ON wishlist_items(github_issue_url);

-- Add comments to document purpose
COMMENT ON COLUMN wishlist_items.github_issue_url IS 'Link to GitHub Issue in mvp-builds repo';
COMMENT ON COLUMN wishlist_items.github_pr_url IS 'Link to Pull Request when MVP build completes';
COMMENT ON COLUMN wishlist_items.build_status IS 'MVP build status: pending, building, complete, failed';
COMMENT ON COLUMN wishlist_items.build_progress IS 'Build progress percentage (0-100)';
COMMENT ON COLUMN wishlist_items.build_started_at IS 'When the MVP build started';
COMMENT ON COLUMN wishlist_items.build_completed_at IS 'When the MVP build completed or failed';
COMMENT ON COLUMN wishlist_items.build_error IS 'Error message if build failed';
COMMENT ON COLUMN wishlist_items.creator_email IS 'Email address for build completion notifications';

-- Create MVP builds log table for tracking individual build attempts
CREATE TABLE IF NOT EXISTS wishlist_mvp_builds (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    wishlist_item_id UUID REFERENCES wishlist_items(id) ON DELETE CASCADE,
    github_issue_number INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'building', 'complete', 'failed', 'cancelled')),
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    features_total INTEGER DEFAULT 0,
    features_completed INTEGER DEFAULT 0,
    harness_run_id VARCHAR(255),
    error_message TEXT,
    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index for querying builds by wishlist item
CREATE INDEX IF NOT EXISTS idx_mvp_builds_wishlist_item ON wishlist_mvp_builds(wishlist_item_id);
CREATE INDEX IF NOT EXISTS idx_mvp_builds_status ON wishlist_mvp_builds(status);

-- Grant permissions
GRANT ALL ON wishlist_mvp_builds TO neondb_owner;
