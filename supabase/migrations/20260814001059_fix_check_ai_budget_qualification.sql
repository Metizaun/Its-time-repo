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
