-- Up Migration
CREATE TABLE sandbox_instances (
  key text PRIMARY KEY,
  provider text NOT NULL,
  provider_sandbox_id text NOT NULL,
  latest_snapshot_id text,
  thread_id text NOT NULL,
  latest_run_id text,
  updated_at bigint NOT NULL
);

-- Down Migration
DROP TABLE sandbox_instances;
