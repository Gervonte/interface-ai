CREATE TABLE automation.runs (
  run_id uuid PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('discovery','replay')),
  target_id text NOT NULL, target_version integer NOT NULL CHECK (target_version > 0),
  policy_id text NOT NULL, policy_version integer NOT NULL CHECK (policy_version > 0),
  target_snapshot jsonb NOT NULL, policy_snapshot jsonb NOT NULL,
  target_checksum text NOT NULL CHECK (target_checksum ~ '^[0-9a-f]{64}$'),
  policy_checksum text NOT NULL CHECK (policy_checksum ~ '^[0-9a-f]{64}$'),
  capability_id text, capability_version integer,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','pausing','waiting_for_human','human_controlled','validating_resume','cancelling','completed','failed','cancelled')),
  controller text NOT NULL DEFAULT 'none' CHECK (controller IN ('none','automation','human')),
  operator_ref text, control_revision integer NOT NULL DEFAULT 1 CHECK (control_revision > 0),
  session_ref uuid, browser_provider text CHECK (browser_provider IS NULL OR browser_provider = 'browserbase'),
  provider_session_id uuid UNIQUE,
  current_step_id text, active_intervention_id uuid,
  input_names jsonb NOT NULL CHECK (jsonb_typeof(input_names) = 'array'),
  result jsonb, next_event_sequence integer NOT NULL DEFAULT 1 CHECK (next_event_sequence > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((capability_id IS NULL) = (capability_version IS NULL)),
  CHECK (mode <> 'replay' OR capability_id IS NOT NULL),
  CHECK ((status IN ('completed','failed','cancelled')) = (result IS NOT NULL)),
  CHECK ((status = 'running' AND controller = 'automation') OR (status = 'human_controlled' AND controller = 'human') OR (status NOT IN ('running','human_controlled') AND controller = 'none')),
  CHECK ((controller = 'human') = (operator_ref IS NOT NULL)),
  CHECK (status NOT IN ('waiting_for_human','human_controlled','validating_resume') OR active_intervention_id IS NOT NULL),
  CHECK (status NOT IN ('completed','failed','cancelled') OR active_intervention_id IS NULL),
  CHECK (status <> 'completed' OR COALESCE(result->>'kind' IN ('success','business_outcome'),false)),
  CHECK (status <> 'failed' OR COALESCE(result->>'kind' = 'failure',false)),
  CHECK (status <> 'cancelled' OR COALESCE(result->>'kind' = 'cancelled',false)),
  CHECK (COALESCE(target_snapshot->>'id' = target_id AND (target_snapshot->>'version')::integer = target_version,false)),
  CHECK (COALESCE(policy_snapshot->>'id' = policy_id AND (policy_snapshot->>'version')::integer = policy_version,false)),
  UNIQUE (run_id,session_ref),
  CHECK (updated_at >= created_at)
);
CREATE UNIQUE INDEX one_active_run ON automation.runs ((true)) WHERE status NOT IN ('completed','failed','cancelled');

CREATE TABLE automation.capabilities (
  capability_id text NOT NULL, version integer NOT NULL CHECK (version > 0),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  source_discovery_run_id uuid NOT NULL UNIQUE REFERENCES automation.runs(run_id),
  artifact jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (capability_id, version),
  CHECK (COALESCE(artifact->>'capabilityId' = capability_id AND (artifact->>'version')::integer = version
    AND (artifact->>'schemaVersion')::integer = schema_version AND (artifact->>'sourceDiscoveryRunId')::uuid = source_discovery_run_id,false))
);
ALTER TABLE automation.runs ADD CONSTRAINT run_capability_version_fk FOREIGN KEY (capability_id, capability_version) REFERENCES automation.capabilities(capability_id, version);

