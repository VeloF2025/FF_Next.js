-- =====================================================
-- Migration 120: Custom Roles System
-- Enables creating, cloning, and deleting custom roles
-- =====================================================

-- 1. custom_roles - Store role metadata (system + custom)
CREATE TABLE IF NOT EXISTS custom_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) UNIQUE NOT NULL,        -- Internal name (lowercase, no spaces)
    display_name VARCHAR(100) NOT NULL,       -- User-friendly display name
    description TEXT,
    color VARCHAR(20) DEFAULT '#6b7280',      -- Badge color for UI
    is_system BOOLEAN DEFAULT FALSE,          -- System roles cannot be deleted
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INT DEFAULT 100,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_custom_roles_name ON custom_roles(name);
CREATE INDEX IF NOT EXISTS idx_custom_roles_active ON custom_roles(is_active);
CREATE INDEX IF NOT EXISTS idx_custom_roles_system ON custom_roles(is_system);

-- 3. Seed system roles (matching existing hardcoded roles)
INSERT INTO custom_roles (name, display_name, description, color, is_system, sort_order) VALUES
    ('super_admin', 'Super Admin', 'Full system access with no restrictions', '#dc2626', TRUE, 1),
    ('admin', 'Administrator', 'Administrative access with most permissions', '#ea580c', TRUE, 2),
    ('manager', 'Manager', 'Project and team management access', '#2563eb', TRUE, 3),
    ('project_manager', 'Project Manager', 'Full project management capabilities', '#7c3aed', TRUE, 4),
    ('site_supervisor', 'Site Supervisor', 'On-site supervision and field management', '#0891b2', TRUE, 5),
    ('technician', 'Field Technician', 'Field work and technical operations', '#059669', TRUE, 6),
    ('contractor', 'Contractor', 'External contractor with limited access', '#d97706', TRUE, 7),
    ('client', 'Client', 'Client portal access only', '#6366f1', TRUE, 8),
    ('viewer', 'Viewer', 'Read-only access across the system', '#6b7280', TRUE, 9)
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    color = EXCLUDED.color,
    is_system = EXCLUDED.is_system,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW();

-- 4. Add role_id foreign key to role_permissions (optional - maintains backward compat)
-- We don't enforce FK constraint to allow string-based lookups for existing code
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS role_id UUID;

-- 5. Backfill role_id from custom_roles
UPDATE role_permissions rp
SET role_id = cr.id
FROM custom_roles cr
WHERE rp.role = cr.name AND rp.role_id IS NULL;

-- 6. Create view for role with permission counts
CREATE OR REPLACE VIEW v_roles_with_stats AS
SELECT
    cr.id,
    cr.name,
    cr.display_name,
    cr.description,
    cr.color,
    cr.is_system,
    cr.is_active,
    cr.sort_order,
    cr.created_at,
    cr.updated_at,
    COUNT(DISTINCT rp.permission_key) as permission_count,
    COUNT(DISTINCT u.id) as user_count
FROM custom_roles cr
LEFT JOIN role_permissions rp ON rp.role = cr.name
LEFT JOIN users u ON u.role = cr.name AND u.is_active = true
GROUP BY cr.id, cr.name, cr.display_name, cr.description, cr.color,
         cr.is_system, cr.is_active, cr.sort_order, cr.created_at, cr.updated_at
ORDER BY cr.sort_order;

-- 7. Function to clone a role
CREATE OR REPLACE FUNCTION clone_role(
    p_source_role VARCHAR,
    p_new_name VARCHAR,
    p_new_display_name VARCHAR,
    p_description TEXT DEFAULT NULL,
    p_created_by UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_new_role_id UUID;
    v_source_exists BOOLEAN;
BEGIN
    -- Check source role exists
    SELECT EXISTS(SELECT 1 FROM custom_roles WHERE name = p_source_role) INTO v_source_exists;
    IF NOT v_source_exists THEN
        RAISE EXCEPTION 'Source role "%" does not exist', p_source_role;
    END IF;

    -- Check new name doesn't exist
    IF EXISTS(SELECT 1 FROM custom_roles WHERE name = p_new_name) THEN
        RAISE EXCEPTION 'Role "%" already exists', p_new_name;
    END IF;

    -- Create new role
    INSERT INTO custom_roles (name, display_name, description, is_system, created_by)
    VALUES (p_new_name, p_new_display_name, COALESCE(p_description, 'Cloned from ' || p_source_role), FALSE, p_created_by)
    RETURNING id INTO v_new_role_id;

    -- Clone permissions
    INSERT INTO role_permissions (role, role_id, permission_key, actions)
    SELECT p_new_name, v_new_role_id, permission_key, actions
    FROM role_permissions
    WHERE role = p_source_role;

    RETURN v_new_role_id;
END;
$$ LANGUAGE plpgsql;

-- 8. Function to delete a role (with safety checks)
CREATE OR REPLACE FUNCTION delete_role(p_role_name VARCHAR)
RETURNS BOOLEAN AS $$
DECLARE
    v_is_system BOOLEAN;
    v_user_count INT;
BEGIN
    -- Check if system role
    SELECT is_system INTO v_is_system FROM custom_roles WHERE name = p_role_name;
    IF v_is_system IS NULL THEN
        RAISE EXCEPTION 'Role "%" does not exist', p_role_name;
    END IF;
    IF v_is_system THEN
        RAISE EXCEPTION 'Cannot delete system role "%"', p_role_name;
    END IF;

    -- Check for users with this role
    SELECT COUNT(*) INTO v_user_count FROM users WHERE role = p_role_name AND is_active = true;
    IF v_user_count > 0 THEN
        RAISE EXCEPTION 'Cannot delete role "%" - % active users have this role', p_role_name, v_user_count;
    END IF;

    -- Delete role permissions first
    DELETE FROM role_permissions WHERE role = p_role_name;

    -- Delete the role
    DELETE FROM custom_roles WHERE name = p_role_name;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 9. Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_custom_roles_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_custom_roles_updated_at ON custom_roles;
CREATE TRIGGER trigger_custom_roles_updated_at
    BEFORE UPDATE ON custom_roles
    FOR EACH ROW
    EXECUTE FUNCTION update_custom_roles_timestamp();
