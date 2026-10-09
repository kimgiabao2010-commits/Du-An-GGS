-- PostgreSQL is the authority, including halt, ingress and execution acceptance.
CREATE TABLE IF NOT EXISTS control_runtime_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  halted boolean NOT NULL DEFAULT false,
  generation bigint NOT NULL DEFAULT 0,
  actor_id text NOT NULL DEFAULT 'bootstrap',
  reason text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO control_runtime_state(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS command_intakes (
  command_id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES cases(case_id),
  actor_id text NOT NULL,
  body_hash text NOT NULL CHECK(body_hash ~ '^[a-f0-9]{64}$'),
  content text NOT NULL CHECK(length(content) BETWEEN 1 AND 16000),
  state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','PLANNING','DONE','CANCELLED','FAILED')),
  decision jsonb,
  decision_hash text,
  locked_by text,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  deadline_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
  CHECK ((decision IS NULL) = (decision_hash IS NULL))
);
CREATE INDEX IF NOT EXISTS command_intakes_pending ON command_intakes(next_attempt_at)
  WHERE state IN ('PENDING','PLANNING');
CREATE TABLE IF NOT EXISTS worker_task_acceptances (
  task_id text PRIMARY KEY REFERENCES runtime_tasks(task_id),
  case_id text NOT NULL REFERENCES cases(case_id),
  worker_id text NOT NULL,
  execution_id text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
