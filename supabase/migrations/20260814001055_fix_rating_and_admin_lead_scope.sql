-- Compensate databases where the earlier local migration rewrote rpc_create_lead
-- with the account-admin helper in the wrong schema.
DO $body$
DECLARE
  v_definition text;
BEGIN
  v_definition := pg_get_functiondef(
    'public.rpc_create_lead(text,text,text,text,text,text,uuid,text,numeric,text)'::regprocedure
  );
  v_definition := replace(
    v_definition,
    'public.current_user_is_account_admin()',
    'crm.current_user_is_account_admin()'
  );
  EXECUTE v_definition;
END;
$body$;

CREATE OR REPLACE FUNCTION costs.rate_usage_event(p_usage_event_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_event costs.usage_events%ROWTYPE;
  v_line record;
  v_price costs.price_versions%ROWTYPE;
  v_internal_rate costs.exchange_rates%ROWTYPE;
  v_provider_rate costs.exchange_rates%ROWTYPE;
  v_total numeric(20,10) := 0;
  v_unrated_count integer := 0;
  v_status text;
BEGIN
  SELECT * INTO v_event
  FROM costs.usage_events
  WHERE id = p_usage_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento de uso nao encontrado';
  END IF;

  UPDATE costs.usage_line_items
  SET price_version_id = NULL,
      unit_price_usd = NULL,
      billing_divisor = NULL,
      cost_usd = NULL
  WHERE usage_event_id = p_usage_event_id;

  FOR v_line IN
    SELECT *
    FROM costs.usage_line_items
    WHERE usage_event_id = p_usage_event_id
    ORDER BY line_no
  LOOP
    SELECT * INTO v_price
    FROM costs.price_versions
    WHERE provider = v_event.provider
      AND model = v_event.model
      AND operation = v_event.operation
      AND metric = v_line.metric
      AND COALESCE(v_line.rating_metadata, '{}'::jsonb) @> dimensions
      AND valid_from <= v_event.occurred_at
      AND (valid_until IS NULL OR valid_until > v_event.occurred_at)
    ORDER BY (SELECT count(*) FROM jsonb_object_keys(dimensions)) DESC, valid_from DESC
    LIMIT 1;

    IF NOT FOUND THEN
      v_unrated_count := v_unrated_count + 1;
      CONTINUE;
    END IF;

    UPDATE costs.usage_line_items
    SET price_version_id = v_price.id,
        unit_price_usd = v_price.unit_price_usd,
        billing_divisor = v_price.billing_divisor,
        cost_usd = round((v_line.quantity / v_price.billing_divisor) * v_price.unit_price_usd, 10)
    WHERE usage_event_id = p_usage_event_id
      AND line_no = v_line.line_no;

    v_total := v_total + round(
      (v_line.quantity / v_price.billing_divisor) * v_price.unit_price_usd,
      10
    );
  END LOOP;

  IF v_unrated_count = 0 THEN
    SELECT * INTO v_internal_rate
    FROM costs.exchange_rates
    WHERE upper(from_currency) = 'USD'
      AND upper(to_currency) = 'BRL'
      AND rate_kind = 'internal'
      AND effective_at <= v_event.occurred_at
    ORDER BY effective_at DESC, created_at DESC
    LIMIT 1;

    SELECT * INTO v_provider_rate
    FROM costs.exchange_rates
    WHERE upper(from_currency) = 'USD'
      AND upper(to_currency) = 'BRL'
      AND rate_kind = 'provider'
      AND effective_at <= v_event.occurred_at
    ORDER BY effective_at DESC, created_at DESC
    LIMIT 1;
  END IF;

  v_status := CASE
    WHEN v_unrated_count = 0 AND v_internal_rate.id IS NOT NULL AND v_provider_rate.id IS NOT NULL
      THEN 'estimated'
    ELSE 'unrated'
  END;

  UPDATE costs.usage_events
  SET status = v_status,
      cost_usd = CASE WHEN v_unrated_count = 0 THEN v_total ELSE NULL END,
      exchange_rate_id = CASE WHEN v_status = 'estimated' THEN v_internal_rate.id ELSE NULL END,
      cost_brl = CASE WHEN v_status = 'estimated' THEN round(v_total * v_internal_rate.rate, 8) ELSE NULL END,
      provider_exchange_rate_id = CASE WHEN v_status = 'estimated' THEN v_provider_rate.id ELSE NULL END,
      provider_cost_brl = CASE WHEN v_status = 'estimated' THEN round(v_total * v_provider_rate.rate, 8) ELSE NULL END
  WHERE id = p_usage_event_id;

  RETURN v_status;
END;
$function$;
