-- Migration 110: System Health Monitoring
-- Comprehensive infrastructure health tracking with auto-recovery logging
-- Created: 2026-01-23

-- ============================================================================
-- Table: system_health_logs
-- Stores periodic health snapshots for all monitored services
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_health_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Overall system status
  overall_status VARCHAR(20) NOT NULL CHECK (overall_status IN ('healthy', 'degraded', 'critical')),

  -- Service statuses (JSONB for flexibility)
  -- Each contains: { serviceName: { status, latencyMs, lastCheck, message? } }
  apps JSONB NOT NULL DEFAULT '{}',           -- {production, staging, dev, backup}
  qfield JSONB NOT NULL DEFAULT '{}',         -- {overall, containers[], syncWebhook}
  ai_services JSONB NOT NULL DEFAULT '{}',    -- {vlm, ollama, qdrant}
  messaging JSONB NOT NULL DEFAULT '{}',      -- {waFeedback, waSenderVPS, waBridgeVPS}
  databases JSONB NOT NULL DEFAULT '{}',      -- {neonProduction, neonDev, qfieldDb}
  infrastructure JSONB NOT NULL DEFAULT '{}', -- {cloudflared, pdfcraft, grafana, portainer}

  -- Summary metrics
  total_services INT NOT NULL DEFAULT 0,
  healthy_count INT NOT NULL DEFAULT 0,
  degraded_count INT NOT NULL DEFAULT 0,
  down_count INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for time-series queries (most common access pattern)
CREATE INDEX IF NOT EXISTS idx_health_logs_timestamp
  ON system_health_logs(timestamp DESC);

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_health_logs_status
  ON system_health_logs(overall_status);

-- Composite index for dashboard queries
CREATE INDEX IF NOT EXISTS idx_health_logs_timestamp_status
  ON system_health_logs(timestamp DESC, overall_status);

-- ============================================================================
-- Table: system_recovery_actions
-- Tracks all auto-recovery attempts and their results
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_recovery_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Service identification
  service_name VARCHAR(100) NOT NULL,
  service_type VARCHAR(50) NOT NULL CHECK (service_type IN ('app', 'container', 'systemd', 'vps', 'database', 'tunnel')),

  -- Action details
  action_taken VARCHAR(100) NOT NULL, -- restart, docker_start, alert_sent, health_check
  previous_status VARCHAR(20) NOT NULL CHECK (previous_status IN ('up', 'down', 'degraded', 'unknown')),
  result_status VARCHAR(20) NOT NULL CHECK (result_status IN ('success', 'failed', 'pending')),

  -- Additional context
  error_message TEXT,
  latency_before_ms INT,
  latency_after_ms INT,

  -- Alert tracking
  alert_sent BOOLEAN DEFAULT FALSE,
  alert_channel VARCHAR(50), -- whatsapp, email, slack

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for recent recovery actions
CREATE INDEX IF NOT EXISTS idx_recovery_timestamp
  ON system_recovery_actions(timestamp DESC);

-- Index for service-specific queries
CREATE INDEX IF NOT EXISTS idx_recovery_service
  ON system_recovery_actions(service_name);

-- Index for filtering by result
CREATE INDEX IF NOT EXISTS idx_recovery_result
  ON system_recovery_actions(result_status);

-- Composite index for service history
CREATE INDEX IF NOT EXISTS idx_recovery_service_timestamp
  ON system_recovery_actions(service_name, timestamp DESC);

