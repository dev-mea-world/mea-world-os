CREATE TABLE IF NOT EXISTS git_publications (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL UNIQUE REFERENCES tasks(id),
  current_run_id uuid NOT NULL REFERENCES runs(id),
  current_worker_id text NOT NULL REFERENCES workers(id),
  remote text NOT NULL CHECK (
    char_length(remote) BETWEEN 1 AND 128
    AND remote ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  ),
  target_branch text NOT NULL CHECK (
    char_length(target_branch) BETWEEN 12 AND 255
    AND target_branch ~ '^automation/[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$'
    AND position('..' in target_branch) = 0
    AND position('//' in target_branch) = 0
    AND position('@{' in target_branch) = 0
    AND right(target_branch, 1) <> '.'
    AND target_branch !~ '(^|/)[^/]*[.]lock(/|$)'
  ),
  base_sha varchar(64) NOT NULL CHECK (base_sha ~ '^[0-9a-f]{40,64}$'),
  tree_sha varchar(64) CHECK (tree_sha IS NULL OR tree_sha ~ '^[0-9a-f]{40,64}$'),
  commit_sha varchar(64) CHECK (commit_sha IS NULL OR commit_sha ~ '^[0-9a-f]{40,64}$'),
  remote_sha varchar(64) CHECK (remote_sha IS NULL OR remote_sha ~ '^[0-9a-f]{40,64}$'),
  stage text NOT NULL CHECK (stage IN ('planned', 'committed', 'pushed', 'verified', 'no_changes')),
  last_error_code text CHECK (
    last_error_code IS NULL
    OR (
      char_length(last_error_code) BETWEEN 1 AND 128
      AND last_error_code ~ '^[a-z0-9][a-z0-9._-]*$'
    )
  ),
  retryable boolean,
  aggregate_version integer NOT NULL DEFAULT 1 CHECK (aggregate_version > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((last_error_code IS NULL) = (retryable IS NULL)),
  CHECK (
    (stage IN ('planned', 'no_changes') AND tree_sha IS NULL AND commit_sha IS NULL AND remote_sha IS NULL)
    OR (stage = 'committed' AND tree_sha IS NOT NULL AND commit_sha IS NOT NULL AND remote_sha IS NULL)
    OR (stage = 'pushed' AND tree_sha IS NOT NULL AND commit_sha IS NOT NULL AND remote_sha IS NOT NULL)
    OR (
      stage = 'verified'
      AND tree_sha IS NOT NULL
      AND commit_sha IS NOT NULL
      AND remote_sha = commit_sha
    )
  )
);

CREATE INDEX IF NOT EXISTS git_publications_current_run_idx
  ON git_publications (current_run_id);
