BEGIN;

CREATE TABLE IF NOT EXISTS crm.lead_owner_repair_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_batch_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  aces_id integer NOT NULL,
  instance_name text,
  previous_owner_id uuid,
  previous_owner_aces_id integer,
  replacement_owner_id uuid NOT NULL,
  replacement_owner_aces_id integer NOT NULL,
  resolution_source text NOT NULL
    CHECK (resolution_source IN ('instance_owner', 'account_admin')),
  repaired_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_owner_repair_audit_batch_lead_unique
    UNIQUE (repair_batch_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_owner_repair_audit_lead
  ON crm.lead_owner_repair_audit(lead_id, repaired_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_owner_repair_audit_batch
  ON crm.lead_owner_repair_audit(repair_batch_id);

ALTER TABLE crm.lead_owner_repair_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm.lead_owner_repair_audit
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT ON crm.lead_owner_repair_audit TO service_role;

COMMENT ON TABLE crm.lead_owner_repair_audit IS
  'Auditoria privada dos saneamentos de owner_id incompatível com a conta do lead.';

DO $repair_lead_owners$
DECLARE
  v_batch_id uuid := gen_random_uuid();
  v_invalid_count integer := 0;
  v_audit_count integer := 0;
  v_updated_count integer := 0;
BEGIN
  SELECT count(*)::integer
  INTO v_invalid_count
  FROM crm.leads AS lead
  LEFT JOIN crm.users AS current_owner
    ON current_owner.id = lead.owner_id
  WHERE lead.view IS TRUE
    AND lead.owner_id IS NOT NULL
    AND (
      current_owner.id IS NULL
      OR current_owner.aces_id IS DISTINCT FROM lead.aces_id
    );

  IF EXISTS (
    SELECT 1
    FROM crm.leads AS lead
    LEFT JOIN crm.users AS current_owner
      ON current_owner.id = lead.owner_id
    LEFT JOIN crm.instance AS instance
      ON instance.aces_id = lead.aces_id
     AND instance.instancia = lead.instancia
    LEFT JOIN crm.users AS instance_owner
      ON instance_owner.id = instance.created_by
     AND instance_owner.aces_id = lead.aces_id
     AND instance_owner.role <> 'NENHUM'::crm.user_role
    LEFT JOIN LATERAL (
      SELECT account_admin.id
      FROM crm.users AS account_admin
      WHERE account_admin.aces_id = lead.aces_id
        AND account_admin.role = 'ADMIN'::crm.user_role
      ORDER BY account_admin.created_at ASC, account_admin.id ASC
      LIMIT 1
    ) AS fallback_admin ON TRUE
    WHERE lead.view IS TRUE
      AND lead.owner_id IS NOT NULL
      AND (
        current_owner.id IS NULL
        OR current_owner.aces_id IS DISTINCT FROM lead.aces_id
      )
      AND COALESCE(instance_owner.id, fallback_admin.id) IS NULL
  ) THEN
    RAISE EXCEPTION
      'Backfill de responsáveis abortado: existe lead ativo sem proprietário de instância ou administrador válido';
  END IF;

  INSERT INTO crm.lead_owner_repair_audit (
    repair_batch_id,
    lead_id,
    aces_id,
    instance_name,
    previous_owner_id,
    previous_owner_aces_id,
    replacement_owner_id,
    replacement_owner_aces_id,
    resolution_source
  )
  SELECT
    v_batch_id,
    lead.id,
    lead.aces_id,
    lead.instancia,
    lead.owner_id,
    current_owner.aces_id,
    COALESCE(instance_owner.id, fallback_admin.id),
    lead.aces_id,
    CASE
      WHEN instance_owner.id IS NOT NULL THEN 'instance_owner'
      ELSE 'account_admin'
    END
  FROM crm.leads AS lead
  LEFT JOIN crm.users AS current_owner
    ON current_owner.id = lead.owner_id
  LEFT JOIN crm.instance AS instance
    ON instance.aces_id = lead.aces_id
   AND instance.instancia = lead.instancia
  LEFT JOIN crm.users AS instance_owner
    ON instance_owner.id = instance.created_by
   AND instance_owner.aces_id = lead.aces_id
   AND instance_owner.role <> 'NENHUM'::crm.user_role
  LEFT JOIN LATERAL (
    SELECT account_admin.id
    FROM crm.users AS account_admin
    WHERE account_admin.aces_id = lead.aces_id
      AND account_admin.role = 'ADMIN'::crm.user_role
    ORDER BY account_admin.created_at ASC, account_admin.id ASC
    LIMIT 1
  ) AS fallback_admin ON TRUE
  WHERE lead.view IS TRUE
    AND lead.owner_id IS NOT NULL
    AND (
      current_owner.id IS NULL
      OR current_owner.aces_id IS DISTINCT FROM lead.aces_id
    );
  GET DIAGNOSTICS v_audit_count = ROW_COUNT;

  IF v_audit_count <> v_invalid_count THEN
    RAISE EXCEPTION
      'Backfill de responsáveis abortado: auditoria (%) difere dos candidatos (%)',
      v_audit_count,
      v_invalid_count;
  END IF;

  UPDATE crm.leads AS lead
  SET
    owner_id = audit.replacement_owner_id,
    updated_at = now()
  FROM crm.lead_owner_repair_audit AS audit
  WHERE audit.repair_batch_id = v_batch_id
    AND audit.lead_id = lead.id;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count <> v_audit_count THEN
    RAISE EXCEPTION
      'Backfill de responsáveis abortado: atualizados (%) diferem da auditoria (%)',
      v_updated_count,
      v_audit_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM crm.leads AS lead
    LEFT JOIN crm.users AS owner_user
      ON owner_user.id = lead.owner_id
    WHERE lead.view IS TRUE
      AND lead.owner_id IS NOT NULL
      AND (
        owner_user.id IS NULL
        OR owner_user.aces_id IS DISTINCT FROM lead.aces_id
      )
  ) THEN
    RAISE EXCEPTION
      'Backfill de responsáveis abortado: ainda existem leads ativos com responsável incompatível';
  END IF;
END
$repair_lead_owners$;

ALTER TABLE crm.leads
  DROP CONSTRAINT IF EXISTS leads_owner_id_fkey;

ALTER TABLE crm.leads
  ADD CONSTRAINT leads_owner_id_fkey
  FOREIGN KEY (owner_id)
  REFERENCES crm.users(id)
  ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.sync_lead_stage_and_aces()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_current_aces_id integer;
  v_current_user_id uuid;
  v_owner_aces_id integer;
  v_stage record;
  v_should_validate_owner boolean;
BEGIN
  SELECT id, aces_id
  INTO v_current_user_id, v_current_aces_id
  FROM crm.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF TG_OP = 'INSERT'
    AND NEW.owner_id IS NULL
    AND v_current_user_id IS NOT NULL
    AND (NEW.aces_id IS NULL OR NEW.aces_id = v_current_aces_id) THEN
    NEW.owner_id := v_current_user_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_should_validate_owner := NEW.owner_id IS NOT NULL;
  ELSE
    v_should_validate_owner := NEW.owner_id IS NOT NULL AND (
      NEW.owner_id IS DISTINCT FROM OLD.owner_id
      OR NEW.aces_id IS DISTINCT FROM OLD.aces_id
    );
  END IF;

  IF v_should_validate_owner THEN
    SELECT aces_id
    INTO v_owner_aces_id
    FROM crm.users
    WHERE id = NEW.owner_id
    LIMIT 1;

    IF v_owner_aces_id IS NULL THEN
      RAISE EXCEPTION 'Responsavel do lead nao encontrado';
    END IF;

    IF NEW.aces_id IS NULL THEN
      NEW.aces_id := v_owner_aces_id;
    ELSIF NEW.aces_id <> v_owner_aces_id THEN
      RAISE EXCEPTION 'Responsavel do lead pertence a outra conta';
    END IF;
  END IF;

  IF NEW.aces_id IS NULL THEN
    NEW.aces_id := v_current_aces_id;
  END IF;

  IF NEW.stage_id IS NOT NULL THEN
    SELECT id, aces_id, name, category
    INTO v_stage
    FROM crm.pipeline_stages
    WHERE id = NEW.stage_id
    LIMIT 1;

    IF FOUND THEN
      IF NEW.aces_id IS NOT NULL AND v_stage.aces_id <> NEW.aces_id THEN
        RAISE EXCEPTION 'Etapa pertence a outra conta';
      END IF;

      NEW.aces_id := COALESCE(NEW.aces_id, v_stage.aces_id);
      NEW.status := CASE
        WHEN v_stage.category = 'Ganho' THEN 'Fechado'
        WHEN v_stage.category = 'Perdido' THEN 'Perdido'
        ELSE v_stage.name
      END;
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.aces_id IS NOT NULL THEN
    SELECT id, aces_id, name, category
    INTO v_stage
    FROM crm.pipeline_stages
    WHERE aces_id = NEW.aces_id
      AND (
        (lower(COALESCE(NEW.status, '')) IN ('fechado', 'ganho', 'sucesso', 'vendido') AND category = 'Ganho')
        OR (lower(COALESCE(NEW.status, '')) IN ('perdido', 'cancelado', 'cancelada') AND category = 'Perdido')
        OR (category = 'Aberto' AND lower(name) = lower(COALESCE(NEW.status, '')))
      )
    ORDER BY position
    LIMIT 1;

    IF FOUND THEN
      NEW.stage_id := v_stage.id;
      NEW.status := CASE
        WHEN v_stage.category = 'Ganho' THEN 'Fechado'
        WHEN v_stage.category = 'Perdido' THEN 'Perdido'
        ELSE v_stage.name
      END;
      RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' AND NEW.stage_id IS NULL THEN
      SELECT id, aces_id, name, category
      INTO v_stage
      FROM crm.pipeline_stages
      WHERE aces_id = NEW.aces_id
        AND category = 'Aberto'
      ORDER BY position
      LIMIT 1;

      IF FOUND THEN
        NEW.stage_id := v_stage.id;
        NEW.status := v_stage.name;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.sync_lead_stage_and_aces() IS
  'Mantém conta e etapa coerentes; owner_id é atribuição operacional validada apenas quando criado ou alterado.';

COMMIT;
