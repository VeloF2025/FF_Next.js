-- Create error tracking tables (mirror of wishlist structure)
-- For bug/error submissions from users

-- Error columns (same structure as wishlist_columns)
CREATE TABLE IF NOT EXISTS error_columns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    position INTEGER NOT NULL DEFAULT 0,
    color VARCHAR(20),
    wip_limit INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default columns (same as wishlist)
INSERT INTO error_columns (name, position, color, wip_limit) VALUES
    ('Reported', 0, '#6B7280', NULL),
    ('Investigating', 1, '#F59E0B', 10),
    ('Fixing', 2, '#3B82F6', 5),
    ('Testing', 3, '#8B5CF6', 3),
    ('Resolved', 4, '#10B981', NULL)
ON CONFLICT (name) DO NOTHING;

-- Error items table (same structure as wishlist_items)
CREATE TABLE IF NOT EXISTS error_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(500) NOT NULL,
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'Reported',
    column_position INTEGER NOT NULL DEFAULT 0,
    priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    effort_estimate VARCHAR(10),
    business_value INTEGER,
    votes INTEGER NOT NULL DEFAULT 0,
    created_by VARCHAR(255),
    created_by_name VARCHAR(255),
    assigned_to VARCHAR(255),
    assigned_to_name VARCHAR(255),
    -- Agent OS Spec fields
    problem_statement TEXT,
    acceptance_criteria TEXT,
    target_module VARCHAR(255),
    test_scenarios TEXT,
    -- Error-specific fields
    steps_to_reproduce TEXT,
    expected_behavior TEXT,
    actual_behavior TEXT,
    browser_info VARCHAR(255),
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Error votes table
CREATE TABLE IF NOT EXISTS error_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES error_items(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    user_name VARCHAR(255),
    vote_date TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(item_id, user_id)
);

-- Error comments table
CREATE TABLE IF NOT EXISTS error_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES error_items(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    user_name VARCHAR(255),
    comment TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Error attachments table
CREATE TABLE IF NOT EXISTS error_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES error_items(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL DEFAULT 'file',
    url TEXT NOT NULL,
    filename VARCHAR(255),
    file_size INTEGER,
    mime_type VARCHAR(100),
    uploaded_by VARCHAR(255) NOT NULL,
    uploaded_by_name VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_error_items_status ON error_items(status);
CREATE INDEX IF NOT EXISTS idx_error_items_created_by ON error_items(created_by);
CREATE INDEX IF NOT EXISTS idx_error_votes_item_id ON error_votes(item_id);
CREATE INDEX IF NOT EXISTS idx_error_comments_item_id ON error_comments(item_id);
CREATE INDEX IF NOT EXISTS idx_error_attachments_item_id ON error_attachments(item_id);