CREATE TABLE automation.interventions (
  intervention_id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES automation.runs(run_id),
  status text NOT NULL CHECK (status IN ('open','claimed','validating','resolved','closed')),
  blocked jsonb NOT NULL, operator_ref text, control_revision integer NOT NULL CHECK (control_revision > 0),
  session_ref uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  UNIQUE (run_id, intervention_id), CHECK (expires_at > created_at),
  FOREIGN KEY (run_id,session_ref) REFERENCES automation.runs(run_id,session_ref)
);
CREATE UNIQUE INDEX one_unresolved_intervention ON automation.interventions(run_id) WHERE status IN ('open','claimed','validating');
ALTER TABLE automation.runs ADD CONSTRAINT run_intervention_fk FOREIGN KEY (run_id, active_intervention_id) REFERENCES automation.interventions(run_id, intervention_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE automation.run_events (
  event_id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES automation.runs(run_id),
  sequence integer NOT NULL CHECK (sequence > 0), event_type text NOT NULL,
  actor text NOT NULL CHECK (actor IN ('system','caller','automation','human')),
  step_id text, action_index integer CHECK (action_index >= 0), intervention_id uuid,
  details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (run_id, sequence),
  FOREIGN KEY (run_id, intervention_id) REFERENCES automation.interventions(run_id, intervention_id)
);
CREATE TABLE automation.request_receipts (
  receipt_id uuid PRIMARY KEY, principal_ref text NOT NULL, operation_scope text NOT NULL,
  key_digest text NOT NULL CHECK (key_digest ~ '^[0-9a-f]{64}$'),
  payload_fingerprint text NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  fingerprint_key_id text NOT NULL CHECK (fingerprint_key_id ~ '^[0-9a-f]{64}$'),
  fingerprint_key_version integer NOT NULL CHECK (fingerprint_key_version > 0),
  run_id uuid NOT NULL REFERENCES automation.runs(run_id), intervention_id uuid,
  state text NOT NULL CHECK (state IN ('accepted','executing','settled','outcome_unknown')),
  result_reference jsonb NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  UNIQUE (principal_ref, operation_scope, key_digest),
  FOREIGN KEY (run_id, intervention_id) REFERENCES automation.interventions(run_id, intervention_id),
  CHECK (expires_at > accepted_at)
);

CREATE FUNCTION automation.immutable_capability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Capability versions are immutable' USING ERRCODE = '23514'; END;
$$;
CREATE TRIGGER immutable_capability BEFORE UPDATE OR DELETE ON automation.capabilities FOR EACH ROW EXECUTE FUNCTION automation.immutable_capability();
CREATE FUNCTION automation.protect_run_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.run_id,NEW.mode,NEW.target_snapshot,NEW.policy_snapshot,NEW.target_checksum,NEW.policy_checksum,NEW.target_id,NEW.target_version,NEW.policy_id,NEW.policy_version,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.run_id,OLD.mode,OLD.target_snapshot,OLD.policy_snapshot,OLD.target_checksum,OLD.policy_checksum,OLD.target_id,OLD.target_version,OLD.policy_id,OLD.policy_version,OLD.created_at)
    THEN RAISE EXCEPTION 'Run identity and configuration are immutable' USING ERRCODE = '23514'; END IF;
  IF OLD.status IN ('completed','failed','cancelled') AND ROW(NEW.status,NEW.result,NEW.capability_id,NEW.capability_version) IS DISTINCT FROM ROW(OLD.status,OLD.result,OLD.capability_id,OLD.capability_version)
    THEN RAISE EXCEPTION 'Terminal run result is immutable' USING ERRCODE = '23514'; END IF;
  IF OLD.mode = 'replay' AND ROW(NEW.capability_id,NEW.capability_version) IS DISTINCT FROM ROW(OLD.capability_id,OLD.capability_version)
    THEN RAISE EXCEPTION 'Replay version is immutable' USING ERRCODE = '23514'; END IF;
  IF (OLD.session_ref IS NOT NULL AND NEW.session_ref IS DISTINCT FROM OLD.session_ref)
    OR (OLD.provider_session_id IS NOT NULL AND NEW.provider_session_id IS DISTINCT FROM OLD.provider_session_id)
    THEN RAISE EXCEPTION 'Run session cannot be replaced' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_run_identity BEFORE UPDATE ON automation.runs FOR EACH ROW EXECUTE FUNCTION automation.protect_run_identity();
CREATE FUNCTION automation.check_discovery_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM automation.runs WHERE run_id = NEW.source_discovery_run_id AND mode = 'discovery' AND status = 'completed'
    AND capability_id = NEW.capability_id AND capability_version = NEW.version AND result->>'kind' = 'success')
    THEN RAISE EXCEPTION 'Capability requires a completed source discovery' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER discovery_publication AFTER INSERT ON automation.capabilities DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION automation.check_discovery_publication();
