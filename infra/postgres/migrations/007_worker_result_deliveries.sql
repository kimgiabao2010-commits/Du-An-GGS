-- Raw transport receipt and prepared envelope are not evidence. Only the final
-- result/frontier transaction can establish evidence and a commit ACK.
CREATE TABLE IF NOT EXISTS worker_result_deliveries (
  task_id TEXT PRIMARY KEY REFERENCES runtime_tasks(task_id),
  delivery_id TEXT NOT NULL UNIQUE CHECK (delivery_id ~ '^[a-f0-9]{64}$'),
  worker_id TEXT NOT NULL,
  case_id TEXT NOT NULL REFERENCES cases(case_id),
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  prepared_payload JSONB,
  prepared_hash TEXT CHECK (prepared_hash ~ '^[a-f0-9]{64}$'),
  committed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  CHECK ((prepared_payload IS NULL) = (prepared_hash IS NULL)),
  CHECK (committed_at IS NULL OR prepared_payload IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS worker_result_deliveries_pending_idx
  ON worker_result_deliveries(received_at) WHERE committed_at IS NULL;
