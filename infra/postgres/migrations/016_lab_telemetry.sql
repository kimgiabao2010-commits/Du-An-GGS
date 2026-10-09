-- Separate lab/replay provenance; never re-label it as Chronicle staging.
CREATE TABLE lab_telemetry_batches (
  batch_hash TEXT PRIMARY KEY CHECK(batch_hash ~ '^[a-f0-9]{64}$'),
  source_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('LAB_LIVE','REPLAY')),
  payload JSONB NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 512000),
  imported_by TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  artifact_ref TEXT NOT NULL
);
CREATE TABLE lab_import_receipts (
  idempotency_key TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  batch_hash TEXT NOT NULL REFERENCES lab_telemetry_batches(batch_hash),
  actor_id TEXT NOT NULL
);
CREATE TABLE lab_query_receipts (
  task_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(case_id),
  run_id TEXT NOT NULL REFERENCES investigation_runs(run_id),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  batch_hash TEXT NOT NULL REFERENCES lab_telemetry_batches(batch_hash),
  payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION gss_lab_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'lab_provenance_immutable'; END $$;
CREATE TRIGGER lab_batch_immutable BEFORE UPDATE OR DELETE ON lab_telemetry_batches FOR EACH ROW EXECUTE FUNCTION gss_lab_immutable();
CREATE TRIGGER lab_import_immutable BEFORE UPDATE OR DELETE ON lab_import_receipts FOR EACH ROW EXECUTE FUNCTION gss_lab_immutable();
CREATE TRIGGER lab_query_immutable BEFORE UPDATE OR DELETE ON lab_query_receipts FOR EACH ROW EXECUTE FUNCTION gss_lab_immutable();
CREATE TRIGGER lab_batch_no_truncate BEFORE TRUNCATE ON lab_telemetry_batches FOR EACH STATEMENT EXECUTE FUNCTION gss_lab_immutable();
CREATE TRIGGER lab_import_no_truncate BEFORE TRUNCATE ON lab_import_receipts FOR EACH STATEMENT EXECUTE FUNCTION gss_lab_immutable();
CREATE TRIGGER lab_query_no_truncate BEFORE TRUNCATE ON lab_query_receipts FOR EACH STATEMENT EXECUTE FUNCTION gss_lab_immutable();
