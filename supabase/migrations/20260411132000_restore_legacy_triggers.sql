-- Restaura automations legados que nao estavam no schema versionado

-- 1. Alias legados para bootstrap de pipeline
CREATE OR REPLACE FUNCTION Crm.tr_fn_on_account_created()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM Crm.fn_create_default_pipeline_stages(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_accounts_insert_pipeline_stages ON Crm.accounts;
CREATE TRIGGER tr_accounts_insert_pipeline_stages
  AFTER INSERT ON Crm.accounts
  FOR EACH ROW EXECUTE FUNCTION Crm.tr_fn_on_account_created();

-- 2. Agendamento fecha lead e anota observacao
CREATE OR REPLACE FUNCTION Crm.proc_novo_agendamento_action()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE Crm.leads
  SET
    status = 'Fechado',
    notes = concat_ws(E'\n', NULLIF(notes, ''), 'Consulta agendada: ' || COALESCE(NEW.tipo, 'Sem tipo informado')),
    updated_at = now()
  WHERE id = NEW.lead_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ao_criar_agendamento ON Crm.agendamentos;
CREATE TRIGGER trg_ao_criar_agendamento
  AFTER INSERT ON Crm.agendamentos
  FOR EACH ROW EXECUTE FUNCTION Crm.proc_novo_agendamento_action();

-- 3. Follow-up preenche snapshot do lead
CREATE OR REPLACE FUNCTION Crm.fill_lead_data()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT name, contact_phone
  INTO NEW.lead_name, NEW.lead_phone
  FROM Crm.leads
  WHERE id = NEW.lead_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fill_lead_info ON Crm.follow_up_tasks;
CREATE TRIGGER fill_lead_info
  BEFORE INSERT ON Crm.follow_up_tasks
  FOR EACH ROW EXECUTE FUNCTION Crm.fill_lead_data();

-- 4. Lead remarketing maintenance
CREATE OR REPLACE FUNCTION public.update_remarketing_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS remarketing_updated_at ON Crm.lead_remarketing;
CREATE TRIGGER remarketing_updated_at
  BEFORE UPDATE ON Crm.lead_remarketing
  FOR EACH ROW EXECUTE FUNCTION public.update_remarketing_updated_at();

CREATE OR REPLACE FUNCTION Crm.set_next_message_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.last_message_sent_at IS NOT NULL THEN
    NEW.next_message_date := (NEW.last_message_sent_at + interval '1 day')::date;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_next_message_date ON Crm.lead_remarketing;
CREATE TRIGGER trg_set_next_message_date
  BEFORE INSERT OR UPDATE ON Crm.lead_remarketing
  FOR EACH ROW EXECUTE FUNCTION Crm.set_next_message_date();

-- 5. Lead tags snapshot
CREATE OR REPLACE FUNCTION Crm.fill_tag_name()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT name
  INTO NEW.tag_name
  FROM Crm.tags
  WHERE id = NEW.tag_id;

  IF NOT FOUND THEN
    NEW.tag_name := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_fill_tag_name ON Crm.lead_tags;
CREATE TRIGGER trigger_fill_tag_name
  BEFORE INSERT OR UPDATE OF tag_id ON Crm.lead_tags
  FOR EACH ROW EXECUTE FUNCTION Crm.fill_tag_name();

-- 6. Seguranca e sync de leads
CREATE OR REPLACE FUNCTION Crm.handle_new_lead_security()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_aces_id integer;
BEGIN
  SELECT id, aces_id
  INTO v_user_id, v_aces_id
  FROM Crm.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF NEW.aces_id IS NULL THEN
    NEW.aces_id := v_aces_id;
  END IF;

  IF NEW.owner_id IS NULL THEN
    NEW.owner_id := v_user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_set_aces_id_leads ON Crm.leads;
CREATE TRIGGER tr_set_aces_id_leads
  BEFORE INSERT ON Crm.leads
  FOR EACH ROW EXECUTE FUNCTION Crm.handle_new_lead_security();

CREATE OR REPLACE FUNCTION Crm.sync_status_and_stage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  found_stage_id uuid;
  found_stage_name text;
BEGIN
  IF (TG_OP = 'INSERT') OR ((NEW.status IS DISTINCT FROM OLD.status) AND (NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id)) THEN
    SELECT id
    INTO found_stage_id
    FROM Crm.pipeline_stages
    WHERE aces_id = NEW.aces_id
      AND lower(name) = lower(COALESCE(NEW.status::text, ''))
    LIMIT 1;

    IF found_stage_id IS NULL THEN
      IF lower(COALESCE(NEW.status::text, '')) IN ('ganho', 'fechado', 'sucesso', 'won', 'closed', 'vendido') THEN
        SELECT id
        INTO found_stage_id
        FROM Crm.pipeline_stages
        WHERE aces_id = NEW.aces_id
          AND category = 'Ganho'
        ORDER BY position ASC
        LIMIT 1;
      ELSIF lower(COALESCE(NEW.status::text, '')) IN ('perdido', 'lost', 'cancelado', 'descartado') THEN
        SELECT id
        INTO found_stage_id
        FROM Crm.pipeline_stages
        WHERE aces_id = NEW.aces_id
          AND category = 'Perdido'
        ORDER BY position ASC
        LIMIT 1;
      END IF;
    END IF;

    IF found_stage_id IS NULL THEN
      SELECT id
      INTO found_stage_id
      FROM Crm.pipeline_stages
      WHERE aces_id = NEW.aces_id
        AND category = 'Aberto'
      ORDER BY position ASC
      LIMIT 1;
    END IF;

    IF found_stage_id IS NOT NULL THEN
      NEW.stage_id := found_stage_id;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND (NEW.stage_id IS DISTINCT FROM OLD.stage_id) THEN
    SELECT name
    INTO found_stage_name
    FROM Crm.pipeline_stages
    WHERE id = NEW.stage_id
    LIMIT 1;

    IF found_stage_name IS NOT NULL THEN
      NEW.status := found_stage_name::varchar;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_status_stage ON Crm.leads;
CREATE TRIGGER trigger_sync_status_stage
  BEFORE INSERT OR UPDATE OF status, stage_id ON Crm.leads
  FOR EACH ROW EXECUTE FUNCTION Crm.sync_status_and_stage();

-- 7. Message history automations
CREATE OR REPLACE FUNCTION Crm.handle_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE Crm.leads
  SET last_message_at = COALESCE(NEW.sent_at, now())
  WHERE id = NEW.lead_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_message_created ON Crm.message_history;
CREATE TRIGGER on_message_created
  AFTER INSERT ON Crm.message_history
  FOR EACH ROW EXECUTE FUNCTION Crm.handle_new_message();

CREATE OR REPLACE FUNCTION Crm.auto_fill_aces_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.aces_id IS NULL OR NEW.aces_id = 0 THEN
    SELECT aces_id
    INTO NEW.aces_id
    FROM Crm.leads
    WHERE id = NEW.lead_id;

    IF NEW.aces_id IS NULL THEN
      RAISE EXCEPTION 'Lead % nao possui aces_id associado', NEW.lead_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_fill_aces_id ON Crm.message_history;
CREATE TRIGGER trigger_auto_fill_aces_id
  BEFORE INSERT ON Crm.message_history
  FOR EACH ROW EXECUTE FUNCTION Crm.auto_fill_aces_id();

CREATE OR REPLACE FUNCTION Crm.fn_atualizar_consumo_automatico()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_aces_id integer;
  v_caracteres integer;
  v_caracteres_limite bigint;
  v_novo_total bigint;
BEGIN
  v_aces_id := NEW.aces_id;

  IF v_aces_id IS NULL THEN
    SELECT aces_id
    INTO v_aces_id
    FROM Crm.leads
    WHERE id = NEW.lead_id
    LIMIT 1;
  END IF;

  IF v_aces_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_caracteres := COALESCE(char_length(NEW.content), 0);

  IF v_caracteres = 0 THEN
    RETURN NEW;
  END IF;

  UPDATE Crm.accounts a
  SET
    caracteres_consumidos = COALESCE(a.caracteres_consumidos, 0) + v_caracteres,
    updated_at = current_timestamp
  FROM Crm.planos p
  WHERE a.id = v_aces_id
    AND a.plano_id = p.id
  RETURNING a.caracteres_consumidos, p.caracteres_limite
  INTO v_novo_total, v_caracteres_limite;

  IF v_novo_total IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_caracteres_limite IS NOT NULL AND v_novo_total >= v_caracteres_limite THEN
    UPDATE Crm.accounts
    SET
      limite_estourado = TRUE,
      updated_at = current_timestamp
    WHERE id = v_aces_id
      AND limite_estourado = FALSE;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_atualizar_consumo ON Crm.message_history;
CREATE TRIGGER trg_atualizar_consumo
  AFTER INSERT ON Crm.message_history
  FOR EACH ROW EXECUTE FUNCTION Crm.fn_atualizar_consumo_automatico();

-- 8. Receituario sync
CREATE OR REPLACE FUNCTION Crm.set_receita_true()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE Crm.leads
  SET receita = true
  WHERE id = NEW.lead_id;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('Crm.receituarios') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_receituario_set_receita ON Crm.receituarios;
    CREATE TRIGGER trg_receituario_set_receita
      AFTER INSERT ON Crm.receituarios
      FOR EACH ROW EXECUTE FUNCTION Crm.set_receita_true();
  END IF;
END $$;

-- 9. Renomeia triggers ja existentes para os nomes legados
DROP TRIGGER IF EXISTS trg_auto_remarketing ON Crm.leads;
DROP TRIGGER IF EXISTS lead_remarketing_auto_add ON Crm.leads;
CREATE TRIGGER lead_remarketing_auto_add
  AFTER INSERT OR UPDATE ON Crm.leads
  FOR EACH ROW EXECUTE FUNCTION public.auto_add_to_remarketing();

DROP TRIGGER IF EXISTS trg_remove_remarketing ON Crm.leads;
DROP TRIGGER IF EXISTS lead_status_changed ON Crm.leads;
CREATE TRIGGER lead_status_changed
  AFTER UPDATE ON Crm.leads
  FOR EACH ROW EXECUTE FUNCTION public.remove_from_remarketing();

DROP TRIGGER IF EXISTS trg_sync_aces_to_jwt ON Crm.users;
DROP TRIGGER IF EXISTS on_auth_user_update ON Crm.users;
CREATE TRIGGER on_auth_user_update
  AFTER INSERT OR UPDATE OF aces_id ON Crm.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_aces_id_to_jwt();
