BEGIN;

-- A pessoa que recebe um atendimento precisa enxergar somente o lead atribuido,
-- mesmo quando pertence a outra empresa operacional da mesma conta.
CREATE OR REPLACE FUNCTION crm.current_user_can_access_lead(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM crm.leads AS lead
    WHERE lead.id = p_lead_id
      AND lead.aces_id = public.current_aces_id()
      AND (
        crm.current_user_is_account_admin()
        OR lead.owner_id = public.current_crm_user_id()
        OR (
          crm.current_user_can_access_instance(lead.instancia, 'viewer')
          AND crm.current_user_has_empresa_access(lead.empresa_id)
        )
      )
  );
$$;

COMMENT ON FUNCTION crm.current_user_can_access_lead(uuid) IS
  'Autoriza administradores, o responsavel direto do lead ou usuarios com acesso a empresa e instancia.';

CREATE OR REPLACE FUNCTION crm.rpc_forward_human_handoff(
  p_lead_id uuid,
  p_user_id uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_aces_id integer := public.current_aces_id();
  v_actor_id uuid := public.current_crm_user_id();
  v_lead crm.leads%ROWTYPE;
  v_target crm.users%ROWTYPE;
  v_event crm.routing_events%ROWTYPE;
  v_idempotency_key text := COALESCE(
    NULLIF(btrim(p_idempotency_key), ''),
    'manual-handoff:' || gen_random_uuid()::text
  );
BEGIN
  IF v_aces_id IS NULL OR v_actor_id IS NULL OR NOT crm.current_user_is_account_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem encaminhar atendimentos';
  END IF;

  IF p_user_id IS NULL OR p_user_id = v_actor_id THEN
    RAISE EXCEPTION 'Escolha outro usuario para receber o atendimento';
  END IF;

  SELECT *
  INTO v_lead
  FROM crm.leads AS lead
  WHERE lead.id = p_lead_id
    AND lead.aces_id = v_aces_id
    AND COALESCE(lead.view, true) IS TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead nao encontrado';
  END IF;

  IF v_lead.interaction_mode <> 'human' THEN
    RAISE EXCEPTION 'Este atendimento nao esta em modo humano';
  END IF;

  SELECT *
  INTO v_target
  FROM crm.users AS target_user
  WHERE target_user.id = p_user_id
    AND target_user.aces_id = v_aces_id
    AND target_user.auth_user_id IS NOT NULL
    AND target_user.role IN (
      'ADMIN'::crm.user_role,
      'VENDEDOR'::crm.user_role
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario de destino invalido ou pertence a outra conta';
  END IF;

  SELECT *
  INTO v_event
  FROM crm.routing_events AS routing_event
  WHERE routing_event.aces_id = v_aces_id
    AND routing_event.idempotency_key = v_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    IF v_event.lead_id <> p_lead_id
      OR v_event.claimed_by_user_id IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'Chave de idempotencia ja utilizada em outro encaminhamento';
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'forwarded', true,
      'idempotent', true,
      'routing_event_id', v_event.id,
      'lead_id', p_lead_id,
      'target_user_id', p_user_id,
      'target_user_name', COALESCE(v_target.name, v_target.email)
    );
  END IF;

  SELECT *
  INTO v_event
  FROM crm.routing_events AS routing_event
  WHERE routing_event.aces_id = v_aces_id
    AND routing_event.lead_id = p_lead_id
    AND routing_event.destination_mode = 'internal_company'
    AND routing_event.queue_status IN ('waiting', 'claimed')
  ORDER BY routing_event.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE crm.routing_events AS routing_event
    SET queue_status = CASE
          WHEN routing_event.queue_status = 'waiting' THEN 'cancelled'
          ELSE 'closed'
        END,
        closed_at = now()
    WHERE routing_event.aces_id = v_aces_id
      AND routing_event.lead_id = p_lead_id
      AND routing_event.destination_mode = 'internal_company'
      AND routing_event.queue_status IN ('waiting', 'claimed')
      AND routing_event.id <> v_event.id;

    UPDATE crm.routing_events
    SET queue_status = 'claimed',
        claimed_by_user_id = p_user_id,
        claimed_at = now(),
        closed_at = NULL,
        seller_ids_snapshot = jsonb_build_array(p_user_id),
        context_snapshot = COALESCE(context_snapshot, '{}'::jsonb) || jsonb_build_object(
          'manual_forwarded_by_user_id', v_actor_id,
          'manual_forwarded_to_user_id', p_user_id,
          'manual_forwarded_at', now()
        )
    WHERE id = v_event.id
    RETURNING * INTO v_event;
  ELSE
    INSERT INTO crm.routing_events (
      aces_id,
      lead_id,
      empresa_id,
      destination_mode,
      status,
      queue_status,
      claimed_by_user_id,
      claimed_at,
      reason,
      seller_ids_snapshot,
      context_snapshot,
      idempotency_key,
      completed_at
    ) VALUES (
      v_aces_id,
      p_lead_id,
      v_lead.empresa_id,
      'internal_company',
      'completed',
      'claimed',
      p_user_id,
      now(),
      'Encaminhamento manual pelo Chat',
      jsonb_build_array(p_user_id),
      jsonb_build_object(
        'manual_forwarded_by_user_id', v_actor_id,
        'manual_forwarded_to_user_id', p_user_id,
        'manual_forwarded_at', now()
      ),
      v_idempotency_key,
      now()
    )
    RETURNING * INTO v_event;
  END IF;

  INSERT INTO crm.routing_event_recipients (
    routing_event_id,
    aces_id,
    crm_user_id
  ) VALUES (
    v_event.id,
    v_aces_id,
    p_user_id
  )
  ON CONFLICT (routing_event_id, crm_user_id) DO NOTHING;

  UPDATE crm.leads
  SET owner_id = p_user_id,
      interaction_mode = 'human',
      updated_at = now()
  WHERE id = p_lead_id
    AND aces_id = v_aces_id;

  INSERT INTO crm.notifications (
    aces_id,
    category,
    event_type,
    title,
    description,
    lead_id,
    routing_event_id,
    action_path,
    idempotency_key
  )
  SELECT
    v_aces_id,
    'internal',
    'manual_handoff_forwarded',
    'Atendimento encaminhado para voce',
    COALESCE(v_lead.name, 'Lead') || ' foi encaminhado para o seu atendimento.',
    p_lead_id,
    v_event.id,
    '/chat?leadId=' || p_lead_id::text,
    'manual-handoff-forward:' || v_event.id::text
  WHERE NOT EXISTS (
    SELECT 1
    FROM crm.notifications AS notification
    WHERE notification.routing_event_id = v_event.id
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'forwarded', true,
    'idempotent', false,
    'routing_event_id', v_event.id,
    'lead_id', p_lead_id,
    'target_user_id', p_user_id,
    'target_user_name', COALESCE(v_target.name, v_target.email)
  );
END;
$$;

COMMENT ON FUNCTION crm.rpc_forward_human_handoff(uuid, uuid, text) IS
  'Encaminha atomicamente um atendimento humano para outro usuario da mesma conta.';

REVOKE ALL ON FUNCTION crm.rpc_forward_human_handoff(uuid, uuid, text)
  FROM PUBLIC, anon, authenticator;
GRANT EXECUTE ON FUNCTION crm.rpc_forward_human_handoff(uuid, uuid, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
