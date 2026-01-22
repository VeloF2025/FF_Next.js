-- Add work_type field to wishlist_items for categorizing type of work
-- Types: feature (new functionality), fix (bug fix), amendment (change), refactor (improvement)

ALTER TABLE wishlist_items
ADD COLUMN IF NOT EXISTS work_type VARCHAR(20) DEFAULT 'feature'
  CHECK (work_type IN ('feature', 'fix', 'amendment', 'refactor'));

COMMENT ON COLUMN wishlist_items.work_type IS
  'Type of work: feature (new), fix (bug), amendment (change), refactor (improvement)';

-- Create index for filtering by work type
CREATE INDEX IF NOT EXISTS idx_wishlist_items_work_type ON wishlist_items(work_type);
