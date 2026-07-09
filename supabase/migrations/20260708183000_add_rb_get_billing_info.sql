-- Criação da função de obter dados de cobrança com resolução dinâmica de PIX
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
  last_sync_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, crm, rb, agents
AS $$
DECLARE
  v_aces_id integer;
  v_store_emp_id text;
  v_store_emp_cpf_cnpj text;
  v_stored_pix_key text;
  v_pix_mapping jsonb;
  v_resolved_pix_key text;
BEGIN
  -- 1. Obter os dados básicos e referências de cobrança do lead
  SELECT 
    l.aces_id,
    rbm.store_emp_id,
    rbm.store_emp_cpf_cnpj,
    rbm.pix_key
  INTO 
    v_aces_id,
    v_store_emp_id,
    v_store_emp_cpf_cnpj,
    v_stored_pix_key
  FROM crm.leads l
  LEFT JOIN rb.lead_metadata rbm ON rbm.lead_id = l.id
  WHERE l.id = p_lead_id;

  -- Retorna vazio caso o lead não possua metadados de cobrança
  IF v_aces_id IS NULL THEN
    RETURN;
  END IF;

  -- 2. Carregar o mapeamento de PIX da configuração ativa do robô
  SELECT COALESCE(config->'pix_mapping_by_store', '{}'::jsonb)
  INTO v_pix_mapping
  FROM agents.agent_tools
  WHERE aces_id = v_aces_id
    AND tool_key = 'rb_billing'
    AND is_enabled = true
  LIMIT 1;

  -- 3. Resolução hierárquica do PIX com base na empresa devedora
  IF v_pix_mapping IS NOT NULL THEN
    v_resolved_pix_key := v_pix_mapping->>v_store_emp_id;
    IF v_resolved_pix_key IS NULL AND v_store_emp_cpf_cnpj IS NOT NULL THEN
      v_resolved_pix_key := v_pix_mapping->>v_store_emp_cpf_cnpj;
    END IF;
  END IF;

  -- Fallbacks seguros
  IF v_resolved_pix_key IS NULL THEN
    v_resolved_pix_key := COALESCE(v_stored_pix_key, v_store_emp_cpf_cnpj);
  END IF;

  -- 4. Retornar os dados consolidados da cobrança
  RETURN QUERY
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
    v_resolved_pix_key AS pix_key,
    rbm.last_sync_at
  FROM rb.lead_metadata rbm
  WHERE rbm.lead_id = p_lead_id;
END;
$$;

-- Conceder permissões para os roles do Supabase
GRANT EXECUTE ON FUNCTION rb.get_billing_info(uuid) TO anon, authenticated, service_role;
