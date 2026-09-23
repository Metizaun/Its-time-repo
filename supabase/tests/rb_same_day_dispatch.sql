-- Integration scenarios for the RB same-day decision dispatcher.
-- Safe to run against local Supabase only: every fixture is removed at the end.
BEGIN;

SELECT plan(1);

DO $$
DECLARE
  v_account_id integer;
  v_attendance_stage_id uuid;
  v_funnel_id uuid;
  v_lead_id uuid;
  v_inbound_lead_id uuid;
  v_expired_lead_id uuid;
  v_missing_phone_lead_id uuid;
  v_response jsonb;
  v_execution crm.automation_executions%ROWTYPE;
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_execution_count integer;
BEGIN
  INSERT INTO crm.accounts (name, rb_same_day_dispatch_enabled)
  VALUES ('RB same-day test fixture', TRUE)
  RETURNING id INTO v_account_id;

  -- Accounts receive their default stages at creation and are capped at five.
  -- Reuse one as the active funnel's required reply destination; it is only
  -- fixture plumbing and is removed with the account at the end.
  SELECT id INTO v_attendance_stage_id
  FROM crm.pipeline_stages
  WHERE aces_id = v_account_id
  ORDER BY position, created_at
  LIMIT 1;

  UPDATE crm.pipeline_stages
  SET name = 'Atendimento'
  WHERE id = v_attendance_stage_id;

  INSERT INTO crm.instance (instancia, aces_id, status)
  VALUES ('cobranca', v_account_id, 'connected');

  INSERT INTO crm.instance (instancia, aces_id, status)
  VALUES ('visual-only-change', v_account_id, 'connected');

  INSERT INTO crm.automation_funnels (
    aces_id, name, instance_name, is_active, entry_source, anchor_event,
    trigger_stage_id, reply_target_stage_id
  ) VALUES (
    v_account_id, 'RB same-day test fixture', 'cobranca', TRUE, 'rb',
    'stage_entered_at', v_attendance_stage_id, v_attendance_stage_id
  )
  RETURNING id INTO v_funnel_id;

  INSERT INTO crm.automation_steps (
    funnel_id, position, label, delay_minutes, message_template,
    rb_message_kind, rb_days_offset
  ) VALUES (
    v_funnel_id, 0, 'Cobranca RB', 0, 'Mensagem de teste', 'charge', 0
  );

  -- After 09:00 BRT this is due immediately; before 09:00 the function fixes
  -- the schedule at 09:00 BRT of the same date.
  INSERT INTO crm.leads (aces_id, name, contact_phone, instancia)
  VALUES (v_account_id, 'Lead RB imediato', '5511999999999', 'cobranca')
  RETURNING id INTO v_lead_id;

  SELECT crm.enqueue_rb_same_day_dispatch(
    v_account_id, v_lead_id, v_funnel_id, '5511999999999|store-1', v_today,
    jsonb_build_object('message_kind', 'charge', 'days_offset', 0)
  ) INTO v_response;

  IF v_response->>'mode' <> 'same_day'
     OR COALESCE((v_response->>'created')::boolean, FALSE) IS NOT TRUE
     OR COALESCE((v_response->>'scheduled')::boolean, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'RB did not create a concrete same-day execution: %', v_response;
  END IF;

  SELECT * INTO v_execution
  FROM crm.automation_executions
  WHERE id = (v_response->>'execution_id')::uuid;

  IF v_execution.status <> 'pending'
     OR v_execution.rb_decision_local_date <> v_today
     OR v_execution.scheduled_at::date < v_today THEN
    RAISE EXCEPTION 'RB execution has an invalid same-day schedule';
  END IF;

  SELECT crm.enqueue_rb_same_day_dispatch(
    v_account_id, v_lead_id, v_funnel_id, '5511999999999|store-1', v_today,
    jsonb_build_object('message_kind', 'charge', 'days_offset', 0)
  ) INTO v_response;

  IF COALESCE((v_response->>'duplicate')::boolean, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'RB did not reuse the same decision on the same day';
  END IF;

  SELECT count(*) INTO v_execution_count
  FROM crm.automation_executions
  WHERE lead_id = v_lead_id AND rb_decision_key = '5511999999999|store-1';

  IF v_execution_count <> 1 THEN
    RAISE EXCEPTION 'RB created more than one execution for the same occurrence';
  END IF;

  -- A later pipeline/instance movement must not cancel a pending RB decision.
  UPDATE crm.leads SET instancia = 'visual-only-change' WHERE id = v_lead_id;
  PERFORM crm.revalidate_active_enrollments_for_lead(v_lead_id);

  SELECT * INTO v_enrollment
  FROM crm.automation_enrollments
  WHERE lead_id = v_lead_id AND rb_decision_key = '5511999999999|store-1';

  IF v_enrollment.status <> 'active' THEN
    RAISE EXCEPTION 'A stage or instance change cancelled the RB decision';
  END IF;

  -- Hiding the lead represents an explicit manual block and must be traceable.
  UPDATE crm.leads SET view = FALSE WHERE id = v_lead_id;
  PERFORM crm.revalidate_active_enrollments_for_lead(v_lead_id);

  SELECT * INTO v_execution
  FROM crm.automation_executions
  WHERE lead_id = v_lead_id AND rb_decision_key = '5511999999999|store-1';

  IF v_execution.status <> 'cancelled'
     OR v_execution.rb_outcome_code <> 'rb_cancelled_manual_block' THEN
    RAISE EXCEPTION 'Manual RB block did not receive an explicit outcome';
  END IF;

  -- Inbound replies are also explicit, structured cancellations.
  INSERT INTO crm.leads (aces_id, name, contact_phone, instancia)
  VALUES (v_account_id, 'Lead RB inbound', '5511988888888', 'cobranca')
  RETURNING id INTO v_inbound_lead_id;
  PERFORM crm.upsert_lead_automation_state_from_lead(v_inbound_lead_id);
  PERFORM crm.enqueue_rb_same_day_dispatch(
    v_account_id, v_inbound_lead_id, v_funnel_id, '5511988888888|store-1', v_today, '{}'::jsonb
  );
  PERFORM crm.handle_inbound_exit_for_lead(v_inbound_lead_id);

  SELECT * INTO v_execution
  FROM crm.automation_executions
  WHERE lead_id = v_inbound_lead_id AND rb_decision_key = '5511988888888|store-1';

  IF v_execution.status <> 'cancelled'
     OR v_execution.rb_outcome_code <> 'rb_cancelled_inbound' THEN
    RAISE EXCEPTION 'Inbound RB cancellation did not receive an explicit outcome';
  END IF;

  -- A pending decision from a previous local day is failed, never carried to tomorrow.
  INSERT INTO crm.leads (aces_id, name, contact_phone, instancia)
  VALUES (v_account_id, 'Lead RB expirado', '5511977777777', 'cobranca')
  RETURNING id INTO v_expired_lead_id;
  PERFORM crm.enqueue_rb_same_day_dispatch(
    v_account_id, v_expired_lead_id, v_funnel_id, '5511977777777|store-1', v_today, '{}'::jsonb
  );
  UPDATE crm.automation_enrollments
  SET rb_decision_local_date = v_today - 1
  WHERE lead_id = v_expired_lead_id;
  UPDATE crm.automation_executions
  SET rb_decision_local_date = v_today - 1
  WHERE lead_id = v_expired_lead_id;
  PERFORM crm.expire_rb_same_day_dispatches();

  SELECT * INTO v_execution
  FROM crm.automation_executions
  WHERE lead_id = v_expired_lead_id AND rb_decision_key = '5511977777777|store-1';

  IF v_execution.status <> 'failed'
     OR v_execution.rb_outcome_code <> 'rb_same_day_deadline_exceeded' THEN
    RAISE EXCEPTION 'Expired RB decision was not failed explicitly';
  END IF;

  -- Missing contact data is terminal and visible instead of becoming a silent queue item.
  INSERT INTO crm.leads (aces_id, name, instancia)
  VALUES (v_account_id, 'Lead RB sem telefone', 'cobranca')
  RETURNING id INTO v_missing_phone_lead_id;
  SELECT crm.enqueue_rb_same_day_dispatch(
    v_account_id, v_missing_phone_lead_id, v_funnel_id, 'missing-phone|store-1', v_today, '{}'::jsonb
  ) INTO v_response;

  IF v_response->>'status' <> 'failed' OR v_response->>'outcome_code' <> 'rb_missing_phone' THEN
    RAISE EXCEPTION 'Missing phone did not receive a terminal RB failure: %', v_response;
  END IF;

  DELETE FROM crm.leads WHERE aces_id = v_account_id;
  DELETE FROM crm.automation_funnels WHERE aces_id = v_account_id;
  DELETE FROM crm.instance WHERE aces_id = v_account_id;
  DELETE FROM crm.pipeline_stages WHERE aces_id = v_account_id;
  DELETE FROM crm.pipelines WHERE aces_id = v_account_id;
  DELETE FROM crm.accounts WHERE id = v_account_id;
END;
$$;

SELECT pass('cenarios de decisao diaria do RB foram executados');
SELECT * FROM finish();
ROLLBACK;
