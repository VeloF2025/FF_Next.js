-- Wishlist Feature Database Schema
-- Run this migration to create wishlist tables in Neon PostgreSQL

-- Drop existing tables if they exist (for development)
DROP TABLE IF EXISTS wishlist_comments CASCADE;
DROP TABLE IF EXISTS wishlist_votes CASCADE;
DROP TABLE IF EXISTS wishlist_items CASCADE;
DROP TABLE IF EXISTS wishlist_columns CASCADE;

-- Create wishlist columns configuration
CREATE TABLE wishlist_columns (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    position INTEGER NOT NULL,
    color VARCHAR(7),
    wip_limit INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(name)
);

-- Create main wishlist items table
CREATE TABLE wishlist_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'Backlog',
    column_position INTEGER DEFAULT 0,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    effort_estimate VARCHAR(10) CHECK (effort_estimate IN ('XS', 'S', 'M', 'L', 'XL')),
    business_value INTEGER CHECK (business_value BETWEEN 1 AND 10),
    votes INTEGER DEFAULT 0,
    created_by VARCHAR(255),
    created_by_name VARCHAR(255),
    assigned_to VARCHAR(255),
    assigned_to_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create votes tracking table
CREATE TABLE wishlist_votes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    item_id UUID REFERENCES wishlist_items(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    user_name VARCHAR(255),
    vote_date TIMESTAMP DEFAULT NOW(),
    UNIQUE(item_id, user_id)
);

-- Create comments table
CREATE TABLE wishlist_comments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    item_id UUID REFERENCES wishlist_items(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    user_name VARCHAR(255),
    comment TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_wishlist_items_status ON wishlist_items(status);
CREATE INDEX idx_wishlist_items_priority ON wishlist_items(priority);
CREATE INDEX idx_wishlist_items_created_by ON wishlist_items(created_by);
CREATE INDEX idx_wishlist_votes_item_id ON wishlist_votes(item_id);
CREATE INDEX idx_wishlist_votes_user_id ON wishlist_votes(user_id);
CREATE INDEX idx_wishlist_comments_item_id ON wishlist_comments(item_id);

-- Insert default Kanban columns
INSERT INTO wishlist_columns (name, position, color, wip_limit) VALUES
('Backlog', 1, '#6B7280', NULL),
('Under Review', 2, '#EAB308', 10),
('Approved', 3, '#3B82F6', 5),
('In Progress', 4, '#8B5CF6', 3),
('Testing', 5, '#F97316', 3),
('Completed', 6, '#10B981', NULL);

-- Insert sample wishlist items (optional - remove in production)
INSERT INTO wishlist_items (title, description, status, priority, effort_estimate, business_value, votes, created_by, created_by_name) VALUES
('Dark Mode Support', 'Implement dark mode theme across the entire application', 'Under Review', 'high', 'M', 8, 15, 'user_2abc123', 'Louis'),
('Export Reports to PDF', 'Allow users to export all reports as PDF documents', 'Approved', 'medium', 'S', 6, 12, 'user_2def456', 'Hein'),
('Mobile Application', 'Native mobile apps for iOS and Android', 'Backlog', 'low', 'XL', 9, 25, 'user_2ghi789', 'Boris'),
('Bulk Import Feature', 'CSV/Excel bulk import for contractors and projects', 'In Progress', 'high', 'L', 7, 8, 'user_2abc123', 'Louis'),
('API Documentation', 'Complete OpenAPI documentation for all endpoints', 'Testing', 'medium', 'M', 5, 6, 'user_2def456', 'Hein');

-- Grant permissions (adjust as needed)
GRANT ALL ON wishlist_columns TO neondb_owner;
GRANT ALL ON wishlist_items TO neondb_owner;
GRANT ALL ON wishlist_votes TO neondb_owner;
GRANT ALL ON wishlist_comments TO neondb_owner;