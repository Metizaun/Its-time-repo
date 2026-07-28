-- Auto-link RB billing leads to created companies (crm.empresas) by store CNPJ.
--
-- 1. Trigger function when a lead's RB metadata is inserted or updated.
-- 2. Trigger function when a company is inserted or updated in crm.empresas.
-- 3. Immediate backfill for existing leads with RB metadata.

CREATE OR REPLACE FUNCTION crm.sync_lead_empresa_id_from_rb_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_normalized_cnpj text;
  v_empresa_id uuid;
BEGIN
  IF NEW.store_emp_cpf_cnpj IS NOT NULL AND length(btrim(NEW.store_emp_cpf_cnpj)) > 0 THEN
    v_normalized_cnpj := crm.normalize_cnpj(NEW.store_emp_cpf_cnpj);

    IF v_normalized_cnpj IS NOT NULL THEN
      SELECT e.id INTO v_empresa_id
      FROM crm.empresas AS e
      WHERE e.aces_id = NEW.aces_id
        AND e.cnpj = v_normalized_cnpj
        AND e.is_active IS TRUE
      LIMIT 1;

      IF v_empresa_id IS NOT NULL THEN
        UPDATE crm.leads
        SET empresa_id = v_empresa_id
        WHERE id = NEW.lead_id
          AND aces_id = NEW.aces_id
          AND (empresa_id IS NULL OR empresa_id <> v_empresa_id);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_lead_empresa_id_from_rb ON rb.lead_metadata;

CREATE TRIGGER trg_sync_lead_empresa_id_from_rb
AFTER INSERT OR UPDATE OF store_emp_cpf_cnpj ON rb.lead_metadata
FOR EACH ROW
EXECUTE FUNCTION crm.sync_lead_empresa_id_from_rb_metadata();

-- ---------------------------------------------------------------------------
-- 2. Trigger when a company is inserted or updated in crm.empresas
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm.sync_leads_empresa_id_on_company_upsert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.is_active IS TRUE AND NEW.cnpj IS NOT NULL THEN
    UPDATE crm.leads AS l
    SET empresa_id = NEW.id
    FROM rb.lead_metadata AS rbm
    WHERE rbm.lead_id = l.id
      AND rbm.aces_id = NEW.aces_id
      AND crm.normalize_cnpj(rbm.store_emp_cpf_cnpj) = NEW.cnpj
      AND (l.empresa_id IS NULL OR l.empresa_id <> NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_leads_empresa_id_on_company ON crm.empresas;

CREATE TRIGGER trg_sync_leads_empresa_id_on_company
AFTER INSERT OR UPDATE OF cnpj, is_active ON crm.empresas
FOR EACH ROW
EXECUTE FUNCTION crm.sync_leads_empresa_id_on_company_upsert();

-- ---------------------------------------------------------------------------
-- 3. Backfill existing leads with matching RB metadata store CNPJs
-- ---------------------------------------------------------------------------

UPDATE crm.leads AS l
SET empresa_id = e.id
FROM rb.lead_metadata AS rbm
JOIN crm.empresas AS e
  ON e.aces_id = rbm.aces_id
 AND e.cnpj = crm.normalize_cnpj(rbm.store_emp_cpf_cnpj)
 AND e.is_active IS TRUE
WHERE rbm.lead_id = l.id
  AND (l.empresa_id IS NULL OR l.empresa_id <> e.id);
