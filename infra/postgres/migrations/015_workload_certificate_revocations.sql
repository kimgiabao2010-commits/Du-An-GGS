-- Deny-only certificate authority: withdrawals cannot be undone by a pin-file rollback.
CREATE TABLE IF NOT EXISTS workload_revocation_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0)
);
INSERT INTO workload_revocation_state(singleton,revision) VALUES(true,0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS workload_certificate_revocations (
  fingerprint text PRIMARY KEY CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
  revocation_id uuid NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 1 AND 256),
  request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  workload_id text NOT NULL CHECK(workload_id IN ('command-center','ui-gateway','cli-worker-agent','ide-worker-agent','siem-worker-agent')),
  reason_hash text NOT NULL CHECK(reason_hash ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL CHECK(length(actor_id) BETWEEN 1 AND 2048),
  revision bigint NOT NULL UNIQUE CHECK(revision>0),
  revoked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE FUNCTION immutable_workload_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'workload_revocation_immutable'; END $$;
DROP TRIGGER IF EXISTS immutable_workload_revocation ON workload_certificate_revocations;
CREATE TRIGGER immutable_workload_revocation BEFORE UPDATE OR DELETE ON workload_certificate_revocations
  FOR EACH ROW EXECUTE FUNCTION immutable_workload_revocation();
DROP TRIGGER IF EXISTS immutable_workload_revocation_truncate ON workload_certificate_revocations;
CREATE TRIGGER immutable_workload_revocation_truncate BEFORE TRUNCATE ON workload_certificate_revocations
  FOR EACH STATEMENT EXECUTE FUNCTION immutable_workload_revocation();
CREATE OR REPLACE FUNCTION monotonic_workload_revocation_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'UPDATE' OR NEW.singleton<>OLD.singleton OR NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'workload_revocation_revision_not_monotonic';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS monotonic_workload_revocation_revision ON workload_revocation_state;
CREATE TRIGGER monotonic_workload_revocation_revision BEFORE UPDATE OR DELETE ON workload_revocation_state
  FOR EACH ROW EXECUTE FUNCTION monotonic_workload_revocation_revision();
DROP TRIGGER IF EXISTS immutable_workload_revocation_state_truncate ON workload_revocation_state;
CREATE TRIGGER immutable_workload_revocation_state_truncate BEFORE TRUNCATE ON workload_revocation_state
  FOR EACH STATEMENT EXECUTE FUNCTION immutable_workload_revocation();
