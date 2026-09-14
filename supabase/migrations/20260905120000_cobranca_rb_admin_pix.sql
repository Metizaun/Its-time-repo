-- Cobrança RB is controlled separately from the existence of the RB connection.
ALTER TABLE rb.connections
  ADD COLUMN IF NOT EXISTS billing_enabled boolean NOT NULL DEFAULT false;

-- Existing active connections keep operating after the migration. New
-- connections inherit the false default and must be explicitly enabled by an
-- administrator.
UPDATE rb.connections
SET billing_enabled = is_active
WHERE billing_enabled IS DISTINCT FROM is_active;

ALTER TABLE crm.empresas
  ADD COLUMN IF NOT EXISTS pix_key text,
  ADD COLUMN IF NOT EXISTS use_cnpj_as_pix boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS rb.pix_migration_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  company_id uuid REFERENCES crm.empresas(id) ON DELETE SET NULL,
  legacy_key text NOT NULL,
  candidate_pix_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text NOT NULL,
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT pix_migration_reviews_candidates_object_check CHECK (jsonb_typeof(candidate_pix_keys) = 'array'),
  CONSTRAINT pix_migration_reviews_status_check CHECK (status IN ('pending', 'resolved', 'dismissed')),
  CONSTRAINT pix_migration_reviews_unique UNIQUE (aces_id, legacy_key, reason)
);

ALTER TABLE rb.pix_migration_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rb_pix_migration_reviews_service_only ON rb.pix_migration_reviews;
CREATE POLICY rb_pix_migration_reviews_service_only
ON rb.pix_migration_reviews
FOR ALL
USING (false)
WITH CHECK (false);

REVOKE ALL ON rb.pix_migration_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON rb.pix_migration_reviews TO service_role;

-- Move only unambiguous legacy keys. Conflicts and keys with no company match
-- stay in the review table and the original agent configuration is untouched.
DO $$
DECLARE
  company_row record;
  mapping record;
  metadata record;
  candidates text[];
  candidate text;
  companyKey text;
  matched boolean;
BEGIN
  FOR company_row IN
    SELECT id, aces_id, cnpj
    FROM crm.empresas
  LOOP
    candidates := ARRAY[]::text[];

    FOR mapping IN
      SELECT DISTINCT btrim(item.key) AS legacy_key, btrim(item.value) AS pix_key
      FROM agents.agent_tools tool
      CROSS JOIN LATERAL jsonb_each_text(
        CASE
          WHEN jsonb_typeof(tool.config->'pix_mapping_by_store') = 'object'
            THEN tool.config->'pix_mapping_by_store'
          ELSE '{}'::jsonb
        END
      ) item
      WHERE tool.aces_id = company_row.aces_id
        AND tool.tool_key = 'rb_billing'
        AND btrim(item.value) <> ''
        AND (
          crm.normalize_cnpj(item.key) = company_row.cnpj
          OR EXISTS (
            SELECT 1
            FROM rb.lead_metadata legacy_metadata
            WHERE legacy_metadata.aces_id = company_row.aces_id
              AND legacy_metadata.store_emp_id = btrim(item.key)
              AND crm.normalize_cnpj(legacy_metadata.store_emp_cpf_cnpj) = company_row.cnpj
          )
        )
    LOOP
      IF NOT (candidates @> ARRAY[mapping.pix_key]) THEN
        candidates := array_append(candidates, mapping.pix_key);
      END IF;
    END LOOP;

    FOR metadata IN
      SELECT DISTINCT btrim(pix_key) AS pix_key
      FROM rb.lead_metadata
      WHERE aces_id = company_row.aces_id
        AND btrim(COALESCE(pix_key, '')) <> ''
        AND crm.normalize_cnpj(store_emp_cpf_cnpj) = company_row.cnpj
    LOOP
      IF NOT (candidates @> ARRAY[metadata.pix_key]) THEN
        candidates := array_append(candidates, metadata.pix_key);
      END IF;
    END LOOP;

    companyKey := 'company:' || company_row.id::text;
    IF cardinality(candidates) = 1 THEN
      candidate := candidates[1];
      UPDATE crm.empresas
      SET pix_key = candidate,
          use_cnpj_as_pix = crm.normalize_cnpj(candidate) = company_row.cnpj
      WHERE id = company_row.id;
    ELSIF cardinality(candidates) > 1 THEN
      INSERT INTO rb.pix_migration_reviews (
        aces_id, company_id, legacy_key, candidate_pix_keys, reason, source_snapshot
      ) VALUES (
        company_row.aces_id, company_row.id, companyKey, to_jsonb(candidates),
        'conflicting_pix_keys', jsonb_build_object('companyCnpj', company_row.cnpj)
      ) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  FOR mapping IN
    SELECT tool.aces_id, btrim(item.key) AS legacy_key, btrim(item.value) AS pix_key
    FROM agents.agent_tools tool
    CROSS JOIN LATERAL jsonb_each_text(
      CASE
        WHEN jsonb_typeof(tool.config->'pix_mapping_by_store') = 'object'
          THEN tool.config->'pix_mapping_by_store'
        ELSE '{}'::jsonb
      END
    ) item
    WHERE tool.tool_key = 'rb_billing'
      AND btrim(item.value) <> ''
  LOOP
    matched := EXISTS (
      SELECT 1
      FROM crm.empresas company
      WHERE company.aces_id = mapping.aces_id
        AND (
          crm.normalize_cnpj(mapping.legacy_key) = company.cnpj
          OR EXISTS (
            SELECT 1
            FROM rb.lead_metadata legacy_metadata
            WHERE legacy_metadata.aces_id = mapping.aces_id
              AND legacy_metadata.store_emp_id = mapping.legacy_key
              AND crm.normalize_cnpj(legacy_metadata.store_emp_cpf_cnpj) = company.cnpj
          )
        )
    );
    IF NOT matched THEN
      INSERT INTO rb.pix_migration_reviews (
        aces_id, legacy_key, candidate_pix_keys, reason, source_snapshot
      ) VALUES (
        mapping.aces_id, mapping.legacy_key, jsonb_build_array(mapping.pix_key),
        'company_not_found', jsonb_build_object('legacyKey', mapping.legacy_key)
      ) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON COLUMN rb.connections.billing_enabled IS
  'Controls new RB billing pulls and dispatches; connection credentials remain configured independently.';
COMMENT ON COLUMN crm.empresas.pix_key IS
  'Manual Pix key used when use_cnpj_as_pix is false.';
COMMENT ON COLUMN crm.empresas.use_cnpj_as_pix IS
  'Uses the normalized company CNPJ as the Pix key.';
