-- A entrega continua usando contact_phone. Esta identidade existe apenas para
-- correlacionar aliases que os provedores brasileiros devolvem com ou sem o
-- nono digito depois do DDD.
CREATE OR REPLACE FUNCTION crm.normalize_phone_identity(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  WITH cleaned AS (
    SELECT
      btrim(COALESCE(p_phone, '')) AS raw_phone,
      regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g') AS digits
  ), brazil AS (
    SELECT
      raw_phone,
      digits,
      CASE
        WHEN raw_phone ~ '^(\+|00)' AND digits !~ '^55' THEN NULL
        WHEN length(digits) IN (12, 13) AND left(digits, 2) = '55' THEN substr(digits, 3)
        WHEN length(digits) IN (10, 11) THEN digits
        ELSE NULL
      END AS national
    FROM cleaned
  )
  SELECT CASE
    WHEN national IS NOT NULL AND length(national) = 11 AND substr(national, 3, 1) = '9'
      THEN 'br:' || substr(national, 1, 2) || substr(national, 4)
    WHEN national IS NOT NULL AND length(national) = 10
      THEN 'br:' || national
    WHEN length(digits) BETWEEN 8 AND 15
      THEN 'intl:' || digits
    ELSE NULL
  END
  FROM brazil;
$$;

REVOKE ALL ON FUNCTION crm.normalize_phone_identity(text)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.normalize_phone_identity(text) TO service_role;

ALTER TABLE crm.leads
  ADD COLUMN IF NOT EXISTS phone_identity text;

UPDATE crm.leads
SET phone_identity = crm.normalize_phone_identity(contact_phone)
WHERE phone_identity IS DISTINCT FROM crm.normalize_phone_identity(contact_phone);

CREATE OR REPLACE FUNCTION crm.set_lead_phone_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.phone_identity := crm.normalize_phone_identity(NEW.contact_phone);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION crm.set_lead_phone_identity()
  FROM PUBLIC, anon, authenticated, authenticator;

CREATE TRIGGER trg_leads_set_phone_identity
BEFORE INSERT OR UPDATE OF contact_phone, phone_identity ON crm.leads
FOR EACH ROW
EXECUTE FUNCTION crm.set_lead_phone_identity();

UPDATE crm.leads SET view = TRUE WHERE view IS NULL;
ALTER TABLE crm.leads ALTER COLUMN view SET DEFAULT TRUE;
ALTER TABLE crm.leads ALTER COLUMN view SET NOT NULL;

-- A constraint antiga compara apenas o texto bruto e impede que o lead ativo
-- adote o numero E.164 mantido em um registro arquivado. A identidade parcial
-- abaixo passa a ser a fonte de unicidade para contatos ativos.
CREATE TABLE crm.lead_phone_identity_merge_audit (
  source_lead_id uuid PRIMARY KEY REFERENCES crm.leads(id) ON DELETE RESTRICT,
  merge_batch_id uuid NOT NULL,
  canonical_lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE RESTRICT,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE RESTRICT,
  phone_identity text NOT NULL,
  source_instance text,
  canonical_instance text,
  messages_moved integer NOT NULL DEFAULT 0,
  attachments_moved integer NOT NULL DEFAULT 0,
  upload_intents_moved integer NOT NULL DEFAULT 0,
  opportunities_moved integer NOT NULL DEFAULT 0,
  ai_runs_moved integer NOT NULL DEFAULT 0,
  ai_states_found integer NOT NULL DEFAULT 0,
  ai_states_moved integer NOT NULL DEFAULT 0,
  pipeline_analyses_found integer NOT NULL DEFAULT 0,
  pipeline_analyses_moved integer NOT NULL DEFAULT 0,
  source_tags_found integer NOT NULL DEFAULT 0,
  merged_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_phone_identity_merge_distinct_check
    CHECK (source_lead_id <> canonical_lead_id)
);

CREATE INDEX idx_lead_phone_identity_merge_audit_batch
  ON crm.lead_phone_identity_merge_audit(merge_batch_id);

ALTER TABLE crm.lead_phone_identity_merge_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm.lead_phone_identity_merge_audit
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT ON crm.lead_phone_identity_merge_audit TO service_role;

CREATE OR REPLACE FUNCTION crm.merge_active_phone_identity_duplicates()
RETURNS TABLE (
  groups_merged integer,
  leads_archived integer,
  messages_moved integer,
  attachments_moved integer,
  upload_intents_moved integer,
  opportunities_moved integer,
  ai_runs_moved integer,
  ai_states_moved integer,
  pipeline_analyses_moved integer,
  tags_copied integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_groups_merged integer := 0;
  v_leads_archived integer := 0;
  v_messages_moved integer := 0;
  v_attachments_moved integer := 0;
  v_upload_intents_moved integer := 0;
  v_opportunities_moved integer := 0;
  v_ai_runs_moved integer := 0;
  v_ai_states_moved integer := 0;
  v_pipeline_analyses_moved integer := 0;
  v_tags_copied integer := 0;
  v_merge_batch_id uuid := gen_random_uuid();
BEGIN
  IF EXISTS (
    SELECT 1
    FROM crm.leads AS lead
    WHERE lead.view IS TRUE
      AND lead.phone_identity IS NOT NULL
    GROUP BY lead.aces_id, lead.phone_identity
    HAVING count(*) > 1
       AND count(DISTINCT COALESCE(lead.instancia, '')) > 1
  ) THEN
    RAISE EXCEPTION
      'Existem identidades telefonicas duplicadas em instancias diferentes; consolidacao automatica bloqueada';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM crm.leads AS lead
    JOIN rb.lead_metadata AS metadata ON metadata.lead_id = lead.id
    WHERE lead.view IS TRUE
      AND lead.phone_identity IS NOT NULL
    GROUP BY lead.aces_id, lead.phone_identity
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Existem identidades telefonicas duplicadas com mais de um cadastro RB; consolidacao automatica bloqueada';
  END IF;

  INSERT INTO crm.lead_phone_identity_merge_audit (
    source_lead_id,
    merge_batch_id,
    canonical_lead_id,
    aces_id,
    phone_identity,
    source_instance,
    canonical_instance,
    messages_moved,
    attachments_moved,
    upload_intents_moved,
    opportunities_moved,
    ai_runs_moved,
    ai_states_found,
    ai_states_moved,
    pipeline_analyses_found,
    pipeline_analyses_moved,
    source_tags_found
  )
  WITH ranked AS (
    SELECT
      lead.id,
      lead.aces_id,
      lead.phone_identity,
      lead.instancia,
      first_value(lead.id) OVER identity_rank AS canonical_lead_id,
      first_value(lead.instancia) OVER identity_rank AS canonical_instance,
      row_number() OVER identity_rank AS identity_position,
      count(*) OVER identity_group AS identity_count
    FROM crm.leads AS lead
    WHERE lead.view IS TRUE
      AND lead.phone_identity IS NOT NULL
    WINDOW
      identity_group AS (
        PARTITION BY lead.aces_id, lead.phone_identity
      ),
      identity_rank AS (
        PARTITION BY lead.aces_id, lead.phone_identity
        ORDER BY
          EXISTS (
            SELECT 1
            FROM rb.lead_metadata AS metadata
            WHERE metadata.lead_id = lead.id
          ) DESC,
          lead.last_message_at DESC NULLS LAST,
          lead.updated_at DESC NULLS LAST,
          lead.created_at DESC NULLS LAST,
          lead.id DESC
      )
  )
  SELECT
    ranked.id,
    v_merge_batch_id,
    ranked.canonical_lead_id,
    ranked.aces_id,
    ranked.phone_identity,
    ranked.instancia,
    ranked.canonical_instance,
    (SELECT count(*) FROM crm.message_history AS message WHERE message.lead_id = ranked.id),
    (SELECT count(*) FROM crm.message_attachments AS attachment WHERE attachment.lead_id = ranked.id),
    (SELECT count(*) FROM crm.message_attachment_upload_intents AS intent WHERE intent.lead_id = ranked.id),
    (SELECT count(*) FROM crm.opportunities AS opportunity WHERE opportunity.lead_id = ranked.id),
    (SELECT count(*) FROM agents.ai_runs AS run WHERE run.lead_id = ranked.id),
    (SELECT count(*) FROM agents.ai_lead_state AS state WHERE state.lead_id = ranked.id),
    (
      SELECT count(*)
      FROM agents.ai_lead_state AS state
      WHERE state.lead_id = ranked.id
        AND NOT EXISTS (
          SELECT 1
          FROM agents.ai_lead_state AS canonical_state
          WHERE canonical_state.agent_id = state.agent_id
            AND canonical_state.lead_id = ranked.canonical_lead_id
        )
    ),
    (SELECT count(*) FROM crm.lead_pipeline_analysis AS analysis WHERE analysis.lead_id = ranked.id),
    (
      SELECT count(*)
      FROM crm.lead_pipeline_analysis AS analysis
      WHERE analysis.lead_id = ranked.id
        AND NOT EXISTS (
          SELECT 1
          FROM crm.lead_pipeline_analysis AS canonical_analysis
          WHERE canonical_analysis.lead_id = ranked.canonical_lead_id
        )
    ),
    (SELECT count(*) FROM crm.lead_tags AS tag WHERE tag.lead_id = ranked.id)
  FROM ranked
  WHERE ranked.identity_count > 1
    AND ranked.identity_position > 1
  ON CONFLICT (source_lead_id) DO NOTHING;

  SELECT count(DISTINCT (plan.aces_id, plan.phone_identity)), count(*)
  INTO v_groups_merged, v_leads_archived
  FROM crm.lead_phone_identity_merge_audit AS plan
  WHERE plan.merge_batch_id = v_merge_batch_id;

  UPDATE crm.message_attachments AS attachment
  SET lead_id = plan.canonical_lead_id
  FROM crm.lead_phone_identity_merge_audit AS plan
  WHERE plan.merge_batch_id = v_merge_batch_id
    AND attachment.lead_id = plan.source_lead_id;
  GET DIAGNOSTICS v_attachments_moved = ROW_COUNT;

  UPDATE crm.message_attachment_upload_intents AS intent
  SET lead_id = plan.canonical_lead_id
  FROM crm.lead_phone_identity_merge_audit AS plan
  WHERE plan.merge_batch_id = v_merge_batch_id
    AND intent.lead_id = plan.source_lead_id;
  GET DIAGNOSTICS v_upload_intents_moved = ROW_COUNT;

  UPDATE crm.message_history AS message
  SET lead_id = plan.canonical_lead_id
  FROM crm.lead_phone_identity_merge_audit AS plan
  WHERE plan.merge_batch_id = v_merge_batch_id
    AND message.lead_id = plan.source_lead_id;
  GET DIAGNOSTICS v_messages_moved = ROW_COUNT;

  UPDATE crm.opportunities AS opportunity
  SET lead_id = plan.canonical_lead_id
  FROM crm.lead_phone_identity_merge_audit AS plan
  WHERE plan.merge_batch_id = v_merge_batch_id
    AND opportunity.lead_id = plan.source_lead_id;
  GET DIAGNOSTICS v_opportunities_moved = ROW_COUNT;

  UPDATE agents.ai_runs AS run
  SET lead_id = plan.canonical_lead_id
  FROM crm.lead_phone_identity_merge_audit AS plan
  WHERE plan.merge_batch_id = v_merge_batch_id
    AND run.lead_id = plan.source_lead_id;
  GET DIAGNOSTICS v_ai_runs_moved = ROW_COUNT;

  UPDATE agents.ai_lead_state AS state
  SET lead_id = plan.canonical_lead_id
  FROM crm.lead_phone_identity_merge_audit AS plan
  WHERE plan.merge_batch_id = v_merge_batch_id
    AND state.lead_id = plan.source_lead_id
    AND NOT EXISTS (
      SELECT 1
      FROM agents.ai_lead_state AS canonical_state
      WHERE canonical_state.agent_id = state.agent_id
        AND canonical_state.lead_id = plan.canonical_lead_id
    );
  GET DIAGNOSTICS v_ai_states_moved = ROW_COUNT;

  UPDATE crm.lead_pipeline_analysis AS analysis
  SET lead_id = plan.canonical_lead_id
  FROM crm.lead_phone_identity_merge_audit AS plan
  WHERE plan.merge_batch_id = v_merge_batch_id
    AND analysis.lead_id = plan.source_lead_id
    AND NOT EXISTS (
      SELECT 1
      FROM crm.lead_pipeline_analysis AS canonical_analysis
      WHERE canonical_analysis.lead_id = plan.canonical_lead_id
    );
  GET DIAGNOSTICS v_pipeline_analyses_moved = ROW_COUNT;

  INSERT INTO crm.lead_tags (lead_id, tag_id, tag_name, created_at)
  SELECT
    plan.canonical_lead_id,
    tag.tag_id,
    tag.tag_name,
    tag.created_at
  FROM crm.lead_tags AS tag
  JOIN crm.lead_phone_identity_merge_audit AS plan
    ON plan.source_lead_id = tag.lead_id
   AND plan.merge_batch_id = v_merge_batch_id
  ON CONFLICT (lead_id, tag_id) DO NOTHING;
  GET DIAGNOSTICS v_tags_copied = ROW_COUNT;

  UPDATE crm.leads AS canonical
  SET last_message_at = GREATEST(
    canonical.last_message_at,
    message_stats.last_message_at
  )
  FROM (
    SELECT
      plan.canonical_lead_id,
      max(message.sent_at) AS last_message_at
    FROM crm.lead_phone_identity_merge_audit AS plan
    JOIN crm.message_history AS message
      ON message.lead_id = plan.canonical_lead_id
    WHERE plan.merge_batch_id = v_merge_batch_id
    GROUP BY plan.canonical_lead_id
  ) AS message_stats
  WHERE canonical.id = message_stats.canonical_lead_id
    AND message_stats.last_message_at IS NOT NULL
    AND canonical.last_message_at IS DISTINCT FROM GREATEST(
      canonical.last_message_at,
      message_stats.last_message_at
    );

  UPDATE crm.leads AS source
  SET view = FALSE
  FROM crm.lead_phone_identity_merge_audit AS plan
  WHERE plan.merge_batch_id = v_merge_batch_id
    AND source.id = plan.source_lead_id
    AND source.view IS TRUE;

  RETURN QUERY SELECT
    v_groups_merged,
    v_leads_archived,
    v_messages_moved,
    v_attachments_moved,
    v_upload_intents_moved,
    v_opportunities_moved,
    v_ai_runs_moved,
    v_ai_states_moved,
    v_pipeline_analyses_moved,
    v_tags_copied;
END;
$$;

REVOKE ALL ON FUNCTION crm.merge_active_phone_identity_duplicates()
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.merge_active_phone_identity_duplicates()
  TO service_role;

SELECT * FROM crm.merge_active_phone_identity_duplicates();

DO $duplicate_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM crm.leads AS lead
    WHERE lead.view IS TRUE
      AND lead.phone_identity IS NOT NULL
    GROUP BY lead.aces_id, lead.phone_identity
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A consolidacao deixou identidades telefonicas ativas duplicadas';
  END IF;
END
$duplicate_guard$;

ALTER TABLE crm.leads DROP CONSTRAINT IF EXISTS leads_phone_account_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_active_phone_identity_unique
  ON crm.leads (aces_id, phone_identity)
  WHERE view = TRUE AND phone_identity IS NOT NULL;

CREATE OR REPLACE FUNCTION public.rpc_create_lead(
  p_name text,
  p_contact_phone text,
  p_email text DEFAULT NULL,
  p_source text DEFAULT 'WhatsApp',
  p_last_city text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_stage_id uuid DEFAULT NULL,
  p_instance text DEFAULT NULL,
  p_value numeric DEFAULT NULL,
  p_connection_level text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_aces_id integer := public.current_aces_id();
  v_current_user_id uuid := public.current_crm_user_id();
  v_instance text := NULLIF(btrim(COALESCE(p_instance, '')), '');
  v_name text := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_contact_phone text := NULLIF(btrim(COALESCE(p_contact_phone, '')), '');
  v_phone_identity text := crm.normalize_phone_identity(p_contact_phone);
  v_stage_category text;
  v_stage_name text;
  v_lead_id uuid;
  v_lead_owner_id uuid;
  v_lead_status text;
  v_lead_stage_id uuid;
  v_deleted_lead_id uuid;
  v_instance_owner_id uuid;
  v_existing_opportunity_id uuid;
  v_opportunity_created boolean := false;
  v_restored_deleted_lead boolean := false;
  v_normalized_opportunity_status crm.lead_status;
BEGIN
  IF v_aces_id IS NULL OR v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario CRM nao encontrado';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Nome do lead e obrigatorio';
  END IF;

  IF v_contact_phone IS NULL OR v_phone_identity IS NULL THEN
    RAISE EXCEPTION 'Telefone do lead e obrigatorio';
  END IF;

  IF v_instance IS NULL THEN
    RAISE EXCEPTION 'Selecione uma instancia valida para criar o lead';
  END IF;

  SELECT instance.created_by
  INTO v_instance_owner_id
  FROM crm.instance AS instance
  WHERE instance.aces_id = v_aces_id
    AND instance.instancia = v_instance
    AND COALESCE(instance.setup_status, 'connected') <> 'cancelled'
    AND instance.created_by = v_current_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A instancia selecionada nao pertence ao usuario atual';
  END IF;

  IF v_instance_owner_id IS NULL THEN
    RAISE EXCEPTION 'A instancia selecionada nao possui um responsavel configurado';
  END IF;

  IF p_stage_id IS NOT NULL THEN
    SELECT stage.category::text, stage.name::text
    INTO v_stage_category, v_stage_name
    FROM crm.pipeline_stages AS stage
    WHERE stage.id = p_stage_id
      AND stage.aces_id = v_aces_id
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Etapa nao encontrada para a conta atual';
    END IF;
  END IF;

  -- Serializa criacoes feitas pela RPC para a mesma conta/identidade. O indice
  -- parcial continua sendo a ultima barreira para inserts feitos fora da RPC.
  PERFORM pg_catalog.pg_advisory_xact_lock(v_aces_id, pg_catalog.hashtext(v_phone_identity));

  SELECT lead.id, lead.owner_id, lead.status, lead.stage_id
  INTO v_lead_id, v_lead_owner_id, v_lead_status, v_lead_stage_id
  FROM crm.leads AS lead
  WHERE lead.aces_id = v_aces_id
    AND lead.phone_identity = v_phone_identity
    AND COALESCE(lead.view, TRUE) IS TRUE
  ORDER BY lead.updated_at DESC NULLS LAST, lead.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'already_exists', true,
      'lead_id', v_lead_id,
      'owner_id', v_lead_owner_id,
      'status', v_lead_status,
      'stage_id', v_lead_stage_id,
      'opportunity_created', false,
      'restored_deleted_lead', false,
      'message', 'Ja existe um lead ativo com este telefone na conta'
    );
  END IF;

  SELECT lead.id
  INTO v_deleted_lead_id
  FROM crm.leads AS lead
  WHERE lead.aces_id = v_aces_id
    AND lead.phone_identity = v_phone_identity
    AND COALESCE(lead.view, TRUE) IS FALSE
  ORDER BY lead.updated_at DESC NULLS LAST, lead.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    UPDATE crm.leads AS lead
    SET
      owner_id = v_instance_owner_id,
      name = v_name,
      contact_phone = v_contact_phone,
      email = NULLIF(btrim(COALESCE(p_email, '')), ''),
      "Fonte" = NULLIF(btrim(COALESCE(p_source, '')), ''),
      last_city = NULLIF(btrim(COALESCE(p_last_city, '')), ''),
      notes = NULLIF(btrim(COALESCE(p_notes, '')), ''),
      stage_id = p_stage_id,
      status = CASE
        WHEN p_stage_id IS NULL THEN NULL
        WHEN v_stage_category = 'Ganho' THEN 'Fechado'
        WHEN v_stage_category = 'Perdido' THEN 'Perdido'
        ELSE v_stage_name
      END,
      instancia = v_instance,
      view = TRUE,
      updated_at = now()
    WHERE lead.id = v_deleted_lead_id
    RETURNING lead.id, lead.owner_id, lead.status, lead.stage_id
    INTO v_lead_id, v_lead_owner_id, v_lead_status, v_lead_stage_id;

    v_restored_deleted_lead := true;
  ELSE
    INSERT INTO crm.leads (
      aces_id,
      owner_id,
      name,
      contact_phone,
      email,
      "Fonte",
      last_city,
      notes,
      stage_id,
      status,
      instancia,
      view
    )
    VALUES (
      v_aces_id,
      v_instance_owner_id,
      v_name,
      v_contact_phone,
      NULLIF(btrim(COALESCE(p_email, '')), ''),
      NULLIF(btrim(COALESCE(p_source, '')), ''),
      NULLIF(btrim(COALESCE(p_last_city, '')), ''),
      NULLIF(btrim(COALESCE(p_notes, '')), ''),
      p_stage_id,
      CASE
        WHEN p_stage_id IS NULL THEN NULL
        WHEN v_stage_category = 'Ganho' THEN 'Fechado'
        WHEN v_stage_category = 'Perdido' THEN 'Perdido'
        ELSE v_stage_name
      END,
      v_instance,
      TRUE
    )
    RETURNING id, owner_id, status, stage_id
    INTO v_lead_id, v_lead_owner_id, v_lead_status, v_lead_stage_id;
  END IF;

  IF p_value IS NOT NULL
    OR NULLIF(btrim(COALESCE(p_connection_level, '')), '') IS NOT NULL THEN
    v_normalized_opportunity_status := CASE
      WHEN lower(COALESCE(v_lead_status, '')) IN ('ganho', 'fechado', 'sucesso', 'vendido')
        THEN 'Fechado'::crm.lead_status
      WHEN lower(COALESCE(v_lead_status, '')) IN ('perdido', 'cancelado', 'cancelada')
        THEN 'Perdido'::crm.lead_status
      WHEN lower(COALESCE(v_lead_status, '')) = 'remarketing'
        THEN 'Remarketing'::crm.lead_status
      WHEN lower(COALESCE(v_lead_status, '')) = 'atendimento'
        THEN 'Atendimento'::crm.lead_status
      WHEN lower(COALESCE(v_lead_status, '')) IN ('orcamento', 'orçamento')
        THEN 'Orçamento'::crm.lead_status
      ELSE 'Novo'::crm.lead_status
    END;

    SELECT opportunity.id
    INTO v_existing_opportunity_id
    FROM crm.opportunities AS opportunity
    WHERE opportunity.lead_id = v_lead_id
      AND opportunity.aces_id = v_aces_id
    ORDER BY opportunity.created_at DESC
    LIMIT 1;

    IF v_existing_opportunity_id IS NULL THEN
      INSERT INTO crm.opportunities (
        lead_id,
        aces_id,
        status,
        value,
        connection_level,
        responsible_id
      )
      VALUES (
        v_lead_id,
        v_aces_id,
        v_normalized_opportunity_status,
        p_value,
        NULLIF(btrim(COALESCE(p_connection_level, '')), ''),
        v_instance_owner_id
      );
    ELSE
      UPDATE crm.opportunities
      SET
        status = v_normalized_opportunity_status,
        value = p_value,
        connection_level = NULLIF(btrim(COALESCE(p_connection_level, '')), ''),
        responsible_id = COALESCE(responsible_id, v_instance_owner_id),
        updated_at = now()
      WHERE id = v_existing_opportunity_id;
    END IF;

    v_opportunity_created := true;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'lead_id', v_lead_id,
    'owner_id', v_lead_owner_id,
    'status', v_lead_status,
    'stage_id', v_lead_stage_id,
    'opportunity_created', v_opportunity_created,
    'restored_deleted_lead', v_restored_deleted_lead,
    'message', CASE
      WHEN v_restored_deleted_lead THEN 'Lead restaurado da lixeira com sucesso'
      ELSE 'Lead criado com sucesso'
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_create_lead(
  p_name text,
  p_contact_phone text,
  p_email text DEFAULT NULL,
  p_source text DEFAULT 'WhatsApp',
  p_last_city text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_stage_id uuid DEFAULT NULL,
  p_instance text DEFAULT NULL,
  p_value numeric DEFAULT NULL,
  p_connection_level text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT public.rpc_create_lead(
    p_name,
    p_contact_phone,
    p_email,
    p_source,
    p_last_city,
    p_notes,
    p_stage_id,
    p_instance,
    p_value,
    p_connection_level
  )
$$;

REVOKE ALL ON FUNCTION public.rpc_create_lead(
  text, text, text, text, text, text, uuid, text, numeric, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_lead(
  text, text, text, text, text, text, uuid, text, numeric, text
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION crm.rpc_create_lead(
  text, text, text, text, text, text, uuid, text, numeric, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm.rpc_create_lead(
  text, text, text, text, text, text, uuid, text, numeric, text
) TO authenticated, service_role;

COMMENT ON COLUMN crm.leads.phone_identity IS
  'Identidade de matching. Para numeros BR, considera equivalentes codigo 55 e nono digito opcional do WhatsApp.';
