CREATE TABLE runtime_result_receipts (
  task_id TEXT PRIMARY KEY REFERENCES runtime_tasks(task_id),
  envelope_hash TEXT NOT NULL CHECK (envelope_hash ~ '^[a-f0-9]{64}$'),
  loop_result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE investigation_runs ADD COLUMN traceparent TEXT;
ALTER TABLE runtime_tasks ADD COLUMN traceparent TEXT;
