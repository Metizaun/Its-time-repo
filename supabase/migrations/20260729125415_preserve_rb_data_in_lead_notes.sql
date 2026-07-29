-- Repair the RB lead-note integration for Dr. Oculos and keep future syncs in
-- the existing crm.leads.notes field. No new lead columns are introduced.

INSERT INTO crm.empresas (
  aces_id,
  cnpj,
  name,
  legal_name,
  address,
  city,
  state,
  postal_code,
  is_active
)
SELECT
  account.id,
  source.cnpj,
  source.name,
  source.legal_name,
  source.address,
  source.city,
  source.state,
  source.postal_code,
  true
FROM crm.accounts AS account
CROSS JOIN (VALUES
  (
    '66972304000129',
    'Dr. Óculos — Loja 1',
    'DR OCULOS OTICA MATRIZ COMERCIO E SERVICOS LTDA',
    'Avenida Independência, SN, Quadra 18 Lote 11-E Loja 1, Jardim Monte Cristo',
    'Aparecida de Goiânia',
    'GO',
    '74968350'
  ),
  (
    '66972192000106',
    'Dr. Óculos — Loja 2',
    'DR OCULOS OTICA CENTRO COMERCIO E SERVICOS LTDA',
    'Avenida Dom Abel Ribeiro, SN, Quadra 30 Lote 1-E Sala 05, Setor Central',
    'Aparecida de Goiânia',
    'GO',
    '74980010'
  )
) AS source(cnpj, name, legal_name, address, city, state, postal_code)
WHERE account.id = 5
ON CONFLICT (aces_id, cnpj) DO UPDATE
SET
  name = EXCLUDED.name,
  legal_name = EXCLUDED.legal_name,
  address = EXCLUDED.address,
  city = EXCLUDED.city,
  state = EXCLUDED.state,
  postal_code = EXCLUDED.postal_code,
  is_active = true,
  updated_at = now();

WITH rb_notes AS (
  SELECT
    lead.id AS lead_id,
    concat_ws(
      E'\n',
      'Dados do Registro Base',
      '',
      'Código RB: ' || btrim(metadata.clie_id),
      'Empresa: ' || COALESCE(company.name, 'Loja ' || btrim(metadata.store_emp_id)),
      'CNPJ: ' || CASE
        WHEN length(crm.normalize_cnpj(metadata.store_emp_cpf_cnpj)) = 14 THEN
          substr(crm.normalize_cnpj(metadata.store_emp_cpf_cnpj), 1, 2) || '.' ||
          substr(crm.normalize_cnpj(metadata.store_emp_cpf_cnpj), 3, 3) || '.' ||
          substr(crm.normalize_cnpj(metadata.store_emp_cpf_cnpj), 6, 3) || '/' ||
          substr(crm.normalize_cnpj(metadata.store_emp_cpf_cnpj), 9, 4) || '-' ||
          substr(crm.normalize_cnpj(metadata.store_emp_cpf_cnpj), 13, 2)
        ELSE COALESCE(crm.normalize_cnpj(metadata.store_emp_cpf_cnpj), 'Não informado')
      END
    ) AS rb_note
  FROM crm.leads AS lead
  INNER JOIN rb.lead_metadata AS metadata
    ON metadata.lead_id = lead.id
   AND metadata.aces_id = lead.aces_id
  LEFT JOIN crm.empresas AS company
    ON company.aces_id = metadata.aces_id
   AND company.cnpj = crm.normalize_cnpj(metadata.store_emp_cpf_cnpj)
   AND company.is_active IS TRUE
  WHERE lead.aces_id = 5
    AND lead.view IS TRUE
    AND NULLIF(btrim(metadata.clie_id), '') IS NOT NULL
)
UPDATE crm.leads AS lead
SET
  notes = rb_notes.rb_note || CASE
    WHEN NULLIF(btrim(lead.notes), '') IS NULL THEN ''
    ELSE E'\n\n' || btrim(lead.notes)
  END,
  updated_at = now()
FROM rb_notes
WHERE lead.id = rb_notes.lead_id
  AND lead.notes IS DISTINCT FROM rb_notes.rb_note
  AND COALESCE(lead.notes, '') NOT LIKE 'Dados do Registro Base%';

DROP FUNCTION IF EXISTS crm.get_lead_rb_clie_id(uuid);
