ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS canonical_parameters JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS parameters_hash TEXT NOT NULL DEFAULT repeat('0', 64);
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS policy_version TEXT NOT NULL DEFAULT 'legacy-unbound';
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS request_hash TEXT;

ALTER TABLE approval_requests DROP CONSTRAINT IF EXISTS approval_requests_parameters_hash_check;
ALTER TABLE approval_requests ADD CONSTRAINT approval_requests_parameters_hash_check
  CHECK (parameters_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE approval_requests DROP CONSTRAINT IF EXISTS approval_requests_request_hash_check;
ALTER TABLE approval_requests ADD CONSTRAINT approval_requests_request_hash_check
  CHECK (request_hash IS NULL OR request_hash ~ '^[a-f0-9]{64}$');

CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_request_hash_unique
  ON approval_requests(request_hash) WHERE request_hash IS NOT NULL;
