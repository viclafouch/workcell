-- Up Migration
CREATE TABLE worker_changes (
  thread_id text PRIMARY KEY,
  branch text,
  bundle bytea NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE worker_changes;
