-- Plans, contracts, revenue and lazy AI budget cycles for the superadmin.

ALTER TABLE crm.accounts
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

UPDATE crm.accounts SET is_internal = true WHERE id = 1;

CREATE TABLE costs.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  mensalidade_brl numeric(20,2) NOT NULL DEFAULT 0 CHECK (mensalidade_brl >= 0),
  implantacao_brl numeric(20,2) NOT NULL DEFAULT 0 CHECK (implantacao_brl >= 0),
  ai_budget_brl numeric(20,2) CHECK (ai_budget_brl IS NULL OR ai_budget_brl >= 0),
  warn_threshold_pct numeric(5,2) NOT NULL DEFAULT 80
    CHECK (warn_threshold_pct > 0 AND warn_threshold_pct <= 100),
  max_usuarios integer CHECK (max_usuarios IS NULL OR max_usuarios >= 0),
  max_instancias integer CHECK (max_instancias IS NULL OR max_instancias >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE costs.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES costs.plans(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'canceled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  cycle_anchor_day smallint NOT NULL DEFAULT 1
    CHECK (cycle_anchor_day BETWEEN 1 AND 31),
  implantacao_brl numeric(20,2) CHECK (implantacao_brl IS NULL OR implantacao_brl >= 0),
  implantacao_paga_em timestamptz,
  mensalidade_brl_override numeric(20,2)
    CHECK (mensalidade_brl_override IS NULL OR mensalidade_brl_override >= 0),
  ai_budget_brl_override numeric(20,2)
    CHECK (ai_budget_brl_override IS NULL OR ai_budget_brl_override >= 0),
  enforcement_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_period_check CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX subscriptions_one_live_per_account
  ON costs.subscriptions(aces_id)
  WHERE status <> 'canceled';

CREATE INDEX subscriptions_account_status
  ON costs.subscriptions(aces_id, status);

CREATE TABLE costs.budget_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE RESTRICT,
  subscription_id uuid NOT NULL REFERENCES costs.subscriptions(id) ON DELETE RESTRICT,
  cycle_start timestamptz NOT NULL,
  cycle_end timestamptz NOT NULL,
  budget_brl numeric(20,8) NOT NULL CHECK (budget_brl >= 0),
  warn_threshold_pct numeric(5,2) NOT NULL CHECK (warn_threshold_pct > 0 AND warn_threshold_pct <= 100),
  consumed_brl numeric(20,8) NOT NULL DEFAULT 0,
  credit_brl numeric(20,8) NOT NULL DEFAULT 0 CHECK (credit_brl >= 0),
  status text NOT NULL DEFAULT 'ok'
    CHECK (status IN ('ok', 'warned', 'exceeded', 'blocked')),
  warned_at timestamptz,
  exceeded_at timestamptz,
  blocked_at timestamptz,
  reset_at timestamptz,
  reset_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reset_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budget_cycles_window_check CHECK (cycle_end > cycle_start),
  CONSTRAINT budget_cycles_reset_check CHECK (
    (reset_at IS NULL AND reset_by IS NULL AND reset_reason IS NULL)
    OR (reset_at IS NOT NULL AND reset_by IS NOT NULL AND length(btrim(reset_reason)) > 0)
  ),
  CONSTRAINT budget_cycles_account_start_unique UNIQUE (aces_id, cycle_start)
);

CREATE INDEX budget_cycles_account_end
  ON costs.budget_cycles(aces_id, cycle_end DESC);

CREATE TABLE costs.budget_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_cycle_id uuid NOT NULL REFERENCES costs.budget_cycles(id) ON DELETE RESTRICT,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE RESTRICT,
  credit_delta_brl numeric(20,8) NOT NULL CHECK (credit_delta_brl >= 0),
  credit_total_brl numeric(20,8) NOT NULL CHECK (credit_total_brl >= 0),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE costs.revenue_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE RESTRICT,
  competencia date NOT NULL CHECK (competencia = date_trunc('month', competencia)::date),
  tipo text NOT NULL CHECK (tipo IN ('mensalidade', 'implantacao', 'avulso', 'desconto')),
  valor_brl numeric(20,2) NOT NULL,
  status text NOT NULL DEFAULT 'previsto' CHECK (status IN ('previsto', 'pago')),
  pago_em timestamptz,
  descricao text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT revenue_value_sign_check CHECK (
    (tipo = 'desconto' AND valor_brl <= 0)
    OR (tipo <> 'desconto' AND valor_brl >= 0)
  ),
  CONSTRAINT revenue_paid_check CHECK (
    (status = 'pago' AND pago_em IS NOT NULL)
    OR status = 'previsto'
  )
);

