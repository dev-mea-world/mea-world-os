CREATE TABLE IF NOT EXISTS telegram_operator (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  chat_id bigint NOT NULL UNIQUE,
  user_id bigint NOT NULL UNIQUE,
  username text CHECK (username IS NULL OR char_length(username) <= 64),
  paired_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at timestamptz,
  aggregate_version integer NOT NULL DEFAULT 1 CHECK (aggregate_version > 0)
);

CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id bigint PRIMARY KEY,
  chat_id bigint NOT NULL,
  user_id bigint NOT NULL,
  message_id bigint NOT NULL,
  command text NOT NULL CHECK (char_length(command) BETWEEN 1 AND 32),
  status text NOT NULL CHECK (status IN ('processed', 'rejected', 'ignored')),
  task_id uuid REFERENCES tasks(id),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS telegram_updates_recent_idx
  ON telegram_updates (created_at DESC);

CREATE INDEX IF NOT EXISTS telegram_updates_task_idx
  ON telegram_updates (task_id)
  WHERE task_id IS NOT NULL;
