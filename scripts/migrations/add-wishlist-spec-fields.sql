-- Add Agent OS spec fields to wishlist_items table
-- Run this migration to add detailed spec fields for feature requests

-- Add new spec columns
ALTER TABLE wishlist_items
ADD COLUMN IF NOT EXISTS problem_statement TEXT,
ADD COLUMN IF NOT EXISTS acceptance_criteria TEXT,
ADD COLUMN IF NOT EXISTS target_module VARCHAR(255),
ADD COLUMN IF NOT EXISTS test_scenarios TEXT;

-- Add comment to document the purpose
COMMENT ON COLUMN wishlist_items.problem_statement IS 'What problem does this feature solve? Context for developers.';
COMMENT ON COLUMN wishlist_items.acceptance_criteria IS 'Clear, testable requirements in markdown list format';
COMMENT ON COLUMN wishlist_items.target_module IS 'Target codebase location (e.g., src/modules/workflow)';
COMMENT ON COLUMN wishlist_items.test_scenarios IS 'Basic test scenarios in markdown list format';
