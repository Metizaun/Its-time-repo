CREATE OR REPLACE FUNCTION bi.project_lead_facts_from_outbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_fact jsonb;
  v_namespace text;
  v_fact_key text;
  v_value_type text;
  v_value_text text;
  v_lead_id uuid;
  v_source_record_id uuid;
BEGIN
  IF NEW.status <> 'processed'
     OR OLD.status IS NOT DISTINCT FROM NEW.status
     OR jsonb_typeof(NEW.payload->'facts') <> 'array' THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_lead_id := NULLIF(NEW.payload->>'lead_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NEW;
  END;

  IF v_lead_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM crm.leads AS lead
    WHERE lead.id = v_lead_id
      AND lead.aces_id = NEW.aces_id
  ) THEN
    RETURN NEW;
  END IF;

  v_source_record_id := CASE
    WHEN NEW.aggregate_type IN ('tool_run', 'agent_tool_run') THEN NEW.aggregate_id
    ELSE NULL
  END;

  FOR v_fact IN SELECT value FROM jsonb_array_elements(NEW.payload->'facts')
  LOOP
    v_namespace := NULLIF(btrim(v_fact->>'namespace'), '');
    v_fact_key := NULLIF(btrim(v_fact->>'fact_key'), '');
    v_value_type := NULLIF(btrim(v_fact->>'value_type'), '');
    v_value_text := v_fact->>'value';

    IF v_namespace IS NULL
       OR v_fact_key IS NULL
       OR v_value_type NOT IN ('text', 'numeric', 'boolean', 'date', 'json') THEN
      CONTINUE;
    END IF;
    IF v_value_type = 'text' AND COALESCE(v_value_text, '') = '' THEN
      CONTINUE;
    END IF;
    IF v_value_type = 'numeric'
       AND (v_value_text IS NULL OR v_value_text !~ '^-?[0-9]+([.][0-9]+)?$') THEN
      CONTINUE;
    END IF;
    IF v_value_type = 'boolean' AND v_value_text NOT IN ('true', 'false') THEN
      CONTINUE;
    END IF;
    IF v_value_type = 'date'
       AND (v_value_text IS NULL OR v_value_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN
      CONTINUE;
    END IF;
    IF v_value_type = 'json' AND NOT (v_fact ? 'value') THEN
      CONTINUE;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        NEW.aces_id::text || ':' || v_lead_id::text || ':' || v_namespace || ':' || v_fact_key,
        0
      )
    );

    UPDATE bi.lead_facts
    SET superseded_at = COALESCE(NEW.processed_at, pg_catalog.now())
    WHERE aces_id = NEW.aces_id
      AND lead_id = v_lead_id
      AND namespace = v_namespace
      AND fact_key = v_fact_key
      AND superseded_at IS NULL;

    INSERT INTO bi.lead_facts (
      aces_id,
      lead_id,
      namespace,
      fact_key,
      value_type,
      value_text,
      value_numeric,
      value_boolean,
      value_date,
      value_json,
      source_tool_key,
      source_record_id,
      observed_at
    )
    VALUES (
      NEW.aces_id,
      v_lead_id,
      v_namespace,
      v_fact_key,
      v_value_type,
      CASE WHEN v_value_type = 'text' THEN v_value_text ELSE NULL END,
      CASE WHEN v_value_type = 'numeric' THEN v_value_text::numeric ELSE NULL END,
      CASE WHEN v_value_type = 'boolean' THEN v_value_text::boolean ELSE NULL END,
      CASE WHEN v_value_type = 'date' THEN v_value_text::date ELSE NULL END,
      CASE WHEN v_value_type = 'json' THEN v_fact->'value' ELSE NULL END,
      NULLIF(NEW.payload->>'tool_key', ''),
      v_source_record_id,
      COALESCE(NEW.processed_at, NEW.created_at, pg_catalog.now())
    );
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bi.project_lead_facts_from_outbox()
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION bi.project_lead_facts_from_outbox() TO service_role;

DROP TRIGGER IF EXISTS trg_project_lead_facts_from_outbox ON crm.bi_outbox;
CREATE TRIGGER trg_project_lead_facts_from_outbox
AFTER UPDATE OF status ON crm.bi_outbox
FOR EACH ROW
WHEN (NEW.status = 'processed' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION bi.project_lead_facts_from_outbox();
