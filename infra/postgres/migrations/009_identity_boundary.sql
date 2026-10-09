CREATE TABLE IF NOT EXISTS identity_revocations (
  issuer text NOT NULL,
  subject text NOT NULL,
  revoked_before timestamptz NOT NULL DEFAULT now(),
  actor_id text NOT NULL,
  PRIMARY KEY(issuer,subject)
);
CREATE TABLE IF NOT EXISTS case_access (
  case_id text NOT NULL REFERENCES cases(case_id),
  issuer text NOT NULL,
  subject text NOT NULL,
  granted_by text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(case_id,issuer,subject)
);
