-- Presence is an observation lease, never proof of successful execution.
CREATE TABLE worker_registry (
  worker_id text PRIMARY KEY,
  role text NOT NULL,
  capabilities jsonb NOT NULL,
  current_connection_id text,
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0)
);
INSERT INTO worker_registry(worker_id,role,capabilities) VALUES
 ('cli-worker-agent','CLI_DAEMON','["inspect_hostname","inspect_system","inspect_network_config","inspect_network_connections"]'),
 ('ide-worker-agent','IDE_AGENT','["search_code","analyze_code"]'),
 ('siem-worker-agent','SIEM','["search_siem"]');
CREATE TABLE worker_connections (
  connection_id text PRIMARY KEY,
  worker_id text NOT NULL REFERENCES worker_registry(worker_id),
  observer_id text NOT NULL,
  generation bigint NOT NULL,
  execution_id text,
  sequence bigint NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  heartbeat_hash text,
  readiness text NOT NULL DEFAULT 'UNKNOWN' CHECK (readiness IN ('UNKNOWN','READY','BUSY','BLOCKED','HALTED')),
  state text NOT NULL DEFAULT 'CONNECTED' CHECK (state IN ('CONNECTED','ONLINE','OFFLINE','FENCED')),
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz,
  lease_until timestamptz NOT NULL DEFAULT now()+interval '20 seconds',
  closed_at timestamptz,
  UNIQUE(worker_id,generation)
);
ALTER TABLE worker_registry ADD CONSTRAINT worker_current_connection_fk
 FOREIGN KEY(current_connection_id) REFERENCES worker_connections(connection_id);
CREATE INDEX worker_connections_history ON worker_connections(worker_id,connected_at DESC);
CREATE FUNCTION protect_worker_connection_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.connection_id,NEW.worker_id,NEW.observer_id,NEW.generation,NEW.connected_at)
    IS DISTINCT FROM (OLD.connection_id,OLD.worker_id,OLD.observer_id,OLD.generation,OLD.connected_at)
    OR (OLD.execution_id IS NOT NULL AND NEW.execution_id IS DISTINCT FROM OLD.execution_id)
    OR NEW.sequence < OLD.sequence
    OR (OLD.state IN ('OFFLINE','FENCED') AND NEW IS DISTINCT FROM OLD) THEN
  RAISE EXCEPTION 'worker_connection_binding_immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER worker_connection_binding BEFORE UPDATE ON worker_connections
 FOR EACH ROW EXECUTE FUNCTION protect_worker_connection_binding();
