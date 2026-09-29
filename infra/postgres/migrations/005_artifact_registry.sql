CREATE TABLE IF NOT EXISTS artifact_registry (
  artifact_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES runtime_tasks(task_id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  bytes BIGINT NOT NULL CHECK (bytes >= 0),
  storage_provider TEXT NOT NULL CHECK (storage_provider IN ('filesystem', 's3')),
  storage_ref TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL DEFAULT 'text/plain',
  retention_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id, task_id, sha256)
);

CREATE INDEX IF NOT EXISTS artifact_registry_case_created_idx ON artifact_registry(case_id, created_at DESC);
