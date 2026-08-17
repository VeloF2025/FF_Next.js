CREATE TABLE notification_idempotency_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_idempotency_claims_user_event_key_key
    UNIQUE (user_id, event_type, idempotency_key)
);

CREATE TABLE fleet_parking_check_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_date DATE NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL,
  evaluated_count INTEGER NOT NULL DEFAULT 0,
  violation_count INTEGER NOT NULL DEFAULT 0,
  record_error_count INTEGER NOT NULL DEFAULT 0,
  notification_warning_count INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_parking_check_runs_status_check
    CHECK (status IN ('running','succeeded','partial_failure','failed')),
  CONSTRAINT fleet_parking_check_runs_counts_check CHECK (
    evaluated_count >= 0 AND violation_count >= 0 AND
    record_error_count >= 0 AND notification_warning_count >= 0
  )
);

CREATE INDEX ix_fleet_parking_runs_started_at
  ON fleet_parking_check_runs (started_at DESC);
CREATE INDEX ix_fleet_parking_runs_check_date
  ON fleet_parking_check_runs (check_date, started_at DESC);
