CREATE TABLE IF NOT EXISTS cases (
  case_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('NEW','TRIAGING','INVESTIGATING','COLLECTING_EVIDENCE','ANALYZING','WAITING_APPROVAL','RESPONDING','VERIFYING','CLOSED','REOPENED')),
  created_by TEXT NOT NULL,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS case_messages (
  message_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(case_id),
  role TEXT NOT NULL CHECK (role IN ('USER','ASSISTANT','SYSTEM','WORKER')),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS case_messages_case_created_idx ON case_messages(case_id, created_at);

CREATE TABLE IF NOT EXISTS runtime_tasks (
  task_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(case_id),
  idempotency_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  action TEXT NOT NULL,
  parameters JSONB NOT NULL,
  risk_level TEXT NOT NULL,
  context_refs TEXT[] NOT NULL DEFAULT '{}',
  timeout_ms INTEGER NOT NULL CHECK (timeout_ms BETWEEN 1000 AND 300000),
  status TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  assigned_worker TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runtime_tasks_case_created_idx ON runtime_tasks(case_id, created_at);

CREATE TABLE IF NOT EXISTS runtime_executions (
  execution_id BIGSERIAL PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE REFERENCES runtime_tasks(task_id),
  case_id TEXT NOT NULL REFERENCES cases(case_id),
  executor TEXT NOT NULL,
  status TEXT NOT NULL,
  result JSONB NOT NULL,
  evidence_refs TEXT[] NOT NULL DEFAULT '{}',
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS observation_packs (
  observation_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(case_id),
  task_id TEXT NOT NULL REFERENCES runtime_tasks(task_id),
  summary TEXT NOT NULL,
  facts JSONB NOT NULL,
  evidence_refs TEXT[] NOT NULL DEFAULT '{}',
  raw_artifact_ref TEXT,
  original_bytes INTEGER NOT NULL,
  packed_bytes INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_siem_query_runs (
  task_id TEXT PRIMARY KEY REFERENCES runtime_tasks(task_id),
  case_id TEXT NOT NULL REFERENCES cases(case_id),
  adapter TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  source_instance TEXT NOT NULL,
  time_start TIMESTAMPTZ NOT NULL,
  time_end TIMESTAMPTZ NOT NULL,
  result_count INTEGER NOT NULL CHECK (result_count >= 0),
  truncated BOOLEAN NOT NULL,
  redaction_state TEXT NOT NULL,
  queried_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_investigation_evidence (
  evidence_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(case_id),
  task_id TEXT NOT NULL REFERENCES runtime_tasks(task_id),
  event_ids TEXT[] NOT NULL DEFAULT '{}',
  events JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runtime_investigation_verdicts (
  task_id TEXT PRIMARY KEY REFERENCES runtime_tasks(task_id),
  case_id TEXT NOT NULL REFERENCES cases(case_id),
  verdict TEXT NOT NULL CHECK (verdict IN ('INSUFFICIENT_EVIDENCE','BENIGN','SUSPICIOUS','CONFIRMED')),
  evidence_ids TEXT[] NOT NULL,
  policy_version TEXT NOT NULL,
  rationale TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
