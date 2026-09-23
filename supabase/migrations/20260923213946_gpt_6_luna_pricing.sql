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
    'openai', 'gpt-6-luna', 'standard', 'input_text_token',
    0.10, 1000000, '2026-09-23T21:39:46Z',
    'https://developers.openai.com/api/docs/models/gpt-6-luna',
    '2026-09-23T21:39:46Z',
    'Preco publico padrao por 1M tokens de entrada sem cache.'
  ),
  (
    'openai', 'gpt-6-luna', 'standard', 'cached_input_text_token',
    0.01, 1000000, '2026-09-23T21:39:46Z',
    'https://developers.openai.com/api/docs/models/gpt-6-luna',
    '2026-09-23T21:39:46Z',
    'Preco publico padrao por 1M tokens de entrada em cache.'
  ),
  (
    'openai', 'gpt-6-luna', 'standard', 'output_token',
    0.50, 1000000, '2026-09-23T21:39:46Z',
    'https://developers.openai.com/api/docs/models/gpt-6-luna',
    '2026-09-23T21:39:46Z',
    'Preco publico padrao por 1M tokens de saida, incluindo tokens de raciocinio cobrados como output.'
  )
ON CONFLICT (
  provider,
  model,
  operation,
  metric,
  dimensions,
  valid_from
) DO NOTHING;
