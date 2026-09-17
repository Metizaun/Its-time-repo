-- Adds an optional allow-list parameter to the company directory lookups so an agent can be
-- restricted to a subset of crm.empresas within its own account. Both the current (_v2) and the
-- legacy fallback function are updated so a rollback of the v2 function cannot silently reopen
-- cross-brand visibility. Passing NULL preserves the previous behaviour (no restriction) for any
-- caller that has not been updated yet; application code always passes an explicit array.
--
-- CREATE OR REPLACE cannot change a function's parameter list in place (Postgres identifies a
-- function by its full signature, so an extra parameter creates a second overload instead of
-- replacing the old one). Drop the old signatures first so PostgREST never has to disambiguate
-- between two overloads of the same name.

DROP FUNCTION IF EXISTS crm.lookup_company_directory_v2(text, text, text, integer, integer, boolean);
DROP FUNCTION IF EXISTS crm.lookup_company_directory(text, text, text, integer, integer);

CREATE OR REPLACE FUNCTION crm.lookup_company_directory_v2(
  p_query text,
  p_service_query text DEFAULT NULL,
  p_professional_query text DEFAULT NULL,
  p_limit integer DEFAULT 4,
  p_aces_id integer DEFAULT NULL,
  p_require_calendar boolean DEFAULT false,
  p_allowed_company_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  company_id uuid,
  cnpj text,
  legal_name text,
  trade_name text,
  phone text,
  email text,
  address text,
  city text,
  state text,
  postal_code text,
  timezone text,
  professionals jsonb,
  match_score real,
  is_ambiguous boolean,
  matched_alias text,
  availability_ready boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH input AS (
    SELECT
      NULLIF(crm.normalize_directory_text(NULLIF(btrim(p_query), '')), '') AS company_query,
      NULLIF(crm.normalize_directory_text(NULLIF(btrim(p_service_query), '')), '') AS service_query,
      NULLIF(crm.normalize_directory_text(NULLIF(btrim(p_professional_query), '')), '') AS professional_query,
      LEAST(GREATEST(COALESCE(p_limit, 4), 1), 4) AS result_limit
  ),
  company_documents AS (
    SELECT
      company.*,
      crm.normalize_directory_text(
        concat_ws(
          ' ',
          company.cnpj,
          company.name,
          company.legal_name,
          company.address,
          company.city,
          company.state,
          aliases.alias_document,
          professional_aliases.professional_document
        )
      ) AS directory_key,
      aliases.matched_alias,
      EXISTS (
        SELECT 1
        FROM calendar.professional_locations AS location
        JOIN calendar.professionals AS professional
          ON professional.id = location.professional_id
         AND professional.aces_id = location.aces_id
         AND professional.is_active IS TRUE
        JOIN calendar.professional_services AS binding
          ON binding.professional_location_id = location.id
         AND binding.aces_id = location.aces_id
         AND binding.is_active IS TRUE
         AND binding.is_ai_visible IS TRUE
        JOIN calendar.services AS service
          ON service.id = binding.service_id
         AND service.aces_id = binding.aces_id
         AND service.is_active IS TRUE
         AND service.is_ai_visible IS TRUE
        WHERE location.aces_id = company.aces_id
          AND location.empresa_id = company.id
          AND location.is_active IS TRUE
          AND location.is_ai_visible IS TRUE
      ) AS availability_ready
    FROM crm.empresas AS company
    CROSS JOIN input
    LEFT JOIN LATERAL (
      SELECT
        string_agg(alias_item.value, ' ' ORDER BY alias_item.ordinality) AS alias_document,
        (
          SELECT original_alias.value
          FROM unnest(company.search_aliases) WITH ORDINALITY AS original_alias(value, ordinality)
          WHERE crm.normalize_directory_text(original_alias.value) = input.company_query
          ORDER BY original_alias.ordinality
          LIMIT 1
        ) AS matched_alias
      FROM unnest(company.search_aliases) WITH ORDINALITY AS alias_item(value, ordinality)
    ) AS aliases ON TRUE
    LEFT JOIN LATERAL (
      SELECT string_agg(
        concat_ws(' ', professional.name, professional.specialty),
        ' '
        ORDER BY professional.name
      ) AS professional_document
      FROM calendar.professional_locations AS location
      JOIN calendar.professionals AS professional
        ON professional.id = location.professional_id
       AND professional.aces_id = location.aces_id
       AND professional.is_active IS TRUE
      WHERE location.aces_id = company.aces_id
        AND location.empresa_id = company.id
        AND location.is_active IS TRUE
        AND location.is_ai_visible IS TRUE
    ) AS professional_aliases ON TRUE
    WHERE p_aces_id IS NOT NULL
      AND company.aces_id = p_aces_id
      AND company.is_active IS TRUE
      AND (p_allowed_company_ids IS NULL OR company.id = ANY(p_allowed_company_ids))
  ),
  candidates AS (
    SELECT
      company.*,
      CASE
        WHEN input.company_query IS NULL THEN 0.50::real
        WHEN crm.normalize_directory_text(company.cnpj) = input.company_query THEN 1.00::real
        WHEN crm.normalize_directory_text(company.name) = input.company_query THEN 1.00::real
        WHEN company.matched_alias IS NOT NULL THEN 0.995::real
        WHEN crm.normalize_directory_text(company.legal_name) = input.company_query THEN 0.99::real
        WHEN crm.normalize_directory_text(company.name) LIKE '%' || input.company_query || '%' THEN 0.97::real
        WHEN NOT EXISTS (
          SELECT 1
          FROM unnest(string_to_array(input.company_query, ' ')) AS query_token(value)
          WHERE length(query_token.value) > 1
            AND company.directory_key NOT LIKE '%' || query_token.value || '%'
        ) THEN 0.96::real
        WHEN crm.normalize_directory_text(company.city) = input.company_query THEN 0.93::real
        ELSE extensions.similarity(company.directory_key, input.company_query)::real
      END AS score
    FROM company_documents AS company
    CROSS JOIN input
    WHERE (NOT COALESCE(p_require_calendar, false) OR company.availability_ready)
      AND (
        input.company_query IS NULL
        OR company.matched_alias IS NOT NULL
        OR company.directory_key LIKE '%' || input.company_query || '%'
        OR NOT EXISTS (
          SELECT 1
          FROM unnest(string_to_array(input.company_query, ' ')) AS query_token(value)
          WHERE length(query_token.value) > 1
            AND company.directory_key NOT LIKE '%' || query_token.value || '%'
        )
        OR extensions.similarity(company.directory_key, input.company_query) >= 0.55
      )
      AND (
        input.professional_query IS NULL
        OR EXISTS (
          SELECT 1
          FROM calendar.professional_locations AS location
          JOIN calendar.professionals AS professional
            ON professional.id = location.professional_id
           AND professional.aces_id = location.aces_id
          WHERE location.aces_id = company.aces_id
            AND location.empresa_id = company.id
            AND location.is_active IS TRUE
            AND location.is_ai_visible IS TRUE
            AND professional.is_active IS TRUE
            AND crm.normalize_directory_text(
              professional.name || ' ' || COALESCE(professional.specialty, '')
            ) LIKE '%' || input.professional_query || '%'
        )
      )
      AND (
        input.service_query IS NULL
        OR EXISTS (
          SELECT 1
          FROM calendar.professional_locations AS location
          JOIN calendar.professional_services AS binding
            ON binding.professional_location_id = location.id
           AND binding.aces_id = location.aces_id
           AND binding.is_active IS TRUE
           AND binding.is_ai_visible IS TRUE
          JOIN calendar.services AS service
            ON service.id = binding.service_id
           AND service.aces_id = binding.aces_id
           AND service.is_active IS TRUE
           AND service.is_ai_visible IS TRUE
          WHERE location.aces_id = company.aces_id
            AND location.empresa_id = company.id
            AND location.is_active IS TRUE
            AND location.is_ai_visible IS TRUE
            AND crm.normalize_directory_text(
              service.name || ' ' || COALESCE(service.description, '')
            ) LIKE '%' || input.service_query || '%'
        )
      )
  ),
  ranked AS (
    SELECT candidates.*, count(*) OVER () AS result_count
    FROM candidates
    ORDER BY candidates.score DESC, candidates.name
    LIMIT (SELECT result_limit FROM input)
  )
  SELECT
    ranked.id,
    ranked.cnpj,
    ranked.legal_name,
    ranked.name,
    ranked.phone,
    ranked.email,
    ranked.address,
    ranked.city,
    ranked.state,
    ranked.postal_code,
    ranked.timezone,
    COALESCE(directory.professionals, '[]'::jsonb),
    ranked.score,
    ranked.result_count > 1,
    ranked.matched_alias,
    ranked.availability_ready
  FROM ranked
  CROSS JOIN input
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(entry.value ORDER BY entry.professional_name) AS professionals
    FROM (
      SELECT
        professional.name AS professional_name,
        jsonb_build_object(
          'professional_id', professional.id,
          'professional_location_id', location.id,
          'name', professional.name,
          'specialty', professional.specialty,
          'services', COALESCE(services.items, '[]'::jsonb)
        ) AS value
      FROM calendar.professional_locations AS location
      JOIN calendar.professionals AS professional
        ON professional.id = location.professional_id
       AND professional.aces_id = location.aces_id
       AND professional.is_active IS TRUE
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'service_id', service.id,
            'name', service.name,
            'duration_minutes', COALESCE(binding.duration_minutes_override, service.duration_minutes),
            'price_cents', COALESCE(binding.price_cents_override, service.price_cents)
          )
          ORDER BY service.name
        ) AS items
        FROM calendar.professional_services AS binding
        JOIN calendar.services AS service
          ON service.id = binding.service_id
         AND service.aces_id = binding.aces_id
         AND service.is_active IS TRUE
         AND service.is_ai_visible IS TRUE
        WHERE binding.aces_id = ranked.aces_id
          AND binding.professional_location_id = location.id
          AND binding.is_active IS TRUE
          AND binding.is_ai_visible IS TRUE
          AND (
            input.service_query IS NULL
            OR crm.normalize_directory_text(
              service.name || ' ' || COALESCE(service.description, '')
            ) LIKE '%' || input.service_query || '%'
          )
      ) AS services ON TRUE
      WHERE location.aces_id = ranked.aces_id
        AND location.empresa_id = ranked.id
        AND location.is_active IS TRUE
        AND location.is_ai_visible IS TRUE
        AND (
          input.professional_query IS NULL
          OR crm.normalize_directory_text(
            professional.name || ' ' || COALESCE(professional.specialty, '')
          ) LIKE '%' || input.professional_query || '%'
        )
      ORDER BY professional.name
      LIMIT 4
    ) AS entry
  ) AS directory ON TRUE
  ORDER BY ranked.score DESC, ranked.name;