CREATE INDEX revenue_entries_month_account
  ON costs.revenue_entries(competencia DESC, aces_id);

CREATE TABLE costs.fixed_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  categoria text NOT NULL CHECK (categoria IN ('infra', 'ferramenta', 'pessoal', 'outro')),
  valor_brl numeric(20,2) NOT NULL CHECK (valor_brl >= 0),
  recorrencia text NOT NULL CHECK (recorrencia IN ('mensal', 'anual', 'unico')),
  vigencia_inicio date NOT NULL CHECK (vigencia_inicio = date_trunc('month', vigencia_inicio)::date),
  vigencia_fim date CHECK (
    vigencia_fim IS NULL
    OR (vigencia_fim = date_trunc('month', vigencia_fim)::date AND vigencia_fim >= vigencia_inicio)
  ),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE costs.admin_staff (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE costs.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE costs.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE costs.budget_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE costs.budget_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE costs.revenue_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE costs.fixed_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE costs.admin_staff ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON costs.plans, costs.subscriptions, costs.budget_cycles,
  costs.budget_resets, costs.revenue_entries, costs.fixed_costs, costs.admin_staff
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON costs.plans, costs.subscriptions,
  costs.revenue_entries, costs.fixed_costs TO service_role;
GRANT SELECT, INSERT, UPDATE ON costs.budget_cycles, costs.budget_resets TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON costs.admin_staff TO service_role;

CREATE TRIGGER trg_costs_plans_updated_at
  BEFORE UPDATE ON costs.plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_costs_subscriptions_updated_at
  BEFORE UPDATE ON costs.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_costs_budget_cycles_updated_at
  BEFORE UPDATE ON costs.budget_cycles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_costs_revenue_entries_updated_at
  BEFORE UPDATE ON costs.revenue_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_costs_fixed_costs_updated_at
  BEFORE UPDATE ON costs.fixed_costs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION costs.ensure_current_cycle(
  p_aces_id integer,
  p_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_subscription costs.subscriptions%ROWTYPE;
  v_plan costs.plans%ROWTYPE;
  v_local_date date;
  v_month date;
  v_start_month date;
  v_next_month date;
  v_anchor_this date;
  v_start_date date;
  v_end_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_budget numeric(20,8);
  v_cycle_id uuid;
BEGIN
  SELECT * INTO v_subscription
  FROM costs.subscriptions
  WHERE aces_id = p_aces_id
    AND status = 'active'
    AND started_at <= p_at
    AND (ended_at IS NULL OR ended_at > p_at)
  ORDER BY started_at DESC
  LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_plan FROM costs.plans WHERE id = v_subscription.plan_id;
  v_budget := COALESCE(v_subscription.ai_budget_brl_override, v_plan.ai_budget_brl);
  IF v_budget IS NULL THEN RETURN NULL; END IF;

  v_local_date := (p_at AT TIME ZONE 'America/Sao_Paulo')::date;
  v_month := date_trunc('month', v_local_date)::date;
  v_anchor_this := v_month + (
    LEAST(
      v_subscription.cycle_anchor_day::integer,
      EXTRACT(DAY FROM (v_month + interval '1 month - 1 day'))::integer
    ) - 1
  );
  v_start_month := CASE WHEN v_local_date >= v_anchor_this THEN v_month ELSE (v_month - interval '1 month')::date END;
  v_start_date := v_start_month + (
    LEAST(
      v_subscription.cycle_anchor_day::integer,
      EXTRACT(DAY FROM (v_start_month + interval '1 month - 1 day'))::integer
    ) - 1
  );
  v_next_month := (date_trunc('month', v_start_month) + interval '1 month')::date;
  v_end_date := v_next_month + (
    LEAST(
      v_subscription.cycle_anchor_day::integer,
      EXTRACT(DAY FROM (v_next_month + interval '1 month - 1 day'))::integer
    ) - 1
  );
  v_start := v_start_date::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_end := v_end_date::timestamp AT TIME ZONE 'America/Sao_Paulo';

  INSERT INTO costs.budget_cycles (
    aces_id, subscription_id, cycle_start, cycle_end,
    budget_brl, warn_threshold_pct
  ) VALUES (
    p_aces_id, v_subscription.id, v_start, v_end,
    v_budget, v_plan.warn_threshold_pct
  )
  ON CONFLICT (aces_id, cycle_start) DO NOTHING
  RETURNING id INTO v_cycle_id;

  IF v_cycle_id IS NULL THEN
    SELECT id INTO v_cycle_id
    FROM costs.budget_cycles
    WHERE aces_id = p_aces_id AND cycle_start = v_start;
  END IF;

  RETURN v_cycle_id;
END;
$function$;

CREATE OR REPLACE FUNCTION costs.refresh_budget_cycle_status(p_cycle_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_cycle costs.budget_cycles%ROWTYPE;
  v_enforcement boolean;
  v_effective numeric(20,8);
  v_pct numeric(20,4);
  v_status text;
  v_now timestamptz := now();
BEGIN
  SELECT cycle.* INTO v_cycle
  FROM costs.budget_cycles AS cycle
  WHERE cycle.id = p_cycle_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Ciclo de orcamento nao encontrado'; END IF;

  SELECT subscription.enforcement_enabled INTO v_enforcement
  FROM costs.subscriptions AS subscription
  WHERE subscription.id = v_cycle.subscription_id;

  v_effective := GREATEST(v_cycle.consumed_brl - v_cycle.credit_brl, 0);
  v_pct := CASE WHEN v_cycle.budget_brl = 0 THEN 100 ELSE (v_effective / v_cycle.budget_brl) * 100 END;
  v_status := CASE
    WHEN v_pct >= 100 AND v_enforcement THEN 'blocked'
    WHEN v_pct >= 100 THEN 'exceeded'
    WHEN v_pct >= v_cycle.warn_threshold_pct THEN 'warned'
    ELSE 'ok'
  END;

  UPDATE costs.budget_cycles
  SET status = v_status,
      warned_at = CASE WHEN v_pct >= v_cycle.warn_threshold_pct THEN COALESCE(warned_at, v_now) ELSE warned_at END,
      exceeded_at = CASE WHEN v_pct >= 100 THEN COALESCE(exceeded_at, v_now) ELSE exceeded_at END,
      blocked_at = CASE WHEN v_status = 'blocked' THEN COALESCE(blocked_at, v_now) ELSE blocked_at END
  WHERE id = p_cycle_id;

  IF v_pct >= v_cycle.warn_threshold_pct THEN
    INSERT INTO crm.notifications (
      aces_id, category, event_type, title, description, action_path, idempotency_key
    ) VALUES (
      v_cycle.aces_id, 'notice', 'ai_budget_warned', 'Consumo de IA em atencao',
      format('A conta atingiu %s%% do teto de IA do ciclo.', round(v_pct, 1)),
      NULL,
      format('ai-budget:%s:%s:warned', v_cycle.aces_id, v_cycle.id)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  IF v_pct >= 100 THEN
    INSERT INTO crm.notifications (
      aces_id, category, event_type, title, description, action_path, idempotency_key
    ) VALUES (
      v_cycle.aces_id, 'notice', 'ai_budget_exceeded', 'Teto de IA atingido',
      CASE WHEN v_enforcement
        THEN 'Novas chamadas de IA foram bloqueadas para esta conta.'
        ELSE 'A conta ultrapassou o teto em modo de observacao; chamadas seguem liberadas.'
      END,
      NULL,
      format('ai-budget:%s:%s:exceeded', v_cycle.aces_id, v_cycle.id)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN v_status;
END;
$function$;

CREATE OR REPLACE FUNCTION costs.apply_budget_delta(
  p_aces_id integer,
  p_occurred_at timestamptz,
  p_delta_brl numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_cycle_id uuid;
BEGIN
  IF p_delta_brl = 0 OR p_delta_brl IS NULL THEN RETURN; END IF;
  v_cycle_id := costs.ensure_current_cycle(p_aces_id, p_occurred_at);
  IF v_cycle_id IS NULL THEN RETURN; END IF;

  UPDATE costs.budget_cycles
  SET consumed_brl = consumed_brl + p_delta_brl
  WHERE id = v_cycle_id;
  PERFORM costs.refresh_budget_cycle_status(v_cycle_id);
END;
$function$;

CREATE OR REPLACE FUNCTION costs.accumulate_usage_event_budget()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_old numeric(20,8) := 0;
  v_new numeric(20,8) := 0;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.cost_brl IS NOT NULL
     AND OLD.status IN ('estimated', 'reconciled') THEN
    v_old := CASE WHEN OLD.event_type = 'reversal' THEN -OLD.cost_brl ELSE OLD.cost_brl END;
  END IF;
  IF NEW.cost_brl IS NOT NULL AND NEW.status IN ('estimated', 'reconciled') THEN
    v_new := CASE WHEN NEW.event_type = 'reversal' THEN -NEW.cost_brl ELSE NEW.cost_brl END;
  END IF;

  IF TG_OP = 'UPDATE' AND (OLD.aces_id, OLD.occurred_at) IS DISTINCT FROM (NEW.aces_id, NEW.occurred_at) THEN
    PERFORM costs.apply_budget_delta(OLD.aces_id, OLD.occurred_at, -v_old);
    PERFORM costs.apply_budget_delta(NEW.aces_id, NEW.occurred_at, v_new);
  ELSE
    PERFORM costs.apply_budget_delta(NEW.aces_id, NEW.occurred_at, v_new - v_old);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_usage_events_accumulate_budget ON costs.usage_events;
CREATE TRIGGER trg_usage_events_accumulate_budget
  AFTER INSERT OR UPDATE OF cost_brl, status, event_type, occurred_at, aces_id
  ON costs.usage_events
  FOR EACH ROW EXECUTE FUNCTION costs.accumulate_usage_event_budget();

CREATE OR REPLACE FUNCTION costs.reset_ai_budget(
  p_aces_id integer,
  p_reason text,
  p_author uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_cycle_id uuid;
  v_cycle costs.budget_cycles%ROWTYPE;
  v_delta numeric(20,8);
BEGIN
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Motivo do reset e obrigatorio';
  END IF;
  IF p_author IS NULL THEN RAISE EXCEPTION 'Autor do reset e obrigatorio'; END IF;

  v_cycle_id := costs.ensure_current_cycle(p_aces_id, p_at);
  IF v_cycle_id IS NULL THEN RAISE EXCEPTION 'Conta sem ciclo de orcamento ativo'; END IF;

  SELECT * INTO v_cycle FROM costs.budget_cycles WHERE id = v_cycle_id FOR UPDATE;
  v_delta := GREATEST(v_cycle.consumed_brl - v_cycle.credit_brl, 0);

  UPDATE costs.budget_cycles
  SET credit_brl = credit_brl + v_delta,
      reset_at = p_at,
      reset_by = p_author,
      reset_reason = btrim(p_reason)
  WHERE id = v_cycle_id;

  INSERT INTO costs.budget_resets (
    budget_cycle_id, aces_id, credit_delta_brl, credit_total_brl,
    reason, created_by, created_at
  ) VALUES (
    v_cycle_id, p_aces_id, v_delta, v_cycle.credit_brl + v_delta,
    btrim(p_reason), p_author, p_at
  );

  PERFORM costs.refresh_budget_cycle_status(v_cycle_id);
  RETURN v_cycle_id;
END;
$function$;

REVOKE ALL ON FUNCTION costs.ensure_current_cycle(integer, timestamptz),
  costs.refresh_budget_cycle_status(uuid), costs.apply_budget_delta(integer, timestamptz, numeric),
  costs.accumulate_usage_event_budget(), costs.reset_ai_budget(integer, text, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION costs.ensure_current_cycle(integer, timestamptz),
  costs.refresh_budget_cycle_status(uuid), costs.apply_budget_delta(integer, timestamptz, numeric),
  costs.reset_ai_budget(integer, text, uuid, timestamptz) TO service_role;

CREATE OR REPLACE VIEW costs.v_account_cycle_status
WITH (security_invoker = true)
AS
SELECT
  account.id AS aces_id,
  account.name AS account_name,
  account.status AS account_status,
  account.is_internal,
  subscription.id AS subscription_id,
  subscription.status AS subscription_status,
  subscription.enforcement_enabled,
  plan.id AS plan_id,
  plan.code AS plan_code,
  plan.name AS plan_name,
  COALESCE(subscription.mensalidade_brl_override, plan.mensalidade_brl) AS mrr_brl,
  cycle.id AS cycle_id,
  cycle.cycle_start,
  cycle.cycle_end,
  cycle.budget_brl,
  cycle.consumed_brl,
  cycle.credit_brl,
  GREATEST(cycle.consumed_brl - cycle.credit_brl, 0) AS effective_consumed_brl,
  CASE WHEN cycle.budget_brl > 0
    THEN round((GREATEST(cycle.consumed_brl - cycle.credit_brl, 0) / cycle.budget_brl) * 100, 2)
    ELSE CASE WHEN cycle.id IS NULL THEN 0 ELSE 100 END
  END AS consumed_pct,
  cycle.status AS cycle_status
FROM crm.accounts AS account
LEFT JOIN costs.subscriptions AS subscription
  ON subscription.aces_id = account.id AND subscription.status <> 'canceled'
LEFT JOIN costs.plans AS plan ON plan.id = subscription.plan_id
LEFT JOIN LATERAL (
  SELECT item.* FROM costs.budget_cycles AS item
  WHERE item.aces_id = account.id
  ORDER BY item.cycle_start DESC LIMIT 1
) AS cycle ON true;

CREATE OR REPLACE VIEW costs.v_monthly_cost_dimensions
WITH (security_invoker = true)
AS
SELECT
  date_trunc('month', usage.occurred_at)::date AS competencia,
  usage.aces_id,
  usage.instance_name,
  usage.feature_key,
  usage.provider,
  usage.model,
  count(*) AS event_count,
  count(*) FILTER (WHERE usage.status = 'unrated') AS unrated_count,
  sum(CASE WHEN usage.event_type = 'reversal' THEN -usage.cost_usd ELSE usage.cost_usd END)
    FILTER (WHERE usage.status IN ('estimated', 'reconciled')) AS cost_usd,
  sum(CASE WHEN usage.event_type = 'reversal' THEN -usage.cost_brl ELSE usage.cost_brl END)
    FILTER (WHERE usage.status IN ('estimated', 'reconciled')) AS billed_cost_brl,
  sum(CASE WHEN usage.event_type = 'reversal' THEN -usage.provider_cost_brl ELSE usage.provider_cost_brl END)
    FILTER (WHERE usage.status IN ('estimated', 'reconciled')) AS provider_cost_brl
FROM costs.usage_events AS usage
GROUP BY date_trunc('month', usage.occurred_at)::date, usage.aces_id,
  usage.instance_name, usage.feature_key, usage.provider, usage.model;

CREATE OR REPLACE VIEW costs.v_monthly_financials
WITH (security_invoker = true)
AS
WITH months AS (
  SELECT generate_series(
    date_trunc('month', now()) - interval '11 months',
    date_trunc('month', now()),
    interval '1 month'
  )::date AS competencia
), eligible_accounts AS (
  SELECT id FROM crm.accounts WHERE NOT is_internal
), mrr AS (
  SELECT months.competencia,
    COALESCE(sum(COALESCE(subscription.mensalidade_brl_override, plan.mensalidade_brl)), 0) AS mrr_brl
  FROM months
  LEFT JOIN costs.subscriptions AS subscription
    ON subscription.status = 'active'
    AND subscription.aces_id IN (SELECT id FROM eligible_accounts)
    AND subscription.started_at < (months.competencia + interval '1 month')
    AND (subscription.ended_at IS NULL OR subscription.ended_at >= months.competencia)
  LEFT JOIN costs.plans AS plan ON plan.id = subscription.plan_id
  GROUP BY months.competencia
), revenue AS (
  SELECT entry.competencia,
    sum(entry.valor_brl) AS revenue_booked_brl,
    sum(entry.valor_brl) FILTER (WHERE entry.status = 'pago') AS revenue_paid_brl
  FROM costs.revenue_entries AS entry
  WHERE entry.aces_id IN (SELECT id FROM eligible_accounts)
    AND NOT EXISTS (
      SELECT 1 FROM costs.subscriptions AS canceled
      WHERE canceled.aces_id = entry.aces_id AND canceled.status = 'canceled'
    )
  GROUP BY entry.competencia
), usage AS (
  SELECT item.competencia,
    sum(item.billed_cost_brl) AS billed_consumption_brl,
    sum(item.provider_cost_brl) AS provider_cost_brl
  FROM costs.v_monthly_cost_dimensions AS item
  WHERE item.aces_id IN (SELECT id FROM eligible_accounts)
    AND NOT EXISTS (
      SELECT 1 FROM costs.subscriptions AS canceled
      WHERE canceled.aces_id = item.aces_id AND canceled.status = 'canceled'
    )
  GROUP BY item.competencia
), fixed AS (
  SELECT months.competencia,
    COALESCE(sum(CASE cost.recorrencia
      WHEN 'anual' THEN cost.valor_brl / 12
      WHEN 'unico' THEN CASE WHEN cost.vigencia_inicio = months.competencia THEN cost.valor_brl ELSE 0 END
      ELSE cost.valor_brl
    END), 0) AS fixed_cost_brl
  FROM months
  LEFT JOIN costs.fixed_costs AS cost
    ON cost.vigencia_inicio <= months.competencia
    AND (cost.vigencia_fim IS NULL OR cost.vigencia_fim >= months.competencia)
  GROUP BY months.competencia
)
SELECT
  months.competencia,
  mrr.mrr_brl,
  COALESCE(revenue.revenue_booked_brl, 0) AS revenue_booked_brl,
  COALESCE(revenue.revenue_paid_brl, 0) AS revenue_paid_brl,
  COALESCE(usage.billed_consumption_brl, 0) AS billed_consumption_brl,
  COALESCE(usage.provider_cost_brl, 0) AS provider_cost_brl,
  COALESCE(usage.billed_consumption_brl, 0) - COALESCE(usage.provider_cost_brl, 0) AS fx_margin_brl,
  COALESCE(revenue.revenue_booked_brl, mrr.mrr_brl) - COALESCE(usage.provider_cost_brl, 0) AS client_margin_brl,
  fixed.fixed_cost_brl,
  COALESCE(revenue.revenue_booked_brl, mrr.mrr_brl) - COALESCE(usage.provider_cost_brl, 0) - fixed.fixed_cost_brl AS result_brl
FROM months
JOIN mrr USING (competencia)
JOIN fixed USING (competencia)
LEFT JOIN revenue USING (competencia)
LEFT JOIN usage USING (competencia)
ORDER BY months.competencia;

REVOKE ALL ON costs.v_account_cycle_status, costs.v_monthly_cost_dimensions,
  costs.v_monthly_financials FROM PUBLIC, anon, authenticated;
GRANT SELECT ON costs.v_account_cycle_status, costs.v_monthly_cost_dimensions,
  costs.v_monthly_financials TO service_role;
