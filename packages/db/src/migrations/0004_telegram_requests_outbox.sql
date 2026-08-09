CREATE TABLE IF NOT EXISTS telegram_change_requests (
  id uuid PRIMARY KEY,
  source_task_id uuid NOT NULL UNIQUE REFERENCES tasks(id),
  chat_id bigint NOT NULL,
  user_id bigint NOT NULL,
  request_prompt text NOT NULL CHECK (char_length(request_prompt) BETWEEN 1 AND 8000),
  objective text,
  implementation_prompt text,
  clarification_question text,
  status text NOT NULL CHECK (status IN (
    'pending_confirmation', 'waiting_clarification', 'enqueued', 'rejected', 'superseded'
  )),
  child_task_id uuid REFERENCES tasks(id),
  aggregate_version integer NOT NULL DEFAULT 1 CHECK (aggregate_version > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (status = 'pending_confirmation' AND objective IS NOT NULL AND implementation_prompt IS NOT NULL)
    OR (status = 'waiting_clarification' AND clarification_question IS NOT NULL)
    OR status IN ('enqueued', 'rejected', 'superseded')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS telegram_one_waiting_clarification_per_chat_idx
  ON telegram_change_requests (chat_id)
  WHERE status = 'waiting_clarification';

CREATE TABLE IF NOT EXISTS telegram_outbox (
  id uuid PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  chat_id bigint NOT NULL,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 12000),
  reply_markup jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'leased', 'sent', 'failed', 'delivery_unknown'
  )),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  lease_token uuid,
  lease_expires_at timestamptz,
  telegram_message_id bigint,
  last_error_code text,
  aggregate_version integer NOT NULL DEFAULT 1 CHECK (aggregate_version > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (status = 'leased' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'leased' AND lease_token IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS telegram_outbox_pending_idx
  ON telegram_outbox (created_at ASC)
  WHERE status = 'pending';
