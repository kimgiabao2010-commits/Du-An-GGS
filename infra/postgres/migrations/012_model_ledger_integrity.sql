ALTER TABLE model_usage ADD COLUMN IF NOT EXISTS payload_hash TEXT CHECK (payload_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE investigation_runs ADD COLUMN IF NOT EXISTS cost_accounting_unknown BOOLEAN NOT NULL DEFAULT false;
-- Legacy token/cost data predates provider-only accounting and must not be certified retroactively.
UPDATE investigation_runs SET cost_accounting_unknown=true WHERE EXISTS
  (SELECT 1 FROM model_usage m WHERE m.case_id=investigation_runs.case_id AND m.payload_hash IS NULL);
