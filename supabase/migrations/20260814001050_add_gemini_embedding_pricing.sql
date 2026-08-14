-- text-embedding-004 was retired on 2026-01-14. The runtime now uses the
-- supported text-only Gemini embedding model and its current paid-tier price.
INSERT INTO costs.price_versions (
  provider,
  model,
  operation,
  metric,
  unit_price_usd,
  billing_divisor,
  dimensions,
  valid_from,
  source_url,
  verified_at,
  notes
) VALUES (
  'google_gemini',
  'gemini-embedding-001',
  'standard',
  'input_text_token',
  0.15,
  1000000,
  '{}'::jsonb,
  '2026-08-12T00:00:00Z',
  'https://ai.google.dev/gemini-api/docs/pricing',
  '2026-08-12T00:00:00Z',
  'Paid-tier text input; verified against the official Gemini API pricing page.'
)
ON CONFLICT (provider, model, operation, metric, dimensions, valid_from)
DO UPDATE SET
  unit_price_usd = EXCLUDED.unit_price_usd,
  billing_divisor = EXCLUDED.billing_divisor,
  source_url = EXCLUDED.source_url,
  verified_at = EXCLUDED.verified_at,
  notes = EXCLUDED.notes;

SELECT costs.rerate_pending_usage_events(10000);
