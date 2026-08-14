-- Preserve the complete exchange-rate rows in the finance catalog.  The old
-- alias matched the numeric `rate` column, so PostgreSQL resolved
-- `to_jsonb(rate)` to the scalar value instead of the composite row.
CREATE OR REPLACE FUNCTION crm.service_admin_finance_catalog()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
SELECT jsonb_build_object(
  'plans', COALESCE((
    SELECT jsonb_agg(to_jsonb(plan_item) ORDER BY plan_item.name)
    FROM costs.plans AS plan_item
  ), '[]'::jsonb),
  'revenue', COALESCE((
    SELECT jsonb_agg(to_jsonb(revenue_item) ORDER BY revenue_item.competencia DESC, revenue_item.created_at DESC)
    FROM costs.revenue_entries AS revenue_item
  ), '[]'::jsonb),
  'fixedCosts', COALESCE((
    SELECT jsonb_agg(to_jsonb(fixed_cost_item) ORDER BY fixed_cost_item.nome)
    FROM costs.fixed_costs AS fixed_cost_item
  ), '[]'::jsonb),
  'exchangeRates', COALESCE((
    SELECT jsonb_agg(to_jsonb(exchange_rate_item) ORDER BY exchange_rate_item.effective_at DESC)
    FROM costs.exchange_rates AS exchange_rate_item
  ), '[]'::jsonb)
);
$function$;
