CREATE TABLE IF NOT EXISTS notion_response_publications (
  id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  source_task_id uuid NOT NULL REFERENCES tasks(id),
  source_run_id uuid NOT NULL UNIQUE REFERENCES runs(id),
  publication_task_id uuid NOT NULL UNIQUE REFERENCES tasks(id),
  status text NOT NULL CHECK (status IN ('planned', 'creating', 'created', 'failed')),
  response_content_hash char(64) NOT NULL,
  response_character_count integer NOT NULL CHECK (response_character_count > 0),
  requested_at timestamptz NOT NULL,
  validation_state text NOT NULL DEFAULT 'ai_generated_unvalidated'
    CHECK (validation_state = 'ai_generated_unvalidated'),
  title text,
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 600),
  page_id text UNIQUE,
  page_url text,
  last_error_code text,
  current_run_id uuid REFERENCES runs(id),
  aggregate_version integer NOT NULL DEFAULT 1 CHECK (aggregate_version > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz,
  CHECK (
    (status = 'created' AND page_id IS NOT NULL AND page_url IS NOT NULL AND completed_at IS NOT NULL)
    OR (status <> 'created' AND page_id IS NULL AND page_url IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS notion_response_publications_status_idx
  ON notion_response_publications (status, updated_at);
