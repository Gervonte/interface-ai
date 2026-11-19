ALTER TABLE automation.runs
  ADD COLUMN principal_ref text NOT NULL DEFAULT 'legacy-operator',
  ADD COLUMN session_state text NOT NULL DEFAULT 'none' CHECK (session_state IN ('none','creating','live','close_requested','closed','uncertain')),
  ADD COLUMN session_expires_at timestamptz,
  ADD COLUMN dispatch_state text NOT NULL DEFAULT 'not_sent' CHECK (dispatch_state IN ('not_sent','sent','settled','unknown')),
  ADD COLUMN effect_state text NOT NULL DEFAULT 'not_checked' CHECK (effect_state IN ('not_checked','confirmed','not_applied','unknown'));
UPDATE automation.runs r SET principal_ref=q.principal_ref FROM automation.request_receipts q WHERE q.run_id=r.run_id AND q.operation_scope='create-run';
ALTER TABLE automation.runs ALTER COLUMN principal_ref DROP DEFAULT;
CREATE UNIQUE INDEX one_occupied_session ON automation.runs ((true)) WHERE session_state IN ('creating','live','close_requested','uncertain');
CREATE FUNCTION automation.protect_runtime_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.principal_ref IS DISTINCT FROM OLD.principal_ref THEN RAISE EXCEPTION 'Run principal is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.session_state='closed' AND NEW.session_state <> 'closed' THEN RAISE EXCEPTION 'Closed session cannot reopen' USING ERRCODE='23514'; END IF;
  IF OLD.session_expires_at IS NOT NULL AND NEW.session_expires_at IS DISTINCT FROM OLD.session_expires_at THEN RAISE EXCEPTION 'Session expiry is pinned' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_runtime_identity BEFORE UPDATE ON automation.runs FOR EACH ROW EXECUTE FUNCTION automation.protect_runtime_identity();
