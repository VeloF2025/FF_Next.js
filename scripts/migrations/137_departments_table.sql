-- Migration 137: Departments Table
-- Create dynamic department management with reports
-- Date: 2026-01-28

-- Create departments table
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  code VARCHAR(50) NOT NULL,
  description TEXT,
  manager_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_name ON departments(name) WHERE is_active = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_code ON departments(code) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_departments_active ON departments(is_active);
CREATE INDEX IF NOT EXISTS idx_departments_manager ON departments(manager_id);

-- Seed with existing enum values (17 departments)
INSERT INTO departments (name, code, description) VALUES
  ('Management', 'management', 'Executive and senior management'),
  ('Project Management', 'project_management', 'Project planning, coordination, and delivery'),
  ('Field Operations', 'field_operations', 'On-site installation and maintenance crews'),
  ('Network Operations', 'network_operations', 'Network monitoring and operations'),
  ('Engineering', 'engineering', 'Network design and engineering'),
  ('Installation', 'installation', 'Customer premise installations'),
  ('Maintenance', 'maintenance', 'Network and equipment maintenance'),
  ('Quality Assurance', 'quality_assurance', 'Quality control and assurance'),
  ('Technical Support', 'technical_support', 'Technical support and helpdesk'),
  ('Sales', 'sales', 'Sales and business development'),
  ('Customer Service', 'customer_service', 'Customer relations and support'),
  ('Logistics', 'logistics', 'Supply chain and logistics'),
  ('Administration', 'administration', 'Office administration'),
  ('Finance', 'finance', 'Financial management and accounting'),
  ('HR', 'hr', 'Human resources'),
  ('IT', 'it', 'Information technology'),
  ('Safety', 'safety', 'Health, safety, and environmental')
ON CONFLICT DO NOTHING;

-- Add department_id column to staff table if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'staff' AND column_name = 'department_id'
  ) THEN
    ALTER TABLE staff ADD COLUMN department_id UUID REFERENCES departments(id) ON DELETE SET NULL;
    CREATE INDEX idx_staff_department_id ON staff(department_id);
  END IF;
END $$;

-- Migrate existing department string values to department_id
UPDATE staff s
SET department_id = d.id
FROM departments d
WHERE s.department_id IS NULL
  AND s.department IS NOT NULL
  AND (
    LOWER(s.department) = d.code
    OR LOWER(REPLACE(s.department, ' ', '_')) = d.code
    OR LOWER(s.department) = LOWER(d.name)
  );
