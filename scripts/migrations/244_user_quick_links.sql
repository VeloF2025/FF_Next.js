-- Migration 244: User page visit tracking and pinned quick links
-- Supports dynamic "Tools" section (usage-based) and "Pins" section (manual) on dashboard

-- Track page visits per user for dynamic tool suggestions
CREATE TABLE IF NOT EXISTS user_page_visits (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route VARCHAR(255) NOT NULL,
  visit_count INT NOT NULL DEFAULT 1,
  last_visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, route)
);

CREATE INDEX idx_user_page_visits_top ON user_page_visits (user_id, visit_count DESC);

-- User-pinned quick links (filtered views, specific pages)
CREATE TABLE IF NOT EXISTS user_pinned_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label VARCHAR(100) NOT NULL,
  route VARCHAR(500) NOT NULL,
  icon VARCHAR(50),
  color VARCHAR(50),
  sort_order INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_pinned_links_user ON user_pinned_links (user_id, sort_order);
