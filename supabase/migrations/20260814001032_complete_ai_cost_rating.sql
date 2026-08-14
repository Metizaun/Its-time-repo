-- Complete the immutable AI ledger with dual FX rating and current provider prices.

ALTER TABLE costs.usage_events
  ADD COLUMN IF NOT EXISTS provider_exchange_rate_id uuid
    REFERENCES costs.exchange_rates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_cost_brl numeric(20,8)
    CHECK (provider_cost_brl IS NULL OR provider_cost_brl >= 0);

COMMENT ON COLUMN costs.usage_events.exchange_rate_id IS
  'Frozen internal USD/BRL rate used to calculate the amount charged to the customer.';
COMMENT ON COLUMN costs.usage_events.cost_brl IS
  'Customer-facing AI consumption rated with the internal exchange rate.';
COMMENT ON COLUMN costs.usage_events.provider_exchange_rate_id IS
  'Frozen provider USD/BRL rate used to calculate actual provider cost.';
COMMENT ON COLUMN costs.usage_events.provider_cost_brl IS
  'Actual provider cost in BRL, rated with the provider exchange rate.';

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

CREATE OR REPLACE FUNCTION costs.rerate_pending_usage_events(p_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_event record;
  v_count integer := 0;
BEGIN
  IF p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'p_limit deve estar entre 1 e 10000';
  END IF;

  FOR v_event IN
    SELECT id
    FROM costs.usage_events
    WHERE status IN ('pending', 'unrated')
    ORDER BY occurred_at, id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM costs.rate_usage_event(v_event.id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION costs.rerate_pending_usage_events(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION costs.rerate_pending_usage_events(integer) TO service_role;

-- Compensate local databases where the earlier Luna migration was already applied
-- with provisional values, while keeping that migration correct for fresh installs.
UPDATE costs.price_versions
SET unit_price_usd = CASE metric
      WHEN 'input_text_token' THEN 1.00
      WHEN 'cached_input_text_token' THEN 0.10
      WHEN 'output_token' THEN 6.00
      ELSE unit_price_usd
    END,
    verified_at = '2026-08-12T00:00:00Z',
    source_url = 'https://developers.openai.com/api/docs/models/gpt-5.6-luna'
WHERE provider = 'openai'
  AND model = 'gpt-5.6-luna'
  AND operation = 'standard'
  AND valid_from = '2026-08-12T00:00:00Z'
  AND metric IN ('input_text_token', 'cached_input_text_token', 'output_token');

-- Close the provisional Gemini windows before inserting the newly verified prices.
UPDATE costs.price_versions
SET valid_until = '2026-08-12T00:00:00Z'
WHERE provider = 'google_gemini'
  AND model = 'gemini-2.5-flash'
  AND operation = 'standard'
  AND valid_from = '2026-07-15T00:00:00Z'
  AND metric IN ('input_text_token', 'output_token');

UPDATE costs.price_versions
SET valid_until = '2026-08-12T00:00:00Z'
WHERE provider = 'google_gemini'
  AND model = 'gemini-3.1-flash-lite'
  AND operation = 'standard'
  AND valid_from = '2026-07-15T00:00:00Z'
  AND metric IN ('input_text_token', 'output_token');

INSERT INTO costs.price_versions (
  provider, model, operation, metric, unit_price_usd, billing_divisor,
  dimensions, valid_from, source_url, verified_at, notes
) VALUES
  ('openai', 'gpt-5.6-luna', 'standard', 'input_text_token', 1.00, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://developers.openai.com/api/docs/models/gpt-5.6-luna', '2026-08-12T00:00:00Z', 'Text/image input token.'),
  ('openai', 'gpt-5.6-luna', 'standard', 'cached_input_text_token', 0.10, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://developers.openai.com/api/docs/models/gpt-5.6-luna', '2026-08-12T00:00:00Z', 'Cached input token.'),
  ('openai', 'gpt-5.6-luna', 'standard', 'output_token', 6.00, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://developers.openai.com/api/docs/models/gpt-5.6-luna', '2026-08-12T00:00:00Z', 'Output token, including reasoning.'),
  ('openai', 'gpt-4.1-mini', 'standard', 'input_text_token', 0.40, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://developers.openai.com/api/docs/models/gpt-4.1-mini', '2026-08-12T00:00:00Z', 'Text/image input token used by vision.'),
  ('openai', 'gpt-4.1-mini', 'standard', 'cached_input_text_token', 0.10, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://developers.openai.com/api/docs/models/gpt-4.1-mini', '2026-08-12T00:00:00Z', 'Cached input token.'),
  ('openai', 'gpt-4.1-mini', 'standard', 'output_token', 1.60, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://developers.openai.com/api/docs/models/gpt-4.1-mini', '2026-08-12T00:00:00Z', 'Text output token.'),
  ('openai', 'gpt-4o-mini-transcribe', 'standard', 'input_audio_token', 1.25, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe', '2026-08-12T00:00:00Z', 'Audio input token.'),
  ('openai', 'gpt-4o-mini-transcribe', 'standard', 'output_token', 5.00, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe', '2026-08-12T00:00:00Z', 'Transcription output token.'),
  ('openai', 'gpt-image-1', 'standard', 'input_text_token', 5.00, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://developers.openai.com/api/docs/models/gpt-image-1', '2026-08-12T00:00:00Z', 'Image edit text input token.'),
  ('openai', 'gpt-image-1', 'standard', 'cached_input_text_token', 1.25, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://developers.openai.com/api/docs/models/gpt-image-1', '2026-08-12T00:00:00Z', 'Cached text input token.'),
  ('openai', 'gpt-image-1', 'standard', 'input_image_token', 10.00, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://developers.openai.com/api/docs/models/gpt-image-1', '2026-08-12T00:00:00Z', 'Image input token.'),
  ('openai', 'gpt-image-1', 'standard', 'cached_input_image_token', 2.50, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://developers.openai.com/api/docs/models/gpt-image-1', '2026-08-12T00:00:00Z', 'Cached image input token.'),
  ('openai', 'gpt-image-1', 'standard', 'output_image_token', 40.00, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://developers.openai.com/api/docs/models/gpt-image-1', '2026-08-12T00:00:00Z', 'Image output token.'),
  ('google_gemini', 'gemini-2.5-flash', 'standard', 'input_text_token', 0.30, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://ai.google.dev/gemini-api/docs/pricing', '2026-08-12T00:00:00Z', 'Text/image/video input token.'),
  ('google_gemini', 'gemini-2.5-flash', 'standard', 'input_audio_token', 1.00, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://ai.google.dev/gemini-api/docs/pricing', '2026-08-12T00:00:00Z', 'Audio input token.'),
  ('google_gemini', 'gemini-2.5-flash', 'standard', 'cached_input_text_token', 0.03, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://ai.google.dev/gemini-api/docs/pricing', '2026-08-12T00:00:00Z', 'Cached text/image/video input token.'),
  ('google_gemini', 'gemini-2.5-flash', 'standard', 'output_token', 2.50, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://ai.google.dev/gemini-api/docs/pricing', '2026-08-12T00:00:00Z', 'Output token including thinking.'),
  ('google_gemini', 'gemini-2.5-flash-lite', 'standard', 'input_text_token', 0.10, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://ai.google.dev/gemini-api/docs/pricing', '2026-08-12T00:00:00Z', 'Text/image/video input token.'),
  ('google_gemini', 'gemini-2.5-flash-lite', 'standard', 'input_audio_token', 0.30, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://ai.google.dev/gemini-api/docs/pricing', '2026-08-12T00:00:00Z', 'Audio input token.'),
  ('google_gemini', 'gemini-2.5-flash-lite', 'standard', 'cached_input_text_token', 0.01, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://ai.google.dev/gemini-api/docs/pricing', '2026-08-12T00:00:00Z', 'Cached text/image/video input token.'),
  ('google_gemini', 'gemini-2.5-flash-lite', 'standard', 'output_token', 0.40, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://ai.google.dev/gemini-api/docs/pricing', '2026-08-12T00:00:00Z', 'Output token including thinking.'),
  ('google_gemini', 'gemini-3.1-flash-lite', 'standard', 'input_text_token', 0.25, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://ai.google.dev/gemini-api/docs/pricing', '2026-08-12T00:00:00Z', 'Text/image/video input token.'),
  ('google_gemini', 'gemini-3.1-flash-lite', 'standard', 'input_audio_token', 0.50, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://ai.google.dev/gemini-api/docs/pricing', '2026-08-12T00:00:00Z', 'Audio input token.'),
  ('google_gemini', 'gemini-3.1-flash-lite', 'standard', 'cached_input_text_token', 0.025, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://ai.google.dev/gemini-api/docs/pricing', '2026-08-12T00:00:00Z', 'Cached text/image/video input token.'),
  ('google_gemini', 'gemini-3.1-flash-lite', 'standard', 'output_token', 1.50, 1000000, '{}', '2026-08-12T00:00:00Z', 'https://ai.google.dev/gemini-api/docs/pricing', '2026-08-12T00:00:00Z', 'Output token including thinking.')
ON CONFLICT (provider, model, operation, metric, dimensions, valid_from)
DO UPDATE SET
  unit_price_usd = EXCLUDED.unit_price_usd,
  billing_divisor = EXCLUDED.billing_divisor,
  source_url = EXCLUDED.source_url,
  verified_at = EXCLUDED.verified_at,
  notes = EXCLUDED.notes;

SELECT costs.rerate_pending_usage_events(10000);
