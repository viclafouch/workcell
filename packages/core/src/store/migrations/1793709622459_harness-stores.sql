-- Up Migration
CREATE TABLE log_owner (
  log_id text PRIMARY KEY,
  epoch bigint NOT NULL DEFAULT 0,
  head bigint NOT NULL DEFAULT 0,
  first_seq bigint NOT NULL DEFAULT 1,
  harness text,
  owner_id text,
  expires_at timestamptz,
  released boolean NOT NULL DEFAULT FALSE,
  deleted boolean NOT NULL DEFAULT FALSE,
  affinity text,
  wake_at timestamptz
);

CREATE INDEX log_owner_expiry ON log_owner (expires_at) WHERE epoch > 0 AND NOT released;

CREATE INDEX log_owner_wake ON log_owner (wake_at) WHERE released AND wake_at IS NOT NULL;

CREATE TABLE log_records (
  log_id text NOT NULL,
  seq bigint NOT NULL,
  record text NOT NULL,
  PRIMARY KEY (log_id, seq)
);

CREATE TABLE log_hosts (
  host_id text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);

CREATE TABLE log_offers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  log_id text NOT NULL,
  input_id text NOT NULL,
  harness text NOT NULL,
  record text NOT NULL,
  offered_at timestamptz NOT NULL DEFAULT now(),
  consumed boolean NOT NULL DEFAULT FALSE,
  UNIQUE (log_id, input_id)
);

CREATE INDEX log_offers_pending ON log_offers (log_id, id) WHERE NOT consumed;

CREATE TABLE log_snapshots (
  log_id text PRIMARY KEY,
  seq bigint NOT NULL,
  version text NOT NULL,
  state text NOT NULL
);

CREATE SEQUENCE store_revisions;

CREATE TABLE session_index (
  tenant_id text NOT NULL,
  thread_id text NOT NULL,
  updated_at bigint NOT NULL,
  revision bigint NOT NULL,
  entry jsonb NOT NULL,
  PRIMARY KEY (tenant_id, thread_id)
);

CREATE INDEX session_index_order ON session_index (tenant_id, updated_at DESC, thread_id COLLATE "C");

CREATE INDEX session_index_parent ON session_index (tenant_id, (entry->>'parentThreadId'));

CREATE INDEX session_index_members ON session_index USING gin ((entry->'members') jsonb_path_ops);

CREATE INDEX session_index_metadata ON session_index USING gin ((entry->'metadata') jsonb_path_ops);

CREATE TABLE metadata_entries (
  namespace text NOT NULL,
  key text NOT NULL,
  value text NOT NULL,
  revision bigint NOT NULL,
  PRIMARY KEY (namespace, key)
);

-- Down Migration
DROP TABLE metadata_entries;
DROP TABLE session_index;
DROP SEQUENCE store_revisions;
DROP TABLE log_snapshots;
DROP TABLE log_offers;
DROP TABLE log_hosts;
DROP TABLE log_records;
DROP TABLE log_owner;
