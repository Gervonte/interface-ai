ALTER TABLE automation.capabilities ADD COLUMN base_version integer;
ALTER TABLE automation.capabilities ADD CONSTRAINT capability_base_version_fk
  FOREIGN KEY (capability_id,base_version) REFERENCES automation.capabilities(capability_id,version);
ALTER TABLE automation.capabilities ADD CONSTRAINT capability_revision_sequence
  CHECK (base_version IS NULL OR version=base_version+1);
ALTER TABLE automation.capabilities DROP CONSTRAINT capabilities_source_discovery_run_id_key;
CREATE UNIQUE INDEX one_initial_capability_per_discovery ON automation.capabilities(source_discovery_run_id) WHERE base_version IS NULL;

CREATE OR REPLACE FUNCTION automation.check_discovery_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent automation.capabilities%ROWTYPE; old_steps jsonb; new_steps jsonb;
BEGIN
  IF NEW.base_version IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM automation.runs WHERE run_id=NEW.source_discovery_run_id AND mode='discovery' AND status='completed'
      AND capability_id=NEW.capability_id AND capability_version=NEW.version AND result->>'kind'='success')
      THEN RAISE EXCEPTION 'Capability requires a completed source discovery' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT * INTO parent FROM automation.capabilities WHERE capability_id=NEW.capability_id AND version=NEW.base_version;
    IF NOT FOUND OR parent.source_discovery_run_id<>NEW.source_discovery_run_id THEN
      RAISE EXCEPTION 'Rule revision requires its original discovery source' USING ERRCODE='23514'; END IF;
    IF NOT EXISTS(SELECT 1 FROM automation.runs WHERE run_id=NEW.source_discovery_run_id AND mode='discovery' AND status='completed'
      AND capability_id=NEW.capability_id AND result->>'kind'='success') THEN
      RAISE EXCEPTION 'Rule revision requires a successful discovery' USING ERRCODE='23514'; END IF;
    SELECT jsonb_agg(step-'outcomeRuleIds'-'recoveryRuleIds' ORDER BY position) INTO old_steps FROM jsonb_array_elements(parent.artifact->'steps') WITH ORDINALITY AS t(step,position);
    SELECT jsonb_agg(step-'outcomeRuleIds'-'recoveryRuleIds' ORDER BY position) INTO new_steps FROM jsonb_array_elements(NEW.artifact->'steps') WITH ORDINALITY AS t(step,position);
    IF old_steps IS DISTINCT FROM new_steps
      OR (parent.artifact-ARRAY['version','surfaceRequirements','targets','outcomeRules','recoveryRules','runtimeGuards','steps']) IS DISTINCT FROM
         (NEW.artifact-ARRAY['version','surfaceRequirements','targets','outcomeRules','recoveryRules','runtimeGuards','steps'])
      OR (parent.artifact->'surfaceRequirements'-'compatibleTargetVersions') IS DISTINCT FROM (NEW.artifact->'surfaceRequirements'-'compatibleTargetVersions')
      OR EXISTS(SELECT 1 FROM jsonb_each(parent.artifact->'targets') t WHERE NEW.artifact->'targets'->t.key IS DISTINCT FROM t.value)
      THEN RAISE EXCEPTION 'Rule revisions cannot alter discovered actions, bindings, targets, or provenance' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
