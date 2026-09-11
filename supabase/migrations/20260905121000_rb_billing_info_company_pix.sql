-- Resolve the Pix key from the administrative company settings. The legacy
-- lead metadata remains a fallback only when no company can be matched.
DROP FUNCTION IF EXISTS rb.get_billing_info(uuid);

CREATE OR REPLACE FUNCTION rb.get_billing_info(p_lead_id uuid)
RETURNS TABLE (
  lead_id uuid,
  clie_id text,
  cpf_cnpj text,
  store_emp_id text,
  store_emp_cpf_cnpj text,
  total_amount numeric,
  titles_count integer,
  titles jsonb,
  next_due_date date,
  pix_key text,
  last_sync_at timestamptz,
  store_name text,
  store_legal_name text,
  store_address text,
  store_city text,
  store_state text,
  store_postal_code text,
  store_phone text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, crm, rb
AS $$
  SELECT
    rbm.lead_id,
    rbm.clie_id,
    rbm.cpf_cnpj,
    rbm.store_emp_id,
    rbm.store_emp_cpf_cnpj,
    rbm.total_amount,
    rbm.titles_count,
    rbm.titles,
    rbm.next_due_date,
    CASE
      WHEN e.id IS NOT NULL AND e.use_cnpj_as_pix IS TRUE THEN e.cnpj
      WHEN e.id IS NOT NULL THEN e.pix_key
      ELSE rbm.pix_key
    END AS pix_key,
    rbm.last_sync_at,
    e.name AS store_name,
    e.legal_name AS store_legal_name,
    e.address AS store_address,
    e.city AS store_city,
    e.state AS store_state,
    e.postal_code AS store_postal_code,
    e.phone AS store_phone
  FROM rb.lead_metadata rbm
  JOIN crm.leads l ON l.id = rbm.lead_id AND l.aces_id = rbm.aces_id
  LEFT JOIN crm.empresas e
    ON e.aces_id = rbm.aces_id
   AND e.cnpj = crm.normalize_cnpj(rbm.store_emp_cpf_cnpj)
   AND e.is_active IS TRUE
  WHERE rbm.lead_id = p_lead_id
    AND EXISTS (
      SELECT 1
      FROM rb.connections connection
      WHERE connection.aces_id = rbm.aces_id
        AND connection.is_active IS TRUE
        AND connection.billing_enabled IS TRUE
    );
$$;

GRANT EXECUTE ON FUNCTION rb.get_billing_info(uuid) TO anon, authenticated, service_role;
