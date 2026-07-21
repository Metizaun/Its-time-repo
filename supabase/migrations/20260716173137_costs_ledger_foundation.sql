-- Immutable usage/cost ledger. The costs schema stays outside the Data API.

CREATE SCHEMA IF NOT EXISTS costs;

REVOKE ALL ON SCHEMA costs FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA costs TO service_role;

CREATE TABLE IF NOT EXISTS costs.price_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  model text NOT NULL,
  operation text NOT NULL DEFAULT 'standard',
  metric text NOT NULL,
  unit_price_usd numeric(20,10) NOT NULL CHECK (unit_price_usd >= 0),
  billing_divisor numeric(20,4) NOT NULL DEFAULT 1 CHECK (billing_divisor > 0),
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dimensions) = 'object'),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  source_url text NOT NULL,
  verified_at timestamptz NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_versions_window_check CHECK (
    valid_until IS NULL OR valid_until > valid_from
  ),
  CONSTRAINT price_versions_key_unique UNIQUE (
    provider,
    model,
    operation,
    metric,
    dimensions,
    valid_from
  )
);

CREATE INDEX IF NOT EXISTS idx_price_versions_lookup
  ON costs.price_versions(provider, model, operation, metric, valid_from DESC);

CREATE OR REPLACE FUNCTION costs.reject_overlapping_price_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM costs.price_versions AS existing
    WHERE existing.id <> NEW.id
      AND existing.provider = NEW.provider
      AND existing.model = NEW.model
      AND existing.operation = NEW.operation
      AND existing.metric = NEW.metric
      AND existing.dimensions = NEW.dimensions
      AND existing.valid_from <> NEW.valid_from
      AND tstzrange(existing.valid_from, existing.valid_until, '[)')
        && tstzrange(NEW.valid_from, NEW.valid_until, '[)')
  ) THEN
    RAISE EXCEPTION 'Janela de preco sobreposta para provider/model/operation/metric/dimensions';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_price_versions_no_overlap ON costs.price_versions;
CREATE TRIGGER trg_price_versions_no_overlap
BEFORE INSERT OR UPDATE ON costs.price_versions
FOR EACH ROW
EXECUTE FUNCTION costs.reject_overlapping_price_version();

CREATE TABLE IF NOT EXISTS costs.exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_currency text NOT NULL,
  to_currency text NOT NULL,
  rate numeric(20,8) NOT NULL CHECK (rate > 0),
  rate_kind text NOT NULL,
  source text NOT NULL,
  effective_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exchange_rates_key_unique UNIQUE (
    from_currency,
    to_currency,
    rate_kind,
    source,
    effective_at
  )
);

