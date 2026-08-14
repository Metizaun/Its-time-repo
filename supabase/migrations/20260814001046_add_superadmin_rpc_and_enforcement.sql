-- Service-role-only RPC facade. The costs schema remains outside PostgREST.

CREATE OR REPLACE FUNCTION costs.check_ai_budget(
  p_aces_id integer,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE (
  allowed boolean,
  status text,
  consumed_brl numeric,
  budget_brl numeric,
  pct numeric
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_subscription costs.subscriptions%ROWTYPE;
  v_cycle_id uuid;
  v_cycle costs.budget_cycles%ROWTYPE;
  v_effective numeric;
BEGIN
  SELECT * INTO v_subscription
  FROM costs.subscriptions AS subscription
  WHERE subscription.aces_id = p_aces_id
    AND subscription.status = 'active'
    AND subscription.started_at <= p_at
    AND (subscription.ended_at IS NULL OR subscription.ended_at > p_at)
  ORDER BY subscription.started_at DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT true, 'no_contract'::text, 0::numeric, NULL::numeric, 0::numeric;
    RETURN;
  END IF;

  v_cycle_id := costs.ensure_current_cycle(p_aces_id, p_at);
  IF v_cycle_id IS NULL THEN
    RETURN QUERY SELECT true, 'unlimited'::text, 0::numeric, NULL::numeric, 0::numeric;
    RETURN;
  END IF;

  PERFORM costs.refresh_budget_cycle_status(v_cycle_id);
  SELECT * INTO v_cycle FROM costs.budget_cycles WHERE id = v_cycle_id;
  v_effective := GREATEST(v_cycle.consumed_brl - v_cycle.credit_brl, 0);

  RETURN QUERY SELECT
    (NOT v_subscription.enforcement_enabled OR v_effective < v_cycle.budget_brl),
    CASE WHEN NOT v_subscription.enforcement_enabled THEN 'observing' ELSE v_cycle.status END,
    v_effective,
    v_cycle.budget_brl,
    CASE WHEN v_cycle.budget_brl = 0 THEN 100::numeric
      ELSE round((v_effective / v_cycle.budget_brl) * 100, 2)
    END;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.service_check_ai_budget(
  p_aces_id integer,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT to_jsonb(result)
  FROM costs.check_ai_budget(p_aces_id, p_at) AS result;
$function$;

CREATE OR REPLACE FUNCTION crm.service_admin_is_staff(p_auth_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM costs.admin_staff AS staff
    WHERE staff.auth_user_id = p_auth_user_id
  );
$function$;

CREATE OR REPLACE FUNCTION crm.service_admin_overview()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
WITH latest AS (
  SELECT * FROM costs.v_monthly_financials ORDER BY competencia DESC LIMIT 1
), ranking AS (
  SELECT
    account.id AS aces_id,
    account.name,
    COALESCE(sum(item.billed_cost_brl), 0) AS consumed_brl,
    COALESCE(sum(item.provider_cost_brl), 0) AS provider_cost_brl
  FROM crm.accounts AS account
  LEFT JOIN costs.v_monthly_cost_dimensions AS item
    ON item.aces_id = account.id
    AND item.competencia = date_trunc('month', now())::date
  WHERE NOT account.is_internal
    AND NOT EXISTS (
      SELECT 1 FROM costs.subscriptions AS subscription
      WHERE subscription.aces_id = account.id AND subscription.status = 'canceled'
      AND NOT EXISTS (
        SELECT 1 FROM costs.subscriptions AS live
        WHERE live.aces_id = account.id AND live.status <> 'canceled'
      )
    )
  GROUP BY account.id, account.name
  ORDER BY consumed_brl DESC
  LIMIT 10
), providers AS (
  SELECT provider,
    COALESCE(sum(billed_cost_brl), 0) AS billed_cost_brl,
    COALESCE(sum(provider_cost_brl), 0) AS provider_cost_brl
  FROM costs.v_monthly_cost_dimensions
  WHERE competencia = date_trunc('month', now())::date
    AND aces_id IN (SELECT id FROM crm.accounts WHERE NOT is_internal)
  GROUP BY provider
)
SELECT jsonb_build_object(
  'kpis', jsonb_build_object(
    'mrrBrl', COALESCE((SELECT mrr_brl FROM latest), 0),
    'revenueBookedBrl', COALESCE((SELECT revenue_booked_brl FROM latest), 0),
    'revenuePaidBrl', COALESCE((SELECT revenue_paid_brl FROM latest), 0),
    'billedConsumptionBrl', COALESCE((SELECT billed_consumption_brl FROM latest), 0),
    'providerCostBrl', COALESCE((SELECT provider_cost_brl FROM latest), 0),
    'fxMarginBrl', COALESCE((SELECT fx_margin_brl FROM latest), 0),
    'clientMarginBrl', COALESCE((SELECT client_margin_brl FROM latest), 0),
    'fixedCostBrl', COALESCE((SELECT fixed_cost_brl FROM latest), 0),
    'resultBrl', COALESCE((SELECT result_brl FROM latest), 0)
  ),
  'series', COALESCE((SELECT jsonb_agg(to_jsonb(series) ORDER BY competencia)
    FROM costs.v_monthly_financials AS series), '[]'::jsonb),
  'ranking', COALESCE((SELECT jsonb_agg(to_jsonb(ranking)) FROM ranking), '[]'::jsonb),
  'providers', COALESCE((SELECT jsonb_agg(to_jsonb(providers)) FROM providers), '[]'::jsonb),
  'unratedCount', (SELECT count(*) FROM costs.usage_events WHERE status = 'unrated')
);
$function$;

CREATE OR REPLACE FUNCTION crm.service_admin_accounts()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
WITH account_rows AS (
  SELECT
    cycle.*,
    (SELECT count(*) FROM crm.instance AS instance WHERE instance.aces_id = cycle.aces_id) AS instances_count,
    COALESCE((
      SELECT sum(month.provider_cost_brl)
      FROM costs.v_monthly_cost_dimensions AS month
      WHERE month.aces_id = cycle.aces_id
        AND month.competencia = date_trunc('month', now())::date
    ), 0) AS provider_cost_brl,
    COALESCE((
      SELECT sum(entry.valor_brl)
      FROM costs.revenue_entries AS entry
      WHERE entry.aces_id = cycle.aces_id
        AND entry.competencia = date_trunc('month', now())::date
    ), 0) AS revenue_brl
  FROM costs.v_account_cycle_status AS cycle
)
SELECT COALESCE(jsonb_agg(to_jsonb(account_rows) ORDER BY account_name), '[]'::jsonb)
FROM account_rows;
$function$;

CREATE OR REPLACE FUNCTION crm.service_admin_account(p_aces_id integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
SELECT jsonb_build_object(
  'account', COALESCE((
    SELECT to_jsonb(account) FROM costs.v_account_cycle_status AS account
    WHERE account.aces_id = p_aces_id
  ), '{}'::jsonb),
  'subscription', COALESCE((
    SELECT to_jsonb(subscription) FROM costs.subscriptions AS subscription
    WHERE subscription.aces_id = p_aces_id AND subscription.status <> 'canceled'
    ORDER BY subscription.started_at DESC LIMIT 1
  ), 'null'::jsonb),
  'dimensions', COALESCE((
    SELECT jsonb_agg(to_jsonb(item) ORDER BY item.competencia DESC, item.feature_key)
    FROM costs.v_monthly_cost_dimensions AS item WHERE item.aces_id = p_aces_id
  ), '[]'::jsonb),
  'revenue', COALESCE((
    SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.competencia DESC, entry.created_at DESC)
    FROM costs.revenue_entries AS entry WHERE entry.aces_id = p_aces_id
  ), '[]'::jsonb),
  'resets', COALESCE((
    SELECT jsonb_agg(to_jsonb(reset) ORDER BY reset.created_at DESC)
    FROM costs.budget_resets AS reset WHERE reset.aces_id = p_aces_id
  ), '[]'::jsonb)
);
$function$;

CREATE OR REPLACE FUNCTION crm.service_admin_finance_catalog()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
SELECT jsonb_build_object(
  'plans', COALESCE((SELECT jsonb_agg(to_jsonb(plan) ORDER BY plan.name) FROM costs.plans AS plan), '[]'::jsonb),
  'revenue', COALESCE((SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.competencia DESC, entry.created_at DESC) FROM costs.revenue_entries AS entry), '[]'::jsonb),
  'fixedCosts', COALESCE((SELECT jsonb_agg(to_jsonb(cost) ORDER BY cost.nome) FROM costs.fixed_costs AS cost), '[]'::jsonb),
  'exchangeRates', COALESCE((SELECT jsonb_agg(to_jsonb(rate) ORDER BY rate.effective_at DESC) FROM costs.exchange_rates AS rate), '[]'::jsonb)
);
$function$;

CREATE OR REPLACE FUNCTION crm.service_admin_upsert_subscription(
  p_aces_id integer,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_subscription costs.subscriptions%ROWTYPE;
  v_existing_id uuid;
BEGIN
  SELECT id INTO v_existing_id FROM costs.subscriptions
  WHERE aces_id = p_aces_id AND status <> 'canceled'
  ORDER BY started_at DESC LIMIT 1;

  IF v_existing_id IS NULL THEN
    INSERT INTO costs.subscriptions (
      aces_id, plan_id, status, started_at, ended_at, cycle_anchor_day,
      implantacao_brl, implantacao_paga_em, mensalidade_brl_override,
      ai_budget_brl_override, enforcement_enabled
    ) VALUES (
      p_aces_id, (p_payload->>'planId')::uuid,
      COALESCE(p_payload->>'status', 'active'),
      COALESCE((p_payload->>'startedAt')::timestamptz, now()),
      (p_payload->>'endedAt')::timestamptz,
      COALESCE((p_payload->>'cycleAnchorDay')::smallint, 1),
      (p_payload->>'implantacaoBrl')::numeric,
      (p_payload->>'implantacaoPagaEm')::timestamptz,
      (p_payload->>'mensalidadeBrlOverride')::numeric,
      (p_payload->>'aiBudgetBrlOverride')::numeric,
      COALESCE((p_payload->>'enforcementEnabled')::boolean, false)
    ) RETURNING * INTO v_subscription;
  ELSE
    UPDATE costs.subscriptions
    SET plan_id = COALESCE((p_payload->>'planId')::uuid, plan_id),
        status = COALESCE(p_payload->>'status', status),
        started_at = COALESCE((p_payload->>'startedAt')::timestamptz, started_at),
        ended_at = CASE WHEN p_payload ? 'endedAt' THEN (p_payload->>'endedAt')::timestamptz ELSE ended_at END,
        cycle_anchor_day = COALESCE((p_payload->>'cycleAnchorDay')::smallint, cycle_anchor_day),
        implantacao_brl = CASE WHEN p_payload ? 'implantacaoBrl' THEN (p_payload->>'implantacaoBrl')::numeric ELSE implantacao_brl END,
        implantacao_paga_em = CASE WHEN p_payload ? 'implantacaoPagaEm' THEN (p_payload->>'implantacaoPagaEm')::timestamptz ELSE implantacao_paga_em END,
        mensalidade_brl_override = CASE WHEN p_payload ? 'mensalidadeBrlOverride' THEN (p_payload->>'mensalidadeBrlOverride')::numeric ELSE mensalidade_brl_override END,
        ai_budget_brl_override = CASE WHEN p_payload ? 'aiBudgetBrlOverride' THEN (p_payload->>'aiBudgetBrlOverride')::numeric ELSE ai_budget_brl_override END,
        enforcement_enabled = COALESCE((p_payload->>'enforcementEnabled')::boolean, enforcement_enabled)
    WHERE id = v_existing_id
    RETURNING * INTO v_subscription;
  END IF;
  RETURN to_jsonb(v_subscription);
END;
$function$;

CREATE OR REPLACE FUNCTION crm.service_admin_reset_budget(
  p_aces_id integer,
  p_reason text,
  p_author uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE v_cycle_id uuid;
BEGIN
  v_cycle_id := costs.reset_ai_budget(p_aces_id, p_reason, p_author, now());
  RETURN (SELECT to_jsonb(cycle) FROM costs.budget_cycles AS cycle WHERE cycle.id = v_cycle_id);
END;
$function$;

CREATE OR REPLACE FUNCTION crm.service_admin_mutate(
  p_resource text,
  p_action text,
  p_id uuid,
  p_payload jsonb,
  p_author uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_action NOT IN ('create', 'update', 'delete') THEN RAISE EXCEPTION 'Acao administrativa invalida'; END IF;

  IF p_resource = 'plans' THEN
    IF p_action = 'create' THEN
      INSERT INTO costs.plans (code, name, mensalidade_brl, implantacao_brl, ai_budget_brl,
        warn_threshold_pct, max_usuarios, max_instancias, is_active)
      VALUES (p_payload->>'code', p_payload->>'name', (p_payload->>'mensalidadeBrl')::numeric,
        (p_payload->>'implantacaoBrl')::numeric, (p_payload->>'aiBudgetBrl')::numeric,
        COALESCE((p_payload->>'warnThresholdPct')::numeric, 80), (p_payload->>'maxUsuarios')::integer,
        (p_payload->>'maxInstancias')::integer, COALESCE((p_payload->>'isActive')::boolean, true))
      RETURNING to_jsonb(costs.plans.*) INTO v_result;
    ELSIF p_action = 'update' THEN
      UPDATE costs.plans SET
        code = COALESCE(p_payload->>'code', code), name = COALESCE(p_payload->>'name', name),
        mensalidade_brl = COALESCE((p_payload->>'mensalidadeBrl')::numeric, mensalidade_brl),
        implantacao_brl = COALESCE((p_payload->>'implantacaoBrl')::numeric, implantacao_brl),
        ai_budget_brl = CASE WHEN p_payload ? 'aiBudgetBrl' THEN (p_payload->>'aiBudgetBrl')::numeric ELSE ai_budget_brl END,
        warn_threshold_pct = COALESCE((p_payload->>'warnThresholdPct')::numeric, warn_threshold_pct),
        max_usuarios = CASE WHEN p_payload ? 'maxUsuarios' THEN (p_payload->>'maxUsuarios')::integer ELSE max_usuarios END,
        max_instancias = CASE WHEN p_payload ? 'maxInstancias' THEN (p_payload->>'maxInstancias')::integer ELSE max_instancias END,
        is_active = COALESCE((p_payload->>'isActive')::boolean, is_active)
      WHERE id = p_id RETURNING to_jsonb(costs.plans.*) INTO v_result;
    ELSE
      DELETE FROM costs.plans WHERE id = p_id RETURNING to_jsonb(costs.plans.*) INTO v_result;
    END IF;
  ELSIF p_resource = 'revenue' THEN
    IF p_action = 'create' THEN
      INSERT INTO costs.revenue_entries (aces_id, competencia, tipo, valor_brl, status, pago_em, descricao, created_by)
      VALUES ((p_payload->>'acesId')::integer, (p_payload->>'competencia')::date, p_payload->>'tipo',
        (p_payload->>'valorBrl')::numeric, COALESCE(p_payload->>'status', 'previsto'),
        (p_payload->>'pagoEm')::timestamptz, p_payload->>'descricao', p_author)
      RETURNING to_jsonb(costs.revenue_entries.*) INTO v_result;
    ELSIF p_action = 'update' THEN
      UPDATE costs.revenue_entries SET
        aces_id = COALESCE((p_payload->>'acesId')::integer, aces_id),
        competencia = COALESCE((p_payload->>'competencia')::date, competencia),
        tipo = COALESCE(p_payload->>'tipo', tipo), valor_brl = COALESCE((p_payload->>'valorBrl')::numeric, valor_brl),
        status = COALESCE(p_payload->>'status', status),
        pago_em = CASE WHEN p_payload ? 'pagoEm' THEN (p_payload->>'pagoEm')::timestamptz ELSE pago_em END,
        descricao = CASE WHEN p_payload ? 'descricao' THEN p_payload->>'descricao' ELSE descricao END
      WHERE id = p_id RETURNING to_jsonb(costs.revenue_entries.*) INTO v_result;
    ELSE
      DELETE FROM costs.revenue_entries WHERE id = p_id RETURNING to_jsonb(costs.revenue_entries.*) INTO v_result;
    END IF;
  ELSIF p_resource = 'fixed-costs' THEN
    IF p_action = 'create' THEN
      INSERT INTO costs.fixed_costs (nome, categoria, valor_brl, recorrencia, vigencia_inicio, vigencia_fim, created_by)
      VALUES (p_payload->>'nome', p_payload->>'categoria', (p_payload->>'valorBrl')::numeric,
        p_payload->>'recorrencia', (p_payload->>'vigenciaInicio')::date,
        (p_payload->>'vigenciaFim')::date, p_author)
      RETURNING to_jsonb(costs.fixed_costs.*) INTO v_result;
    ELSIF p_action = 'update' THEN
      UPDATE costs.fixed_costs SET
        nome = COALESCE(p_payload->>'nome', nome), categoria = COALESCE(p_payload->>'categoria', categoria),
        valor_brl = COALESCE((p_payload->>'valorBrl')::numeric, valor_brl),
        recorrencia = COALESCE(p_payload->>'recorrencia', recorrencia),
        vigencia_inicio = COALESCE((p_payload->>'vigenciaInicio')::date, vigencia_inicio),
        vigencia_fim = CASE WHEN p_payload ? 'vigenciaFim' THEN (p_payload->>'vigenciaFim')::date ELSE vigencia_fim END
      WHERE id = p_id RETURNING to_jsonb(costs.fixed_costs.*) INTO v_result;
    ELSE
      DELETE FROM costs.fixed_costs WHERE id = p_id RETURNING to_jsonb(costs.fixed_costs.*) INTO v_result;
    END IF;
  ELSIF p_resource = 'exchange-rates' THEN
    IF p_action = 'create' THEN
      INSERT INTO costs.exchange_rates (from_currency, to_currency, rate, rate_kind, source, effective_at, metadata)
      VALUES (upper(COALESCE(p_payload->>'fromCurrency', 'USD')), upper(COALESCE(p_payload->>'toCurrency', 'BRL')),
        (p_payload->>'rate')::numeric, p_payload->>'rateKind', p_payload->>'source',
        (p_payload->>'effectiveAt')::timestamptz, COALESCE(p_payload->'metadata', '{}'::jsonb))
      RETURNING to_jsonb(costs.exchange_rates.*) INTO v_result;
    ELSIF p_action = 'update' THEN
      UPDATE costs.exchange_rates SET
        from_currency = upper(COALESCE(p_payload->>'fromCurrency', from_currency)),
        to_currency = upper(COALESCE(p_payload->>'toCurrency', to_currency)),
        rate = COALESCE((p_payload->>'rate')::numeric, rate),
        rate_kind = COALESCE(p_payload->>'rateKind', rate_kind), source = COALESCE(p_payload->>'source', source),
        effective_at = COALESCE((p_payload->>'effectiveAt')::timestamptz, effective_at),
        metadata = COALESCE(p_payload->'metadata', metadata)
      WHERE id = p_id RETURNING to_jsonb(costs.exchange_rates.*) INTO v_result;
    ELSE
      DELETE FROM costs.exchange_rates WHERE id = p_id RETURNING to_jsonb(costs.exchange_rates.*) INTO v_result;
    END IF;
  ELSE
    RAISE EXCEPTION 'Recurso administrativo invalido';
  END IF;

  IF v_result IS NULL THEN RAISE EXCEPTION 'Registro administrativo nao encontrado'; END IF;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION costs.check_ai_budget(integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION costs.check_ai_budget(integer, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION crm.service_check_ai_budget(integer, timestamptz),
  crm.service_admin_is_staff(uuid), crm.service_admin_overview(), crm.service_admin_accounts(),
  crm.service_admin_account(integer), crm.service_admin_finance_catalog(),
  crm.service_admin_upsert_subscription(integer, jsonb), crm.service_admin_reset_budget(integer, text, uuid),
  crm.service_admin_mutate(text, text, uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION crm.service_check_ai_budget(integer, timestamptz),
  crm.service_admin_is_staff(uuid), crm.service_admin_overview(), crm.service_admin_accounts(),
  crm.service_admin_account(integer), crm.service_admin_finance_catalog(),
  crm.service_admin_upsert_subscription(integer, jsonb), crm.service_admin_reset_budget(integer, text, uuid),
  crm.service_admin_mutate(text, text, uuid, jsonb, uuid)
  TO service_role;
