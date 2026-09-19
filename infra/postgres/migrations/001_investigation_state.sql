CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS incidents (
  incident_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS investigation_tasks (
  task_id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(incident_id),
  idempotency_key TEXT NOT NULL UNIQUE,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL,
  indicator_type TEXT NOT NULL,
  indicator_value TEXT NOT NULL,
  range_start TIMESTAMPTZ NOT NULL,
  range_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS siem_query_runs (
  query_run_id BIGSERIAL PRIMARY KEY,
  query_hash TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES investigation_tasks(task_id),
  adapter TEXT NOT NULL,
  source_instance TEXT NOT NULL,
  queried_at TIMESTAMPTZ NOT NULL,
  range_start TIMESTAMPTZ NOT NULL,
  range_end TIMESTAMPTZ NOT NULL,
  result_count INTEGER NOT NULL,
  truncated BOOLEAN NOT NULL,
  status TEXT NOT NULL,
  UNIQUE(query_hash, task_id)
);

CREATE TABLE IF NOT EXISTS investigation_evidence (
  evidence_id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(incident_id),
  task_id TEXT NOT NULL REFERENCES investigation_tasks(task_id),
  event_ids TEXT[] NOT NULL,
  events JSONB NOT NULL,
  provenance JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS investigation_verdicts (
  task_id TEXT PRIMARY KEY REFERENCES investigation_tasks(task_id),
  incident_id TEXT NOT NULL REFERENCES incidents(incident_id),
  verdict TEXT NOT NULL,
  evidence_ids TEXT[] NOT NULL,
  policy_version TEXT NOT NULL,
  rationale TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_requests (
  approval_id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(incident_id),
  action TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  payload JSONB NOT NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_approvals (
  approval_id TEXT NOT NULL REFERENCES approval_requests(approval_id),
  approved_by TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (approval_id, approved_by)
);

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS incident_id TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS event_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS audit_events_event_hash_unique ON audit_events(event_hash) WHERE event_hash IS NOT NULL;