CREATE TABLE IF NOT EXISTS costs.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  event_type text NOT NULL DEFAULT 'consumption'
    CHECK (event_type IN ('consumption', 'adjustment', 'reversal')),
  reverses_event_id uuid REFERENCES costs.usage_events(id) ON DELETE RESTRICT,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE RESTRICT,
  cost_domain text NOT NULL DEFAULT 'ai',
  feature_key text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  operation text NOT NULL DEFAULT 'standard',
  provider_request_id text,
  ai_run_id uuid REFERENCES agents.ai_runs(id) ON DELETE SET NULL,
  tool_run_id uuid REFERENCES agents.agent_tool_runs(id) ON DELETE SET NULL,
  pipeline_run_id uuid REFERENCES crm.pipeline_analysis_runs(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES agents.ai_agents(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES crm.leads(id) ON DELETE SET NULL,
  instance_name text,
  status text NOT NULL DEFAULT 'unrated'
    CHECK (status IN ('pending', 'unrated', 'estimated', 'reconciled', 'reversed')),
  cost_usd numeric(20,10) CHECK (cost_usd IS NULL OR cost_usd >= 0),
  exchange_rate_id uuid REFERENCES costs.exchange_rates(id) ON DELETE SET NULL,
  cost_brl numeric(20,8) CHECK (cost_brl IS NULL OR cost_brl >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_events_reversal_check CHECK (
    (event_type = 'reversal' AND reverses_event_id IS NOT NULL)
    OR (event_type <> 'reversal' AND reverses_event_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_usage_events_account_time
  ON costs.usage_events(aces_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_feature_time
  ON costs.usage_events(feature_key, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_unrated
  ON costs.usage_events(occurred_at)
  WHERE status IN ('pending', 'unrated');

CREATE TABLE IF NOT EXISTS costs.usage_line_items (
  usage_event_id uuid NOT NULL REFERENCES costs.usage_events(id) ON DELETE CASCADE,
  line_no smallint NOT NULL CHECK (line_no > 0),
  metric text NOT NULL,
  quantity numeric(24,6) NOT NULL CHECK (quantity >= 0),
  price_version_id uuid REFERENCES costs.price_versions(id) ON DELETE SET NULL,
  unit_price_usd numeric(20,10) CHECK (unit_price_usd IS NULL OR unit_price_usd >= 0),
  billing_divisor numeric(20,4) CHECK (billing_divisor IS NULL OR billing_divisor > 0),
  cost_usd numeric(20,10) CHECK (cost_usd IS NULL OR cost_usd >= 0),
  rating_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(rating_metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_event_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_usage_line_items_price
  ON costs.usage_line_items(price_version_id)
  WHERE price_version_id IS NOT NULL;

ALTER TABLE costs.price_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE costs.exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE costs.usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE costs.usage_line_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA costs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON costs.price_versions, costs.exchange_rates TO service_role;
GRANT SELECT, INSERT, UPDATE ON costs.usage_events, costs.usage_line_items TO service_role;

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
  v_total numeric(20,10) := 0;
  v_unrated_count integer := 0;
BEGIN
  SELECT * INTO v_event
  FROM costs.usage_events
  WHERE id = p_usage_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento de uso não encontrado';
  END IF;

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
      AND dimensions = '{}'::jsonb
      AND valid_from <= v_event.occurred_at
      AND (valid_until IS NULL OR valid_until > v_event.occurred_at)
    ORDER BY valid_from DESC
    LIMIT 1;

    IF NOT FOUND THEN
      v_unrated_count := v_unrated_count + 1;
      CONTINUE;
    END IF;

    UPDATE costs.usage_line_items
    SET
      price_version_id = v_price.id,
      unit_price_usd = v_price.unit_price_usd,
      billing_divisor = v_price.billing_divisor,
      cost_usd = round(
        (v_line.quantity / v_price.billing_divisor) * v_price.unit_price_usd,
        10
      )
    WHERE usage_event_id = p_usage_event_id
      AND line_no = v_line.line_no;

    v_total := v_total + round(
      (v_line.quantity / v_price.billing_divisor) * v_price.unit_price_usd,
      10
    );
  END LOOP;

  UPDATE costs.usage_events
  SET
    status = CASE WHEN v_unrated_count = 0 THEN 'estimated' ELSE 'unrated' END,
    cost_usd = CASE WHEN v_unrated_count = 0 THEN v_total ELSE NULL END
  WHERE id = p_usage_event_id;

  RETURN CASE WHEN v_unrated_count = 0 THEN 'estimated' ELSE 'unrated' END;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.service_record_ai_usage(
  p_idempotency_key text,
  p_aces_id integer,
  p_feature_key text,
  p_provider text,
  p_model text,
  p_line_items jsonb,
  p_operation text DEFAULT 'standard',
  p_provider_request_id text DEFAULT NULL,
  p_ai_run_id uuid DEFAULT NULL,
  p_tool_run_id uuid DEFAULT NULL,
  p_pipeline_run_id uuid DEFAULT NULL,
  p_agent_id uuid DEFAULT NULL,
  p_lead_id uuid DEFAULT NULL,
  p_instance_name text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_occurred_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_event_id uuid;
BEGIN
  IF btrim(COALESCE(p_idempotency_key, '')) = '' THEN
    RAISE EXCEPTION 'idempotency_key é obrigatória';
  END IF;

  IF jsonb_typeof(COALESCE(p_line_items, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'line_items deve ser um array JSON';
  END IF;

  IF jsonb_typeof(COALESCE(p_metadata, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'metadata deve ser um objeto JSON';
  END IF;

  INSERT INTO costs.usage_events (
    idempotency_key,
    aces_id,
    feature_key,
    provider,
    model,
    operation,
    provider_request_id,
    ai_run_id,
    tool_run_id,
    pipeline_run_id,
    agent_id,
    lead_id,
    instance_name,
    metadata,
    occurred_at
  ) VALUES (
    p_idempotency_key,
    p_aces_id,
    p_feature_key,
    p_provider,
    p_model,
    COALESCE(NULLIF(btrim(p_operation), ''), 'standard'),
    p_provider_request_id,
    p_ai_run_id,
    p_tool_run_id,
    p_pipeline_run_id,
    p_agent_id,
    p_lead_id,
    p_instance_name,
    COALESCE(p_metadata, '{}'::jsonb),
    COALESCE(p_occurred_at, now())
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id
    FROM costs.usage_events
    WHERE idempotency_key = p_idempotency_key;

    RETURN v_event_id;
  END IF;

  INSERT INTO costs.usage_line_items (
    usage_event_id,
    line_no,
    metric,
    quantity,
    rating_metadata
  )
  SELECT
    v_event_id,
    item.ordinality::smallint,
    item.value->>'metric',
    (item.value->>'quantity')::numeric,
    COALESCE(item.value->'metadata', '{}'::jsonb)
  FROM jsonb_array_elements(COALESCE(p_line_items, '[]'::jsonb))
    WITH ORDINALITY AS item(value, ordinality)
  WHERE btrim(COALESCE(item.value->>'metric', '')) <> ''
    AND (item.value->>'quantity') IS NOT NULL;

  IF NOT EXISTS (
    SELECT 1
    FROM costs.usage_line_items
    WHERE usage_event_id = v_event_id
  ) THEN
    RAISE EXCEPTION 'Nenhum line item faturavel foi informado';
  END IF;

  PERFORM costs.rate_usage_event(v_event_id);
  RETURN v_event_id;
END;
$function$;

REVOKE ALL ON FUNCTION costs.rate_usage_event(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION costs.rate_usage_event(uuid) TO service_role;

REVOKE ALL ON FUNCTION costs.reject_overlapping_price_version()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION crm.service_record_ai_usage(
  text, integer, text, text, text, jsonb, text, text, uuid, uuid, uuid, uuid, uuid, text, jsonb, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION crm.service_record_ai_usage(
  text, integer, text, text, text, jsonb, text, text, uuid, uuid, uuid, uuid, uuid, text, jsonb, timestamptz
) TO service_role;

CREATE OR REPLACE VIEW costs.v_monthly_account_costs
WITH (security_invoker = true)
AS
SELECT
  usage.aces_id,
  date_trunc('month', usage.occurred_at)::date AS month_ref,
  usage.feature_key,
  usage.provider,
  usage.model,
  count(*) AS event_count,
  count(*) FILTER (WHERE usage.status = 'unrated') AS unrated_count,
  sum(usage.cost_usd) FILTER (WHERE usage.status IN ('estimated', 'reconciled')) AS cost_usd
FROM costs.usage_events AS usage
WHERE usage.event_type <> 'reversal'
GROUP BY
  usage.aces_id,
  date_trunc('month', usage.occurred_at)::date,
  usage.feature_key,
  usage.provider,
  usage.model;

REVOKE ALL ON costs.v_monthly_account_costs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON costs.v_monthly_account_costs TO service_role;

-- Versioned public list prices verified on 2026-07-15. Contract prices may override them later.
INSERT INTO costs.price_versions (
  provider,
  model,
  operation,
  metric,
  unit_price_usd,
  billing_divisor,
  valid_from,
  source_url,
  verified_at,
  notes
) VALUES
  (
    'google_gemini', 'gemini-2.5-flash', 'standard', 'input_text_token',
    0.15, 1000000, '2026-07-15T00:00:00Z',
    'https://ai.google.dev/gemini-api/docs/pricing', '2026-07-15T00:00:00Z',
    'Preço público standard para input texto/imagem/vídeo.'
  ),
  (
    'google_gemini', 'gemini-2.5-flash', 'standard', 'output_token',
    1.25, 1000000, '2026-07-15T00:00:00Z',
    'https://ai.google.dev/gemini-api/docs/pricing', '2026-07-15T00:00:00Z',
    'Preço público standard; inclui thinking tokens.'
  ),
  (
    'google_gemini', 'gemini-3.1-flash-lite', 'standard', 'input_text_token',
    0.25, 1000000, '2026-07-15T00:00:00Z',
    'https://ai.google.dev/gemini-api/docs/pricing', '2026-07-15T00:00:00Z',
    'Preço público standard para input texto/imagem/vídeo.'
  ),
  (
    'google_gemini', 'gemini-3.1-flash-lite', 'standard', 'output_token',
    1.50, 1000000, '2026-07-15T00:00:00Z',
    'https://ai.google.dev/gemini-api/docs/pricing', '2026-07-15T00:00:00Z',
    'Preço público standard; inclui thinking tokens.'
  ),
  (
    'elevenlabs', 'eleven_flash_v2_5', 'standard', 'character',
    0.05, 1000, '2026-07-15T00:00:00Z',
    'https://elevenlabs.io/pricing/api?price.platform=api', '2026-07-15T00:00:00Z',
    'Preço público PAYG; contrato/plano pode alterar o custo real.'
  ),
  (
    'openai', 'gpt-4o-mini-transcribe', 'standard', 'audio_minute',
    0.003, 1, '2026-07-15T00:00:00Z',
    'https://developers.openai.com/api/docs/pricing', '2026-07-15T00:00:00Z',
    'Estimativa pública por minuto.'
  )
ON CONFLICT (
  provider,
  model,
  operation,
  metric,
  dimensions,
  valid_from
) DO NOTHING;
