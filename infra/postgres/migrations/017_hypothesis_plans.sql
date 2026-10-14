-- Authority-owned hypothesis receipts are atomic with the corresponding Frontier/decision.
CREATE TABLE IF NOT EXISTS hypothesis_plans (
  plan_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES investigation_runs(run_id),
  case_id TEXT NOT NULL REFERENCES cases(case_id),
  frontier_version INTEGER NOT NULL,
  policy_version TEXT NOT NULL,
  decision_id TEXT NOT NULL REFERENCES next_step_decisions(decision_id),
  payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (run_id, frontier_version),
  FOREIGN KEY (run_id, frontier_version) REFERENCES evidence_frontiers(run_id, version)
);
CREATE INDEX IF NOT EXISTS hypothesis_plans_case_created_idx ON hypothesis_plans(case_id, created_at DESC);

CREATE OR REPLACE FUNCTION reject_hypothesis_plan_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'hypothesis_plan_immutable';
END;
$$;
DROP TRIGGER IF EXISTS hypothesis_plan_no_mutation ON hypothesis_plans;
CREATE TRIGGER hypothesis_plan_no_mutation BEFORE UPDATE OR DELETE ON hypothesis_plans
  FOR EACH ROW EXECUTE FUNCTION reject_hypothesis_plan_mutation();
