-- Missing provider usage/rates are UNKNOWN, never zero or locally estimated tokens.
ALTER TABLE model_usage ALTER COLUMN input_tokens DROP NOT NULL;
ALTER TABLE model_usage ALTER COLUMN output_tokens DROP NOT NULL;
ALTER TABLE model_usage ALTER COLUMN cached_tokens DROP NOT NULL;
ALTER TABLE model_usage ALTER COLUMN estimated_cost_micros DROP NOT NULL;
ALTER TABLE model_usage ADD COLUMN IF NOT EXISTS cache_write_tokens INTEGER CHECK (cache_write_tokens >= 0);
ALTER TABLE model_usage ADD COLUMN IF NOT EXISTS cost_status TEXT
  GENERATED ALWAYS AS (CASE WHEN estimated_cost_micros IS NULL THEN 'UNKNOWN' ELSE 'KNOWN' END) STORED;
