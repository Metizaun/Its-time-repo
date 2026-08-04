BEGIN;

DO $$
DECLARE
  v_parent_agent_id uuid;
  v_subagent_id uuid;
  v_lead_id uuid;
  v_session_id uuid;
BEGIN
  SELECT parent.id, child.id
    INTO v_parent_agent_id, v_subagent_id
  FROM agents.ai_agents AS parent
  JOIN agents.ai_agents AS child ON child.parent_agent_id = parent.id
  JOIN agents.agent_tools AS tool ON tool.agent_id = child.id
  WHERE parent.aces_id = 1
    AND parent.instance_name = 'cardeal-local-test'
    AND parent.agent_type = 'primary'
    AND child.agent_type = 'subagent'
    AND child.agent_key = 'cardeal_clinical_assistant'
    AND child.instance_name IS NULL
    AND child.rag_enabled IS FALSE
    AND tool.tool_key = 'calendar'
    AND tool.is_enabled IS TRUE
    AND tool.config->>'queryAvailability' = 'true'
    AND tool.config->>'create' = 'false'
    AND tool.config->>'reschedule' = 'false'
    AND tool.config->>'cancel' = 'false';

  IF v_parent_agent_id IS NULL OR v_subagent_id IS NULL THEN
    RAISE EXCEPTION 'Agentes completos da Cardeal ou agenda clinica segura nao encontrados';
  END IF;

  IF (SELECT ai_booking_enabled FROM calendar.settings WHERE aces_id = 1) IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'ai_booking_enabled deve permanecer false';
  END IF;

  INSERT INTO crm.leads (aces_id, name, contact_phone, instancia, interaction_mode)
  VALUES (1, 'Lead teste Cardeal', '5581999999999', 'cardeal-local-test', 'ai')
  RETURNING id INTO v_lead_id;

  INSERT INTO agents.agent_transfer_sessions (
    aces_id, lead_id, source_agent_id, target_agent_id, status, context_snapshot
  ) VALUES (
    1, v_lead_id, v_parent_agent_id, v_subagent_id, 'active', '{"intent":"professionals"}'::jsonb
  ) RETURNING id INTO v_session_id;

  BEGIN
    INSERT INTO agents.agent_transfer_sessions (aces_id, lead_id, source_agent_id, target_agent_id, status)
    VALUES (1, v_lead_id, v_parent_agent_id, v_subagent_id, 'active');
    RAISE EXCEPTION 'A segunda transferencia ativa deveria ter sido bloqueada';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  INSERT INTO crm.message_history (
    lead_id, aces_id, content, direction, instance, source_type, sender_agent_id
  ) VALUES (
    v_lead_id, 1, 'Resposta direta do agente clinico', 'outbound',
    'cardeal-local-test', 'ai', v_subagent_id
  );

  IF NOT EXISTS (
    SELECT 1
    FROM crm.message_history AS message
    JOIN agents.ai_agents AS child ON child.id = message.sender_agent_id
    JOIN agents.ai_agents AS parent ON parent.id = child.parent_agent_id
    WHERE message.lead_id = v_lead_id
      AND child.id = v_subagent_id
      AND message.instance = parent.instance_name
  ) THEN
    RAISE EXCEPTION 'Autoria do subagente ou canal herdado nao foi preservado';
  END IF;

  UPDATE agents.agent_transfer_sessions
  SET status = 'completed', ended_at = now(), context_snapshot = '{"returned_to_primary":true}'::jsonb
  WHERE id = v_session_id;

  IF EXISTS (
    SELECT 1 FROM calendar.events
    WHERE aces_id = 1 AND created_at >= transaction_timestamp()
  ) THEN
    RAISE EXCEPTION 'O teste nao pode criar eventos de agenda';
  END IF;
END;
$$;

ROLLBACK;
