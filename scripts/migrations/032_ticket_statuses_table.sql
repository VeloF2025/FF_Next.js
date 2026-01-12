-- Migration: 032_ticket_statuses_table.sql
-- Description: Create flexible ticket_statuses reference table with sub-step support
-- Date: 2026-01-12

-- ============================================================================
-- TICKET STATUSES REFERENCE TABLE
-- ============================================================================
-- Flexible status system that allows:
-- 1. Adding new statuses without schema changes
-- 2. Sub-steps within a parent status (e.g., "In Progress" -> "Waiting for Parts")
-- 3. Custom colors and icons per status
-- 4. Ordering for UI display
-- 5. Active/inactive statuses without deletion

CREATE TABLE IF NOT EXISTS ticket_statuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Status identification
    code VARCHAR(50) NOT NULL UNIQUE,           -- Machine-readable: 'in_progress', 'blocked'
    name VARCHAR(100) NOT NULL,                 -- Display name: 'In Progress', 'Blocked'
    description TEXT,                           -- Optional description

    -- Hierarchy for sub-steps
    parent_id UUID REFERENCES ticket_statuses(id) ON DELETE SET NULL,

    -- UI customization
    color VARCHAR(20) DEFAULT '#6B7280',        -- Hex color for badge
    icon VARCHAR(50) DEFAULT 'circle',          -- Lucide icon name

    -- Ordering and state
    display_order INTEGER DEFAULT 0,            -- Sort order in dropdowns
    is_active BOOLEAN DEFAULT true,             -- Soft disable without delete
    is_terminal BOOLEAN DEFAULT false,          -- True for closed/resolved/cancelled

    -- Sync mapping (for QContact integration)
    qcontact_status VARCHAR(50),                -- Maps to QContact status value

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_ticket_statuses_code ON ticket_statuses(code);
CREATE INDEX IF NOT EXISTS idx_ticket_statuses_parent ON ticket_statuses(parent_id);
CREATE INDEX IF NOT EXISTS idx_ticket_statuses_active ON ticket_statuses(is_active) WHERE is_active = true;

-- ============================================================================
-- SEED DEFAULT STATUSES
-- ============================================================================

INSERT INTO ticket_statuses (code, name, description, color, icon, display_order, is_terminal, qcontact_status) VALUES
    ('new', 'New', 'Newly created ticket, not yet reviewed', '#3B82F6', 'circle', 10, false, 'Open'),
    ('triaged', 'Triaged', 'Reviewed and categorized, ready for assignment', '#8B5CF6', 'clipboard-check', 20, false, 'Open'),
    ('assigned', 'Assigned', 'Assigned to a technician or team', '#06B6D4', 'user-check', 30, false, 'In Progress'),
    ('in_progress', 'In Progress', 'Work is actively being done', '#F59E0B', 'loader', 40, false, 'In Progress'),
    ('blocked', 'Blocked', 'Work paused due to external dependency', '#EF4444', 'alert-triangle', 50, false, 'Pending Company'),
    ('resolved', 'Resolved', 'Work completed, awaiting confirmation', '#10B981', 'check-circle', 60, false, 'Solved'),
    ('closed', 'Closed', 'Ticket fully closed and verified', '#6B7280', 'check-circle-2', 70, true, 'Solved'),
    ('cancelled', 'Cancelled', 'Ticket cancelled or duplicate', '#DC2626', 'x-circle', 80, true, 'Cancelled')
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    color = EXCLUDED.color,
    icon = EXCLUDED.icon,
    display_order = EXCLUDED.display_order,
    is_terminal = EXCLUDED.is_terminal,
    qcontact_status = EXCLUDED.qcontact_status,
    updated_at = NOW();

-- ============================================================================
-- ALTER TICKETS TABLE
-- ============================================================================
-- Change status column from enum to VARCHAR to reference the new table

-- Step 1: Drop the enum constraint if it exists
DO $$
BEGIN
    -- Check if column is enum type and convert to varchar
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tickets'
        AND column_name = 'status'
        AND udt_name != 'varchar'
    ) THEN
        -- Add temporary column
        ALTER TABLE tickets ADD COLUMN IF NOT EXISTS status_new VARCHAR(50);

        -- Copy data
        UPDATE tickets SET status_new = status::text;

        -- Drop old column and rename
        ALTER TABLE tickets DROP COLUMN status;
        ALTER TABLE tickets RENAME COLUMN status_new TO status;

        -- Set default
        ALTER TABLE tickets ALTER COLUMN status SET DEFAULT 'new';
    END IF;
END $$;

-- Step 2: Add foreign key constraint (optional - allows flexibility)
-- Note: We use a CHECK constraint instead of FK to allow migration flexibility
-- ALTER TABLE tickets ADD CONSTRAINT fk_tickets_status
--     FOREIGN KEY (status) REFERENCES ticket_statuses(code);

-- Step 3: Create index on status
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);

-- ============================================================================
-- HELPER FUNCTION: Get status display info
-- ============================================================================

CREATE OR REPLACE FUNCTION get_ticket_status_info(p_status_code VARCHAR)
RETURNS TABLE (
    code VARCHAR,
    name VARCHAR,
    color VARCHAR,
    icon VARCHAR,
    is_terminal BOOLEAN,
    qcontact_status VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ts.code,
        ts.name,
        ts.color,
        ts.icon,
        ts.is_terminal,
        ts.qcontact_status
    FROM ticket_statuses ts
    WHERE ts.code = p_status_code AND ts.is_active = true;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Show created statuses
SELECT code, name, color, display_order, is_terminal, qcontact_status
FROM ticket_statuses
ORDER BY display_order;
