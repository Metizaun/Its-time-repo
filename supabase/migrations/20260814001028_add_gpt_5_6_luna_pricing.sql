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
    'openai', 'gpt-5.6-luna', 'standard', 'input_text_token',
    1.00, 1000000, '2026-08-12T00:00:00Z',
    'https://developers.openai.com/api/docs/models/gpt-5.6-luna',
    '2026-08-12T00:00:00Z',
    'Preco publico por 1M tokens de entrada sem cache.'
  ),
  (
    'openai', 'gpt-5.6-luna', 'standard', 'cached_input_text_token',
    0.10, 1000000, '2026-08-12T00:00:00Z',
    'https://developers.openai.com/api/docs/models/gpt-5.6-luna',
    '2026-08-12T00:00:00Z',
    'Preco publico por 1M tokens de entrada em cache.'
  ),
  (
    'openai', 'gpt-5.6-luna', 'standard', 'output_token',
    6.00, 1000000, '2026-08-12T00:00:00Z',
    'https://developers.openai.com/api/docs/models/gpt-5.6-luna',
    '2026-08-12T00:00:00Z',
    'Preco publico por 1M tokens de saida, incluindo tokens de raciocinio cobrados como output.'
  )
ON CONFLICT (
  provider,
  model,
  operation,
  metric,
  dimensions,
  valid_from
) DO NOTHING;
