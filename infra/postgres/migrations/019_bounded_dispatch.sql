-- Additive, durable single-investigation authority. Legacy schemas start disabled;
-- the launcher and lab/replay/staging authority activate it after readiness checks.
CREATE TABLE dispatch_scheduler_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  active_run_id text REFERENCES investigation_runs(run_id),
  max_pending integer NOT NULL DEFAULT 32 CHECK (max_pending = 32),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO dispatch_scheduler_state(singleton) VALUES(true);
CREATE INDEX control_outbox_dispatch_fifo ON control_outbox(created_at,event_id)
  WHERE published_at IS NULL AND event_type='TASK_DISPATCH_REQUESTED';
