-- Authority-owned case budget. Uncertain provider calls retain their full reservation.
CREATE TABLE model_case_budgets (
  case_id TEXT PRIMARY KEY REFERENCES cases(case_id),
  policy_hash TEXT NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  policy_version TEXT NOT NULL,
  limit_micros BIGINT NOT NULL CHECK (limit_micros > 0 AND limit_micros <= 9007199254740991),
  spent_micros BIGINT NOT NULL DEFAULT 0 CHECK (spent_micros >= 0),
  held_micros BIGINT NOT NULL DEFAULT 0 CHECK (held_micros >= 0),
  blocked BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE model_call_reservations (
  reservation_id TEXT PRIMARY KEY,
  usage_id TEXT NOT NULL UNIQUE,
  case_id TEXT NOT NULL REFERENCES model_case_budgets(case_id),
  provider TEXT NOT NULL CHECK (provider IN ('openai','groq')),
  model TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  binding_hash TEXT NOT NULL CHECK (binding_hash ~ '^[a-f0-9]{64}$'),
  reserved_micros BIGINT NOT NULL CHECK (reserved_micros > 0),
  state TEXT NOT NULL DEFAULT 'RESERVED' CHECK (state IN ('RESERVED','STARTED','SETTLED','UNKNOWN','BREACHED')),
  attempt_id TEXT,
  settlement_hash TEXT CHECK (settlement_hash ~ '^[a-f0-9]{64}$'),
  actual_micros BIGINT CHECK (actual_micros >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ
);
CREATE INDEX model_reservations_case_state ON model_call_reservations(case_id,state);
ALTER TABLE model_usage ADD COLUMN reservation_id TEXT UNIQUE REFERENCES model_call_reservations(reservation_id);

CREATE FUNCTION enforce_model_reservation_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.reservation_id,NEW.usage_id,NEW.case_id,NEW.provider,NEW.model,NEW.request_hash,NEW.binding_hash,NEW.reserved_micros)
    IS DISTINCT FROM (OLD.reservation_id,OLD.usage_id,OLD.case_id,OLD.provider,OLD.model,OLD.request_hash,OLD.binding_hash,OLD.reserved_micros)
  THEN RAISE EXCEPTION 'model_reservation_binding_immutable'; END IF;
  IF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id AND NOT (OLD.state='RESERVED' AND NEW.state='STARTED')
  THEN RAISE EXCEPTION 'model_attempt_immutable'; END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT
    (OLD.state='RESERVED' AND NEW.state='STARTED' OR OLD.state='STARTED' AND NEW.state IN ('SETTLED','UNKNOWN','BREACHED'))
  THEN RAISE EXCEPTION 'model_reservation_transition_denied'; END IF;
  IF OLD.state IN ('SETTLED','UNKNOWN','BREACHED') AND (NEW.settlement_hash,NEW.actual_micros,NEW.settled_at)
    IS DISTINCT FROM (OLD.settlement_hash,OLD.actual_micros,OLD.settled_at)
  THEN RAISE EXCEPTION 'model_settlement_immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER model_reservation_binding_immutable BEFORE UPDATE ON model_call_reservations
  FOR EACH ROW EXECUTE FUNCTION enforce_model_reservation_binding();

CREATE FUNCTION enforce_model_budget_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.case_id,NEW.policy_hash,NEW.policy_version,NEW.limit_micros)
    IS DISTINCT FROM (OLD.case_id,OLD.policy_hash,OLD.policy_version,OLD.limit_micros)
  THEN RAISE EXCEPTION 'model_budget_policy_immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER model_budget_policy_immutable BEFORE UPDATE ON model_case_budgets
  FOR EACH ROW EXECUTE FUNCTION enforce_model_budget_policy();