-- ============================================================================
-- Table: system_service_config
-- Configuration for monitored services (optional - for dynamic config)
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_service_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Service identification
  service_name VARCHAR(100) NOT NULL UNIQUE,
  service_type VARCHAR(50) NOT NULL,
  display_name VARCHAR(100) NOT NULL,

  -- Health check config
  health_url VARCHAR(500),
  health_method VARCHAR(10) DEFAULT 'GET',
  expected_status INT DEFAULT 200,
  timeout_ms INT DEFAULT 10000,

  -- Recovery config
  auto_recovery_enabled BOOLEAN DEFAULT TRUE,
  recovery_command TEXT, -- systemctl restart X, docker start Y
  max_recovery_attempts INT DEFAULT 3,
  recovery_cooldown_minutes INT DEFAULT 5,

  -- Alert config
  alert_on_failure BOOLEAN DEFAULT TRUE,
  alert_channels JSONB DEFAULT '["whatsapp"]',

  -- Display config
  category VARCHAR(50), -- apps, qfield, ai, messaging, databases, infrastructure
  sort_order INT DEFAULT 100,
  is_critical BOOLEAN DEFAULT FALSE,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for category grouping
CREATE INDEX IF NOT EXISTS idx_service_config_category
  ON system_service_config(category, sort_order);

-- ============================================================================
-- Seed default service configurations
-- ============================================================================

INSERT INTO system_service_config (service_name, service_type, display_name, health_url, category, sort_order, is_critical, recovery_command)
VALUES
  -- FibreFlow App Instances
  ('fibreflow_production', 'app', 'Production', 'http://localhost:3000/api/health', 'apps', 1, TRUE, 'systemctl restart fibreflow-production.service'),
  ('fibreflow_staging', 'app', 'Staging', 'http://localhost:3006/api/health', 'apps', 2, FALSE, 'systemctl restart fibreflow.service'),
  ('fibreflow_dev', 'app', 'Dev', 'http://localhost:3005/api/health', 'apps', 3, FALSE, 'systemctl restart fibreflow-dev.service'),
  ('fibreflow_backup', 'app', 'Backup (VPS)', 'http://72.61.197.178:3005/api/health', 'apps', 4, FALSE, NULL),

  -- QFieldCloud Containers
  ('qfield_nginx', 'container', 'QField Nginx', 'http://localhost:8082/health', 'qfield', 10, FALSE, 'docker start qfieldcloud-nginx-1'),
  ('qfield_app', 'container', 'QField App', 'http://localhost:8000/api/v1/auth/user/', 'qfield', 11, FALSE, 'docker start qfieldcloud-app-1'),
  ('qfield_db', 'container', 'QField DB', NULL, 'qfield', 12, FALSE, 'docker start qfieldcloud-db-1'),
  ('qfield_minio', 'container', 'QField MinIO', 'http://localhost:8009/minio/health/live', 'qfield', 13, FALSE, 'docker start qfieldcloud-minio-1'),
  ('qfield_memcached', 'container', 'QField Memcached', NULL, 'qfield', 14, FALSE, 'docker start qfieldcloud-memcached-1'),

  -- AI/ML Services
  ('vlm_qwen', 'systemd', 'VLM (Qwen3)', 'http://localhost:8100/v1/models', 'ai', 20, TRUE, 'systemctl restart vllm-qwen.service'),
  ('ollama', 'systemd', 'Ollama', 'http://localhost:11434/api/tags', 'ai', 21, FALSE, 'systemctl restart ollama.service'),
  ('qdrant', 'systemd', 'Qdrant', 'http://localhost:6333/healthz', 'ai', 22, FALSE, NULL),

  -- Messaging Services
  ('wa_feedback', 'systemd', 'WA Feedback', 'http://localhost:8092/health', 'messaging', 30, TRUE, 'systemctl restart wa-feedback.service'),
  ('wa_sender_vps', 'vps', 'WA Sender (VPS)', 'http://72.61.197.178:8081/health', 'messaging', 31, TRUE, NULL),
  ('wa_bridge_vps', 'vps', 'WA Bridge (VPS)', 'http://72.61.197.178:8083/health', 'messaging', 32, TRUE, NULL),

  -- Databases
  ('neon_production', 'database', 'Neon Production', NULL, 'databases', 40, TRUE, NULL),
  ('neon_dev', 'database', 'Neon Dev', NULL, 'databases', 41, FALSE, NULL),
  ('qfield_postgres', 'database', 'QField Postgres', NULL, 'databases', 42, FALSE, NULL),

  -- Infrastructure
  ('cloudflared', 'tunnel', 'Cloudflared Tunnel', NULL, 'infrastructure', 50, TRUE, 'systemctl restart cloudflared-tunnel.service'),
  ('pdfcraft', 'systemd', 'PDFCraft', 'http://localhost:3007', 'infrastructure', 51, FALSE, 'systemctl restart pdfcraft.service'),
  ('grafana', 'container', 'Grafana', 'http://localhost:3030/api/health', 'infrastructure', 52, FALSE, NULL),
  ('portainer', 'container', 'Portainer', 'https://localhost:9443/api/status', 'infrastructure', 53, FALSE, NULL)
