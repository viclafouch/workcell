-- Up Migration
CREATE TABLE media_artifacts (
  artifact_id text COLLATE "C" PRIMARY KEY,
  run_id text NOT NULL,
  thread_id text NOT NULL,
  created_at bigint NOT NULL,
  record jsonb NOT NULL
);

CREATE INDEX media_artifacts_run ON media_artifacts (run_id, created_at, artifact_id);

CREATE INDEX media_artifacts_thread ON media_artifacts (thread_id, created_at, artifact_id);

CREATE TABLE media_blobs (
  key text COLLATE "C" PRIMARY KEY,
  bytes bytea NOT NULL,
  etag text NOT NULL,
  content_type text,
  custom_metadata jsonb,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

-- Down Migration
DROP TABLE media_blobs;

DROP TABLE media_artifacts;
