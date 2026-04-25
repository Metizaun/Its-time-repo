-- Reparacao manual para restaurar a visibilidade dos leads do Juan apos a
-- recriacao de instancias com os mesmos nomes sob outro usuario.
--
-- Execute no SQL Editor do Supabase e revise os SELECTs de diagnostico antes
-- de aplicar em producao.

-- 0) Contexto do incidente: auth user identificado no token enviado.
CREATE TEMP TABLE tmp_juan_context AS
SELECT
  u.id AS crm_user_id,
  u.auth_user_id,
  u.aces_id,
  u.email,
  u.name,
  u.role
FROM crm.users u
WHERE u.auth_user_id = '75d76068-e554-47ee-aa49-774863aa49e8'::uuid
LIMIT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tmp_juan_context) THEN
    RAISE EXCEPTION 'Usuario CRM do Juan nao encontrado a partir do auth_user_id do incidente';
  END IF;
END;
$$;

-- 1) Base historica das instancias do Juan.
CREATE TEMP TABLE tmp_juan_instance_names AS
SELECT DISTINCT instancia
FROM (
  SELECT l.instancia
  FROM crm.leads l
  CROSS JOIN tmp_juan_context jc
  WHERE l.aces_id = jc.aces_id
    AND l.owner_id = jc.crm_user_id
    AND NULLIF(btrim(l.instancia), '') IS NOT NULL

  UNION

  SELECT i.instancia
  FROM crm.instance i
  CROSS JOIN tmp_juan_context jc
  WHERE i.aces_id = jc.aces_id
    AND i.created_by = jc.crm_user_id
    AND COALESCE(i.setup_status, 'connected') <> 'cancelled'
    AND NULLIF(btrim(i.instancia), '') IS NOT NULL

  UNION

  SELECT a.instance_name AS instancia
  FROM crm.ai_agents a
  CROSS JOIN tmp_juan_context jc
  WHERE a.aces_id = jc.aces_id
    AND a.created_by = jc.crm_user_id
    AND NULLIF(btrim(a.instance_name), '') IS NOT NULL

  UNION

  SELECT mh.instance AS instancia
  FROM crm.message_history mh
  CROSS JOIN tmp_juan_context jc
  WHERE mh.aces_id = jc.aces_id
    AND mh.created_by = jc.crm_user_id
    AND NULLIF(btrim(mh.instance), '') IS NOT NULL
) resolved
WHERE NULLIF(btrim(instancia), '') IS NOT NULL;

-- 2) Diagnostico antes do reparo.
CREATE TEMP TABLE tmp_juan_visible_before AS
SELECT l.id
FROM crm.leads l
JOIN crm.instance i
  ON i.aces_id = l.aces_id
 AND i.instancia = l.instancia
CROSS JOIN tmp_juan_context jc
WHERE l.aces_id = jc.aces_id
  AND l.owner_id = jc.crm_user_id
  AND i.created_by = jc.crm_user_id
  AND COALESCE(i.setup_status, 'connected') <> 'cancelled';

SELECT * FROM tmp_juan_context;

SELECT
  tin.instancia,
  i.created_by AS current_instance_owner_id,
  jc.crm_user_id AS juan_crm_user_id,
  COALESCE(i.setup_status, 'connected') AS setup_status,
  COUNT(l.id) FILTER (WHERE l.owner_id = jc.crm_user_id) AS leads_owned_by_juan,
  COUNT(l.id) FILTER (WHERE l.owner_id IS DISTINCT FROM jc.crm_user_id) AS leads_owned_by_other_users
FROM tmp_juan_instance_names tin
LEFT JOIN crm.instance i
  ON i.instancia = tin.instancia
 AND i.aces_id = (SELECT aces_id FROM tmp_juan_context LIMIT 1)
LEFT JOIN crm.leads l
  ON l.instancia = tin.instancia
 AND l.aces_id = (SELECT aces_id FROM tmp_juan_context LIMIT 1)
CROSS JOIN tmp_juan_context jc
GROUP BY tin.instancia, i.created_by, jc.crm_user_id, COALESCE(i.setup_status, 'connected')
ORDER BY tin.instancia;

SELECT
  COUNT(*) AS visible_leads_before
FROM tmp_juan_visible_before;

-- 3) Reatribui as instancias historicas do Juan para o proprio Juan.
CREATE TEMP TABLE tmp_juan_repaired_instances AS
WITH repaired AS (
  UPDATE crm.instance i
  SET created_by = jc.crm_user_id
  FROM tmp_juan_context jc
  JOIN tmp_juan_instance_names tin
    ON TRUE
  WHERE i.aces_id = jc.aces_id
    AND i.instancia = tin.instancia
    AND COALESCE(i.setup_status, 'connected') <> 'cancelled'
    AND i.created_by IS DISTINCT FROM jc.crm_user_id
  RETURNING i.instancia, jc.crm_user_id AS repaired_to
)
SELECT *
FROM repaired;

-- 4) Reatribui ao Juan os leads ativos das instancias historicas dele.
CREATE TEMP TABLE tmp_juan_repaired_leads AS
WITH repaired AS (
  UPDATE crm.leads l
  SET
    owner_id = jc.crm_user_id,
    updated_at = now()
  FROM tmp_juan_context jc
  JOIN tmp_juan_instance_names tin
    ON TRUE
  WHERE l.aces_id = jc.aces_id
    AND l.instancia = tin.instancia
    AND COALESCE(l.view, TRUE) = TRUE
    AND l.owner_id IS DISTINCT FROM jc.crm_user_id
  RETURNING l.id, l.name, l.contact_phone, l.instancia, jc.crm_user_id AS repaired_to
)
SELECT *
FROM repaired;

-- 5) Auditoria depois do reparo.
CREATE TEMP TABLE tmp_juan_visible_after AS
SELECT l.id
FROM crm.leads l
JOIN crm.instance i
  ON i.aces_id = l.aces_id
 AND i.instancia = l.instancia
CROSS JOIN tmp_juan_context jc
WHERE l.aces_id = jc.aces_id
  AND l.owner_id = jc.crm_user_id
  AND i.created_by = jc.crm_user_id
  AND COALESCE(i.setup_status, 'connected') <> 'cancelled';

SELECT
  (SELECT COUNT(*) FROM tmp_juan_visible_before) AS visible_leads_before,
  (SELECT COUNT(*) FROM tmp_juan_visible_after) AS visible_leads_after,
  (SELECT COUNT(*) FROM tmp_juan_repaired_instances) AS repaired_instances,
  (SELECT COUNT(*) FROM tmp_juan_repaired_leads) AS repaired_leads;

SELECT *
FROM tmp_juan_repaired_instances
ORDER BY instancia;

SELECT
  id,
  name,
  contact_phone,
  instancia,
  repaired_to
FROM tmp_juan_repaired_leads
ORDER BY name NULLS LAST, id
LIMIT 50;