ON CONFLICT (service_name) DO NOTHING;

-- ============================================================================
-- Views for common queries
-- ============================================================================

-- Latest health status view
CREATE OR REPLACE VIEW v_latest_system_health AS
SELECT
  id,
  timestamp,
  overall_status,
  apps,
  qfield,
  ai_services,
  messaging,
  databases,
  infrastructure,
  total_services,
  healthy_count,
  degraded_count,
  down_count,
  ROUND((healthy_count::DECIMAL / NULLIF(total_services, 0)) * 100, 1) as health_percentage
FROM system_health_logs
ORDER BY timestamp DESC
LIMIT 1;

-- Recent recovery actions view (last 24 hours)
CREATE OR REPLACE VIEW v_recent_recovery_actions AS
SELECT
  id,
  timestamp,
  service_name,
  service_type,
  action_taken,
  previous_status,
  result_status,
  error_message,
  alert_sent,
  EXTRACT(EPOCH FROM (NOW() - timestamp)) / 60 as minutes_ago
FROM system_recovery_actions
WHERE timestamp > NOW() - INTERVAL '24 hours'
ORDER BY timestamp DESC;

-- Service health summary (aggregated stats)
CREATE OR REPLACE VIEW v_service_health_summary AS
SELECT
  sc.service_name,
  sc.display_name,
  sc.category,
  sc.is_critical,
  COUNT(ra.id) FILTER (WHERE ra.timestamp > NOW() - INTERVAL '24 hours') as incidents_24h,
  COUNT(ra.id) FILTER (WHERE ra.timestamp > NOW() - INTERVAL '7 days') as incidents_7d,
  MAX(ra.timestamp) as last_incident,
  COUNT(ra.id) FILTER (WHERE ra.result_status = 'success' AND ra.timestamp > NOW() - INTERVAL '24 hours') as successful_recoveries_24h
FROM system_service_config sc
LEFT JOIN system_recovery_actions ra ON sc.service_name = ra.service_name
GROUP BY sc.service_name, sc.display_name, sc.category, sc.is_critical
ORDER BY sc.category, sc.sort_order;

-- ============================================================================
-- Cleanup function for old data (run periodically)
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_old_health_data()
RETURNS void AS $$
BEGIN
  -- Keep 30 days of health logs
  DELETE FROM system_health_logs
  WHERE timestamp < NOW() - INTERVAL '30 days';

  -- Keep 90 days of recovery actions
  DELETE FROM system_recovery_actions
  WHERE timestamp < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Comments for documentation
-- ============================================================================

COMMENT ON TABLE system_health_logs IS 'Periodic health snapshots of all monitored services';
COMMENT ON TABLE system_recovery_actions IS 'Log of auto-recovery attempts and their results';
COMMENT ON TABLE system_service_config IS 'Configuration for monitored services including health check and recovery settings';
COMMENT ON VIEW v_latest_system_health IS 'Most recent health status snapshot';
COMMENT ON VIEW v_recent_recovery_actions IS 'Recovery actions from the last 24 hours';
COMMENT ON VIEW v_service_health_summary IS 'Aggregated service health statistics';