$$;

REVOKE ALL ON FUNCTION crm.lookup_company_directory_v2(text, text, text, integer, integer, boolean, uuid[])
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.lookup_company_directory_v2(text, text, text, integer, integer, boolean, uuid[])
  TO service_role;

-- Legacy fallback (used only when the _v2 function cannot be found, e.g. mid-rollback). Same
-- allow-list treatment, applied directly in the candidates CTE since this version has no
-- separate company_documents CTE.

CREATE OR REPLACE FUNCTION crm.lookup_company_directory(
  p_query text,
  p_service_query text DEFAULT NULL,
  p_professional_query text DEFAULT NULL,
  p_limit integer DEFAULT 4,
  p_aces_id integer DEFAULT NULL,
  p_allowed_company_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  company_id uuid,
  cnpj text,
  legal_name text,
  trade_name text,
  phone text,
  email text,
  address text,
  city text,
  state text,
  postal_code text,
  timezone text,
  professionals jsonb,
  match_score real,
  is_ambiguous boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH input AS (
    SELECT
      NULLIF(crm.normalize_search_text(NULLIF(btrim(p_query), '')), '') AS company_query,
      NULLIF(crm.normalize_search_text(NULLIF(btrim(p_service_query), '')), '') AS service_query,
      NULLIF(crm.normalize_search_text(NULLIF(btrim(p_professional_query), '')), '') AS professional_query,
      LEAST(GREATEST(COALESCE(p_limit, 4), 1), 4) AS result_limit
  ),
  candidates AS (
    SELECT
      company.*,
      CASE
        WHEN input.company_query IS NULL THEN 0.5::real
        WHEN crm.normalize_search_text(company.cnpj) = input.company_query THEN 1::real
        WHEN crm.normalize_search_text(company.name) = input.company_query THEN 1::real
        WHEN crm.normalize_search_text(company.legal_name) = input.company_query THEN 0.98::real
        WHEN crm.normalize_search_text(company.name) LIKE '%' || input.company_query || '%' THEN 0.94::real
        WHEN crm.normalize_search_text(company.city) = input.company_query THEN 0.90::real
        ELSE extensions.similarity(company.search_key, input.company_query)::real
      END AS score
    FROM crm.empresas AS company
    CROSS JOIN input
    WHERE p_aces_id IS NOT NULL
      AND company.aces_id = p_aces_id
      AND company.is_active IS TRUE
      AND (p_allowed_company_ids IS NULL OR company.id = ANY(p_allowed_company_ids))
      AND (
        input.company_query IS NULL
        OR company.search_key LIKE '%' || input.company_query || '%'
        OR extensions.similarity(company.search_key, input.company_query) >= 0.20
      )
      AND (
        input.professional_query IS NULL
        OR EXISTS (
          SELECT 1
          FROM calendar.professional_locations AS location
          JOIN calendar.professionals AS professional
            ON professional.id = location.professional_id
           AND professional.aces_id = location.aces_id
          WHERE location.aces_id = company.aces_id
            AND location.empresa_id = company.id
            AND location.is_active IS TRUE
            AND location.is_ai_visible IS TRUE
            AND professional.is_active IS TRUE
            AND crm.normalize_search_text(professional.name || ' ' || COALESCE(professional.specialty, ''))
              LIKE '%' || input.professional_query || '%'
        )
      )
      AND (
        input.service_query IS NULL
        OR EXISTS (
          SELECT 1
          FROM calendar.professional_locations AS location
          JOIN calendar.professional_services AS binding
            ON binding.professional_location_id = location.id
           AND binding.aces_id = location.aces_id
           AND binding.is_active IS TRUE
           AND binding.is_ai_visible IS TRUE
          JOIN calendar.services AS service
            ON service.id = binding.service_id
           AND service.aces_id = binding.aces_id
           AND service.is_active IS TRUE
           AND service.is_ai_visible IS TRUE
          WHERE location.aces_id = company.aces_id
            AND location.empresa_id = company.id
            AND location.is_active IS TRUE
            AND location.is_ai_visible IS TRUE
            AND crm.normalize_search_text(service.name || ' ' || COALESCE(service.description, ''))
              LIKE '%' || input.service_query || '%'
        )
      )
  ),
  ranked AS (
    SELECT candidates.*, count(*) OVER () AS result_count
    FROM candidates
    ORDER BY candidates.score DESC, candidates.name
    LIMIT (SELECT result_limit FROM input)
  )
  SELECT
    ranked.id,
    ranked.cnpj,
    ranked.legal_name,
    ranked.name,
    ranked.phone,
    ranked.email,
    ranked.address,
    ranked.city,
    ranked.state,
    ranked.postal_code,
    ranked.timezone,
    COALESCE(directory.professionals, '[]'::jsonb),
    ranked.score,
    ranked.result_count > 1
  FROM ranked
  CROSS JOIN input
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(entry.value ORDER BY entry.professional_name) AS professionals
    FROM (
      SELECT
        professional.name AS professional_name,
        jsonb_build_object(
          'professional_id', professional.id,
          'professional_location_id', location.id,
          'name', professional.name,
          'specialty', professional.specialty,
          'services', COALESCE(services.items, '[]'::jsonb)
        ) AS value
      FROM calendar.professional_locations AS location
      JOIN calendar.professionals AS professional
        ON professional.id = location.professional_id
       AND professional.aces_id = location.aces_id
       AND professional.is_active IS TRUE
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'service_id', service.id,
            'name', service.name,
            'duration_minutes', COALESCE(binding.duration_minutes_override, service.duration_minutes),
            'price_cents', COALESCE(binding.price_cents_override, service.price_cents)
          )
          ORDER BY service.name
        ) AS items
        FROM calendar.professional_services AS binding
        JOIN calendar.services AS service
          ON service.id = binding.service_id
         AND service.aces_id = binding.aces_id
         AND service.is_active IS TRUE
         AND service.is_ai_visible IS TRUE
        WHERE binding.aces_id = ranked.aces_id
          AND binding.professional_location_id = location.id
          AND binding.is_active IS TRUE
          AND binding.is_ai_visible IS TRUE
          AND (
            input.service_query IS NULL
            OR crm.normalize_search_text(service.name || ' ' || COALESCE(service.description, ''))
              LIKE '%' || input.service_query || '%'
          )
      ) AS services ON TRUE
      WHERE location.aces_id = ranked.aces_id
        AND location.empresa_id = ranked.id
        AND location.is_active IS TRUE
        AND location.is_ai_visible IS TRUE
        AND (
          input.professional_query IS NULL
          OR crm.normalize_search_text(professional.name || ' ' || COALESCE(professional.specialty, ''))
            LIKE '%' || input.professional_query || '%'
        )
      ORDER BY professional.name
      LIMIT 4
    ) AS entry
  ) AS directory ON TRUE
  ORDER BY ranked.score DESC, ranked.name;
$$;

REVOKE ALL ON FUNCTION crm.lookup_company_directory(text, text, text, integer, integer, uuid[])
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.lookup_company_directory(text, text, text, integer, integer, uuid[])
  TO service_role;
