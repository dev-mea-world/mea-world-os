CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  token_hash char(64) NOT NULL UNIQUE,
  actor_fingerprint char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS sessions_active_token_idx
  ON sessions (token_hash, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  fingerprint char(64) PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workers (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'stale', 'revoked')),
  boot_id uuid NOT NULL,
  last_sequence bigint NOT NULL CHECK (last_sequence >= 0),
  software_version text NOT NULL,
  active_run_id uuid,
  last_heartbeat_at timestamptz NOT NULL,
  aggregate_version integer NOT NULL DEFAULT 1 CHECK (aggregate_version > 0),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS worker_nonces (
  worker_id text NOT NULL,
  nonce uuid NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (worker_id, nonce)
);

CREATE INDEX IF NOT EXISTS worker_nonces_seen_idx ON worker_nonces (seen_at);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  objective text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'ready', 'leased', 'running', 'waiting_tool', 'waiting_human', 'verifying',
    'succeeded', 'failed_retryable', 'failed_terminal', 'cancelled', 'superseded'
  )),
  priority integer NOT NULL DEFAULT 0,
  risk text NOT NULL DEFAULT 'low' CHECK (risk IN ('low', 'medium', 'high')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL UNIQUE,
  assigned_worker_id text REFERENCES workers(id),
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 20),
  aggregate_version integer NOT NULL DEFAULT 1 CHECK (aggregate_version > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (status IN ('leased', 'running') AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND assigned_worker_id IS NOT NULL)
    OR status NOT IN ('leased', 'running')
  )
);

CREATE INDEX IF NOT EXISTS tasks_lease_queue_idx
  ON tasks (priority DESC, created_at ASC)
  WHERE status IN ('ready', 'failed_retryable', 'leased', 'running');

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks(id),
  worker_id text NOT NULL REFERENCES workers(id),
  attempt integer NOT NULL CHECK (attempt > 0),
  runtime text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'leased', 'running', 'succeeded', 'failed_retryable', 'failed_terminal', 'interrupted', 'cancelled'
  )),
  lease_token uuid NOT NULL,
  runtime_thread_id text,
  output jsonb,
  error_summary text,
  started_at timestamptz,
  completed_at timestamptz,
  aggregate_version integer NOT NULL DEFAULT 1 CHECK (aggregate_version > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (task_id, attempt)
);

CREATE TABLE IF NOT EXISTS run_checkpoints (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs(id),
  sequence integer NOT NULL CHECK (sequence > 0),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS proposals (
  id uuid PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  target text NOT NULL,
  operation text NOT NULL,
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk text NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
  proposal_hash char(64) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  aggregate_version integer NOT NULL DEFAULT 1 CHECK (aggregate_version > 0),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS proposal_decisions (
  id uuid PRIMARY KEY,
  proposal_id uuid NOT NULL UNIQUE REFERENCES proposals(id),
  decision text NOT NULL CHECK (decision IN ('approve', 'reject')),
  proposal_hash char(64) NOT NULL,
  actor text NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notion_sample_runs (
  id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('sampled', 'failed')),
  sampled_count integer NOT NULL DEFAULT 0 CHECK (sampled_count >= 0),
  truncated boolean NOT NULL DEFAULT true,
  next_cursor text,
  error_code text,
  aggregate_version integer NOT NULL DEFAULT 1 CHECK (aggregate_version > 0),
  sampled_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS source_objects (
  source text NOT NULL,
  external_id text NOT NULL,
  object_type text NOT NULL,
  url text,
  last_edited_at timestamptz,
  content_hash char(64) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_fetched_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source, external_id)
);

CREATE TABLE IF NOT EXISTS capability_requests (
  id uuid PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  capability text NOT NULL,
  reason text NOT NULL,
  minimum_permission text NOT NULL,
  setup_instructions text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  type text NOT NULL,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  aggregate_version integer NOT NULL CHECK (aggregate_version > 0),
  task_id uuid REFERENCES tasks(id),
  run_id uuid REFERENCES runs(id),
  proposal_id uuid REFERENCES proposals(id),
  correlation_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (aggregate_type, aggregate_id, aggregate_version)
);

CREATE INDEX IF NOT EXISTS events_recent_idx ON events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS events_correlation_idx ON events (correlation_id);

CREATE OR REPLACE FUNCTION prevent_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'events are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS events_append_only_update ON events;
CREATE TRIGGER events_append_only_update
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION prevent_event_mutation();
