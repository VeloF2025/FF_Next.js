-- Migration 196: DevOps ticket details extension table
-- Stores DevOps-specific fields linked to maintenance_tickets
-- Run AFTER adding 'dev_ops' to maintenance_tickets type/source ENUMs if applicable

CREATE TABLE IF NOT EXISTS dev_ticket_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES maintenance_tickets(id) ON DELETE CASCADE,
  error_url TEXT,
  stack_trace TEXT,
  affected_module VARCHAR(100),
  environment VARCHAR(20) DEFAULT 'production',
  steps_to_reproduce TEXT,
  browser_info VARCHAR(255),
  github_pr_url TEXT,
  github_branch VARCHAR(255),
  agent_session_id VARCHAR(255),
  agent_status VARCHAR(30) DEFAULT 'pending', -- pending, approved, running, completed, failed
  agent_approved_by UUID REFERENCES users(id),
  agent_approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_dev_ticket_details_ticket ON dev_ticket_details(ticket_id);
CREATE INDEX IF NOT EXISTS idx_dev_ticket_details_status ON dev_ticket_details(agent_status);
