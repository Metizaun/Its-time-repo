-- Documents the new allowedCompanyIds property on the store_locator tool config.
-- Purely descriptive: config_schema is not validated at runtime, validation happens in application code.

INSERT INTO agents.tool_definitions (
  tool_key,
  version,
  display_name,
  description,
  icon,
  config_schema,
  is_active
)
VALUES (
  'store_locator',
  1,
  'Busca de filiais',
  'Localiza e recomenda a filial mais adequada pelo tempo de carro.',
  'map-pinned',
  jsonb_build_object(
    'type', 'object',
    'properties', jsonb_build_object(
      'candidateLimit', jsonb_build_object('type', 'integer', 'minimum', 1, 'maximum', 10, 'default', 5),
      'routeCacheMinutes', jsonb_build_object('type', 'integer', 'minimum', 5, 'maximum', 120, 'default', 30),
      'travelMode', jsonb_build_object('type', 'string', 'enum', jsonb_build_array('DRIVE'), 'default', 'DRIVE'),
      'locationRetentionMonths', jsonb_build_object('type', 'integer', 'const', 12),
      'allowedCompanyIds', jsonb_build_object(
        'type', 'array',
        'items', jsonb_build_object('type', 'string', 'format', 'uuid'),
        'default', jsonb_build_array()
      )
    ),
    'additionalProperties', false
  ),
  true
)
ON CONFLICT (tool_key, version) DO UPDATE
SET display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    config_schema = EXCLUDED.config_schema,
    is_active = EXCLUDED.is_active,
    updated_at = now();
