CREATE TABLE IF NOT EXISTS investigation_runs (
  run_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(case_id),
  state TEXT NOT NULL CHECK (state IN ('ACTIVE','WAITING_APPROVAL','FINALIZED','BLOCKED','FAILED')),
  frontier_version INTEGER NOT NULL DEFAULT 0 CHECK (frontier_version >= 0),
  depth INTEGER NOT NULL DEFAULT 0 CHECK (depth >= 0),
  max_depth INTEGER NOT NULL CHECK (max_depth BETWEEN 1 AND 100),
  deadline_at TIMESTAMPTZ NOT NULL,
  external_queries_used INTEGER NOT NULL DEFAULT 0 CHECK (external_queries_used >= 0),
  max_external_queries INTEGER NOT NULL CHECK (max_external_queries >= 0),
  cost_micros_used BIGINT NOT NULL DEFAULT 0 CHECK (cost_micros_used >= 0),
  max_cost_micros BIGINT NOT NULL CHECK (max_cost_micros >= 0),
  policy_version TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  row_version BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS investigation_runs_case_updated_idx ON investigation_runs(case_id, updated_at DESC);

ALTER TABLE runtime_tasks ADD COLUMN IF NOT EXISTS run_id TEXT REFERENCES investigation_runs(run_id);
ALTER TABLE runtime_tasks ADD COLUMN IF NOT EXISTS parent_task_id TEXT REFERENCES runtime_tasks(task_id);
ALTER TABLE runtime_tasks ADD COLUMN IF NOT EXISTS action_fingerprint TEXT;
CREATE INDEX IF NOT EXISTS runtime_tasks_run_created_idx ON runtime_tasks(run_id, created_at);

CREATE TABLE IF NOT EXISTS evidence_frontiers (
  run_id TEXT NOT NULL REFERENCES investigation_runs(run_id),
  case_id TEXT NOT NULL REFERENCES cases(case_id),
  version INTEGER NOT NULL CHECK (version > 0),
  observation_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (run_id, version),
  UNIQUE (run_id, observation_id)
);
CREATE INDEX IF NOT EXISTS evidence_frontiers_case_created_idx ON evidence_frontiers(case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS next_step_decisions (
  decision_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES investigation_runs(run_id),
  case_id TEXT NOT NULL REFERENCES cases(case_id),
  frontier_version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('DISPATCH','WAIT_APPROVAL','FINALIZE','BLOCKED')),
  reason_code TEXT NOT NULL,
  action_fingerprint TEXT,
  policy_version TEXT NOT NULL,
  payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (run_id, frontier_version),
  FOREIGN KEY (run_id, frontier_version) REFERENCES evidence_frontiers(run_id, version)
);

CREATE TABLE IF NOT EXISTS control_outbox (
  event_id TEXT PRIMARY KEY,
  aggregate_id TEXT NOT NULL REFERENCES investigation_runs(run_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('NEXT_STEP_DECIDED','TASK_DISPATCH_REQUESTED')),
  payload JSONB NOT NULL,
  event_hash TEXT NOT NULL UNIQUE CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS control_outbox_pending_idx
  ON control_outbox(next_attempt_at, created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS model_usage (
  usage_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(case_id),
  task_id TEXT REFERENCES runtime_tasks(task_id),
  trace_id TEXT NOT NULL,
  model TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL,
  route_reason TEXT NOT NULL,
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  cached_tokens INTEGER NOT NULL CHECK (cached_tokens >= 0),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  retry_count INTEGER NOT NULL CHECK (retry_count >= 0),
  estimated_cost_micros BIGINT NOT NULL CHECK (estimated_cost_micros >= 0),
  status TEXT NOT NULL CHECK (status IN ('SUCCEEDED','FAILED')),
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS model_usage_case_created_idx ON model_usage(case_id, created_at DESC);
