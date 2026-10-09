CREATE OR REPLACE FUNCTION gss_immutable_approval_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.incident_id,OLD.action,OLD.artifact_hash,OLD.requested_by,OLD.expires_at,
         OLD.canonical_parameters,OLD.parameters_hash,OLD.policy_version,OLD.request_hash)
     IS DISTINCT FROM
     ROW(NEW.incident_id,NEW.action,NEW.artifact_hash,NEW.requested_by,NEW.expires_at,
         NEW.canonical_parameters,NEW.parameters_hash,NEW.policy_version,NEW.request_hash) THEN
    RAISE EXCEPTION 'approval_binding_immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS gss_approval_binding_guard ON approval_requests;
CREATE TRIGGER gss_approval_binding_guard BEFORE UPDATE ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION gss_immutable_approval_binding();

CREATE OR REPLACE FUNCTION gss_immutable_artifact_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD IS DISTINCT FROM NEW THEN RAISE EXCEPTION 'artifact_metadata_immutable'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS gss_artifact_metadata_guard ON artifact_registry;
CREATE TRIGGER gss_artifact_metadata_guard BEFORE UPDATE ON artifact_registry
  FOR EACH ROW EXECUTE FUNCTION gss_immutable_artifact_metadata();
