-- Remove the two obsolete billing systems without breaking message ingestion,
-- auth signup or profile edits.

BEGIN;

DROP TRIGGER IF EXISTS trg_atualizar_consumo ON crm.message_history;
DROP FUNCTION IF EXISTS crm.fn_atualizar_consumo_automatico();

DROP TRIGGER IF EXISTS trg_new_auth_user_profile ON auth.users;
DROP TRIGGER IF EXISTS trg_normalize_profile ON public.user_profiles;

DROP FUNCTION IF EXISTS public.billing_record_usage(
  uuid, text, text, integer, integer, uuid, uuid, jsonb, timestamptz
);
DROP FUNCTION IF EXISTS public.billing_get_my_usage_summary();
DROP FUNCTION IF EXISTS public.billing_get_usage_snapshot(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.billing_cycle_bounds(timestamptz, integer, text);

CREATE OR REPLACE FUNCTION public.handle_new_auth_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.user_profiles (
    user_id,
    display_name,
    billing_anchor_day,
    billing_timezone
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    EXTRACT(DAY FROM timezone('America/Sao_Paulo', now()))::smallint,
    'America/Sao_Paulo'
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_user_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.username IS NOT NULL THEN
    NEW.username := lower(trim(NEW.username));
    IF NEW.username = '' THEN NEW.username := NULL; END IF;
  END IF;

  IF NEW.display_name IS NOT NULL THEN
    NEW.display_name := trim(NEW.display_name);
    IF NEW.display_name = '' THEN NEW.display_name := NULL; END IF;
  END IF;

  IF NEW.billing_timezone IS NULL OR trim(NEW.billing_timezone) = '' THEN
    NEW.billing_timezone := 'America/Sao_Paulo';
  END IF;

  IF NEW.billing_anchor_day IS NULL THEN
    NEW.billing_anchor_day := EXTRACT(DAY FROM timezone('America/Sao_Paulo', now()))::smallint;
  ELSE
    NEW.billing_anchor_day := LEAST(31, GREATEST(1, NEW.billing_anchor_day));
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_new_auth_user_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user_profile();

CREATE TRIGGER trg_normalize_profile
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.normalize_user_profile_fields();

ALTER TABLE public.user_profiles DROP COLUMN IF EXISTS plan_id;
ALTER TABLE crm.accounts
  DROP COLUMN IF EXISTS plano_id,
  DROP COLUMN IF EXISTS caracteres_consumidos,
  DROP COLUMN IF EXISTS limite_estourado,
  DROP COLUMN IF EXISTS mes_referencia,
  DROP COLUMN IF EXISTS ultimo_reset;

DROP TABLE IF EXISTS crm.consumo_historico;
DROP TABLE IF EXISTS crm.planos;
DROP TABLE IF EXISTS public.billing_usage_events;
DROP TABLE IF EXISTS public.billing_usage_cycles;
DROP TABLE IF EXISTS public.billing_plans;
DROP TABLE IF EXISTS public.token_usage;
DROP TABLE IF EXISTS public.llm_model_pricing;
DROP TABLE IF EXISTS public.llm_settings;

DROP SEQUENCE IF EXISTS crm.consumo_historico_id_seq;
DROP SEQUENCE IF EXISTS crm.planos_id_seq;

COMMIT;
