CREATE TABLE IF NOT EXISTS manco_action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_item TEXT NOT NULL,
  department TEXT,
  logged_date DATE,
  completion_eta DATE,
  completion_date DATE,
  responsible_person TEXT,
  fibreflow_dev BOOLEAN DEFAULT false,
  fibreflow_module TEXT,
  fibreflow_link TEXT,
  fibreflow_responsible TEXT,
  fibreflow_priority TEXT,
  fibreflow_dev_status TEXT,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  is_ongoing BOOLEAN DEFAULT false,
  source_meeting_id INTEGER REFERENCES meetings(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS manco_action_item_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manco_action_item_id UUID NOT NULL REFERENCES manco_action_items(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manco_ai_status ON manco_action_items(status);
CREATE INDEX IF NOT EXISTS idx_manco_ai_department ON manco_action_items(department);
CREATE INDEX IF NOT EXISTS idx_manco_ai_responsible ON manco_action_items(responsible_person);
CREATE INDEX IF NOT EXISTS idx_manco_comments_item ON manco_action_item_comments(manco_action_item_id);

INSERT INTO manco_action_items (action_item, department, logged_date, completion_eta, responsible_person, fibreflow_dev, fibreflow_module, fibreflow_responsible, fibreflow_dev_status, comment, status) VALUES
('Reporting Template / Scope', 'PMO', '2026-03-20', '2026-04-03', 'Etienne JVR', true, 'Field Operations', 'Hein', 'Scoping', NULL, 'in_progress'),
('Client Reporting Automation', 'PMO', '2026-03-20', '2026-04-10', 'Etienne JVR', true, 'Reporting', 'Hein', NULL, NULL, 'pending'),
('Vehicle Roadmap', 'Finance', '2026-03-20', '2026-04-03', 'Hanro Oosthuizen', false, 'Fleet', NULL, NULL, NULL, 'pending'),
('Accommodation Roadmap', 'Finance', '2026-03-20', '2026-04-03', 'Hanro Oosthuizen', false, NULL, NULL, NULL, 'Awaiting feedback from estate agents.', 'pending'),
('Subscription Roadmap', 'Finance', '2026-03-27', '2026-04-10', 'Hanro Oosthuizen', false, NULL, NULL, NULL, NULL, 'pending'),
('Business Unit Forecast (Planning)', 'Finance', '2026-03-27', '2026-04-10', 'Hanro Oosthuizen', false, NULL, NULL, NULL, NULL, 'pending'),
('Finance Model', 'Finance', '2026-03-20', '2026-04-03', 'Hanro Oosthuizen', false, NULL, NULL, NULL, NULL, 'in_progress'),
('Financial Projections / Budget', 'Finance', '2026-03-20', '2026-04-03', 'Hanro Oosthuizen', false, NULL, NULL, NULL, NULL, 'pending'),
('NOC Ticketing Workshop/Training', 'DevOps', '2026-03-20', '2026-04-03', 'Hein Van Vuuren', true, 'NOC', 'Hein', NULL, NULL, 'pending'),
('SHEQ Training - Wiekus', 'HR', '2026-03-20', '2026-04-10', 'Hein Van Vuuren', true, 'Academy', 'Hein', NULL, NULL, 'pending'),
('SHEQ Compliance - Wiekus', 'HR', '2026-03-20', '2026-03-31', 'Hein Van Vuuren', true, NULL, 'Hein', NULL, 'Follow up with Wiekus', 'pending'),
('Vehicle Tracking', 'Fleet', '2026-03-20', '2026-04-03', 'Jacques Langenhoven', true, 'Fleet', 'Hein', NULL, 'R70 per vehicle per month', 'pending'),
('Vehicle Accessories', 'Fleet', '2026-03-20', '2026-04-04', 'Jacques Langenhoven', false, NULL, NULL, NULL, NULL, 'pending'),
('Asset Inspection Schedule', 'Procurement', '2026-03-20', '2026-04-10', 'Jacques Langenhoven', true, 'Fleet', 'Hein', NULL, NULL, 'pending'),
('Warehousing / Storeman', 'Procurement', '2026-03-20', '2026-04-03', 'Jacques Langenhoven', false, NULL, NULL, NULL, NULL, 'pending'),
('Stock Control Flow', 'Procurement', '2026-03-20', '2026-03-22', 'Jacques Langenhoven', true, 'Procurement', NULL, NULL, 'Delayed due to risk assessment & forecasting', 'in_progress'),
('Stock Take', 'Procurement', '2026-03-20', '2026-03-27', 'Jacques Langenhoven', true, 'Procurement', NULL, NULL, 'Delayed due to risk assessment & forecasting', 'in_progress'),
('Asset / Vehicle Transfer Policy', 'Procurement', '2026-03-20', '2026-04-03', 'Jacques Langenhoven', true, 'Procurement', NULL, NULL, 'Document exists, enforcement', 'pending'),
('Supply Risk Assessment', 'Procurement', '2026-03-20', '2026-03-27', 'Jacques Langenhoven', false, NULL, NULL, NULL, 'First version supplied to Lew on Cable, fuel to follow', 'in_progress'),
('Planning Workflow Scoping', 'Planning', '2026-03-20', '2026-03-31', 'Jaun De Wit', true, 'Field Operations', 'Hein', NULL, 'JDW to present scoping', 'in_progress'),
('Optical Department/Resource Structure', 'Optical', '2026-03-20', '2026-03-27', 'JP Terblanche', false, NULL, NULL, NULL, NULL, 'pending'),
('Resource Responsibility Matrix/KPI', 'Operations', '2026-03-20', '2026-04-30', 'JP Terblanche', true, 'HR / Contracts', NULL, NULL, NULL, 'pending'),
('Conduit', 'Operations', '2026-03-20', '2026-04-30', 'JP Terblanche', true, 'Conduit', 'Lew', NULL, NULL, 'pending'),
('Thembisa Contractor Risk', 'Operations', '2026-03-20', NULL, 'JP Terblanche', false, NULL, NULL, NULL, NULL, 'pending'),
('SHEQ Transfer', 'Operations', '2026-03-20', '2026-04-03', 'JP Terblanche', false, NULL, NULL, NULL, NULL, 'pending'),
('SHEQ - (361)', 'Operations', '2026-03-27', '2026-04-30', 'JP Terblanche', true, NULL, NULL, NULL, NULL, 'pending'),
('Agreements', 'MD', '2026-03-20', '2026-04-03', 'Llewelyn Hofmeyr', true, 'HR', NULL, NULL, NULL, 'pending'),
('Activations Restructure & Targets', 'Business Development - Activations', '2026-03-20', '2026-03-27', 'Marco Devenier', false, NULL, NULL, NULL, 'Send formal announcement', 'pending'),
('Prospective Roadmap', 'Business Development', '2026-03-20', '2026-04-30', 'Marco Devenier', true, 'Conduit', NULL, NULL, NULL, 'pending'),
('Finance Model (Ongoing)', 'Finance', NULL, NULL, 'Hanro Oosthuizen', false, NULL, NULL, NULL, NULL, 'in_progress'),
('NOC Ticketing (Ongoing)', 'System', NULL, NULL, 'Hein Van Vuuren', true, 'NOC', NULL, NULL, NULL, 'in_progress'),
('Planning Automation (Qfield, BOQ)', 'Planning', '2026-03-20', '2026-03-31', 'Jaun De Wit', true, 'Field Operations', 'Hein', NULL, NULL, 'in_progress'),
('Optical Purchase Schedule', 'Optical', '2026-03-20', '2026-03-23', 'JP Terblanche', false, NULL, NULL, NULL, NULL, 'completed'),
('Optical ATP Project Forecast', 'Optical', '2026-03-20', '2026-03-27', 'JP Terblanche', true, NULL, NULL, NULL, NULL, 'completed'),
('Wayleave Department Restructure', 'Business Development', '2026-03-20', '2026-03-27', 'Marco Devenier', false, NULL, NULL, NULL, NULL, 'completed'),
('Activations Training', 'Business Development - Activations', '2026-03-20', '2026-03-27', 'Marco Devenier', true, 'Academy', NULL, NULL, NULL, 'completed'),
('Activation Forecasting', 'Business Development - Activations', '2026-03-20', '2026-03-27', 'Marco Devenier', false, NULL, NULL, NULL, NULL, 'completed');
