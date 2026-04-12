-- =============================================================================
-- Crm ARQUEM — MIGRATION COMPLETA
-- Versão: 2026-04-10
-- Descrição: Schema completo do banco de dados (Crm + public)
--            Inclui: tipos, tabelas, sequences, funções, triggers e RLS
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. EXTENSÕES
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. SCHEMAS
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS Crm;

-- ---------------------------------------------------------------------------
-- 2. TIPOS ENUM
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'user_role' AND n.nspname = 'Crm') THEN
    CREATE TYPE Crm.user_role AS ENUM ('ADMIN', 'VENDEDOR', 'NENHUM');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'lead_status' AND n.nspname = 'Crm') THEN
    CREATE TYPE Crm.lead_status AS ENUM (
      'Novo', 'Atendimento', 'Orçamento', 'Fechado', 'Perdido', 'Remarketing'
    );
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 3. SEQUENCES
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS Crm.accounts_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS Crm.planos_id_seq   START 1;
CREATE SEQUENCE IF NOT EXISTS Crm.lead_number_seq  START 1;
CREATE SEQUENCE IF NOT EXISTS Crm.users_arquem_aces_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS Crm.consumo_historico_id_seq START 1;

-- ---------------------------------------------------------------------------
-- 4. TABELAS — SCHEMA Crm
-- ---------------------------------------------------------------------------

-- 4.1 Crm.planos
CREATE TABLE IF NOT EXISTS Crm.planos (
  id                INTEGER PRIMARY KEY DEFAULT nextval('Crm.planos_id_seq'),
  nome              VARCHAR(100) UNIQUE NOT NULL,
  conversas_limite  INTEGER NOT NULL,
  msgs_estimadas    INTEGER NOT NULL,
  caracteres_limite BIGINT  NOT NULL,
  custo_estimado    NUMERIC,
  preco_venda       NUMERIC,
  margem_percentual NUMERIC,
  ativo             BOOLEAN DEFAULT true,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON COLUMN Crm.planos.custo_estimado IS 'Quanto você GASTA na API (baseado em R$ 0,000306/char)';
COMMENT ON COLUMN Crm.planos.preco_venda IS 'Quanto você COBRA do cliente';
COMMENT ON COLUMN Crm.planos.margem_percentual IS 'Margem de lucro em %';

-- 4.2 Crm.accounts
CREATE TABLE IF NOT EXISTS Crm.accounts (
  id                   INTEGER PRIMARY KEY DEFAULT nextval('Crm.accounts_id_seq'),
  name                 TEXT    NOT NULL,
  status               TEXT    DEFAULT 'active',
  plano_id             INTEGER REFERENCES Crm.planos(id),
  caracteres_consumidos BIGINT  DEFAULT 0,
  limite_estourado     BOOLEAN DEFAULT false,
  mes_referencia       DATE    DEFAULT date_trunc('month', CURRENT_DATE::timestamptz),
  ultimo_reset         DATE    DEFAULT CURRENT_DATE,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
);

-- 4.3 Crm.users_arquem  (multi-tenancy master)
CREATE TABLE IF NOT EXISTS Crm.users_arquem (
  aces_id            BIGINT PRIMARY KEY DEFAULT nextval('Crm.users_arquem_aces_id_seq'),
  nome               VARCHAR(200) NOT NULL,
  cnpj               VARCHAR(20),
  responsavel_nome   VARCHAR(200),
  responsavel_email  VARCHAR(200),
  responsavel_telefone VARCHAR(30),
  plano              VARCHAR(50)  DEFAULT 'basic',
  onboarding_status  VARCHAR(50)  DEFAULT 'pendente',
  config             JSONB        DEFAULT '{}',
  notas              TEXT,
  tags               TEXT[],
  status             BOOLEAN      DEFAULT true,
  criado_em          TIMESTAMPTZ  DEFAULT now(),
  atualizado_em      TIMESTAMPTZ  DEFAULT now()
);

-- 4.4 Crm.instance
CREATE TABLE IF NOT EXISTS Crm.instance (
  instancia   TEXT PRIMARY KEY,
  aces_id     INTEGER NOT NULL REFERENCES Crm.accounts(id),
  color       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE Crm.instance IS 'Nome das instâncias WhatsApp e a quem elas pertencem';

-- 4.5 Crm.users
CREATE TABLE IF NOT EXISTS Crm.users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id),
  email        TEXT,
  name         TEXT,
  role         Crm.user_role DEFAULT 'NENHUM',
  aces_id      INTEGER REFERENCES Crm.accounts(id),
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- 4.6 Crm.pipeline_stages
CREATE TABLE IF NOT EXISTS Crm.pipeline_stages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id    INTEGER REFERENCES Crm.accounts(id),
  name       TEXT    NOT NULL,
  color      TEXT    DEFAULT '#94a3b8',
  position   INTEGER DEFAULT 0,
  category   VARCHAR(10) DEFAULT 'Aberto'
               CHECK (category IN ('Aberto','Ganho','Perdido')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4.7 Crm.tags
CREATE TABLE IF NOT EXISTS Crm.tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id    INTEGER REFERENCES Crm.accounts(id),
  name       TEXT    NOT NULL,
  urgencia   INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4.8 Crm.leads
CREATE TABLE IF NOT EXISTS Crm.leads (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id               INTEGER REFERENCES Crm.accounts(id),
  name                  VARCHAR(200) NOT NULL,
  contact_phone         VARCHAR(50)  NOT NULL,
  email                 TEXT,
  status                VARCHAR(50)  DEFAULT 'Novo',
  stage_id              UUID REFERENCES Crm.pipeline_stages(id),
  instancia             VARCHAR(100) REFERENCES Crm.instance(instancia),
  owner_id              UUID REFERENCES Crm.users(id),
  lead_number           BIGINT DEFAULT nextval('Crm.lead_number_seq'),
  "Fonte"               TEXT,
  "Plataform"           TEXT,
  "Sistema"             TEXT,
  "lojas"               TEXT,
  "CNPJ"                NUMERIC,
  "Avaliacao"           TEXT,
  "Voucher"             BOOLEAN DEFAULT false,
  receita               BOOLEAN DEFAULT false,
  cliente               BOOLEAN,
  view                  BOOLEAN DEFAULT true,
  tipo                  TEXT,
  como_quer_ser_percebido TEXT,
  qual_imagem_passar    TEXT,
  notes                 TEXT,
  last_city             VARCHAR(100),
  last_region           VARCHAR(100),
  last_country          VARCHAR(100),
  last_message_at       TIMESTAMPTZ,
  "check"               TIMESTAMP,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);
COMMENT ON COLUMN Crm.leads.aces_id IS 'Id da empresa que está usando';
COMMENT ON COLUMN Crm.leads.tipo    IS 'Classifica o tipo do lead (ótica, clinica, Arquem ou MedPrev)';

-- 4.9 Crm.lead_tags
CREATE TABLE IF NOT EXISTS Crm.lead_tags (
  lead_id    UUID REFERENCES Crm.leads(id) ON DELETE CASCADE,
  tag_id     UUID REFERENCES Crm.tags(id)  ON DELETE CASCADE,
  tag_name   TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (lead_id, tag_id)
);

-- 4.10 Crm.message_history
CREATE TABLE IF NOT EXISTS Crm.message_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES Crm.leads(id),
  aces_id         INTEGER REFERENCES Crm.accounts(id),
  content         TEXT NOT NULL,
  direction       VARCHAR(10) NOT NULL,  -- 'in' | 'out'
  conversation_id VARCHAR(100),
  instance        TEXT DEFAULT 'Scael' REFERENCES Crm.instance(instancia),
  created_by      UUID REFERENCES Crm.users(id),
  sent_at         TIMESTAMPTZ DEFAULT now()
);

-- 4.11 Crm.opportunities
CREATE TABLE IF NOT EXISTS Crm.opportunities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID REFERENCES Crm.leads(id),
  aces_id         INTEGER DEFAULT 1 REFERENCES Crm.accounts(id),
  status          Crm.lead_status DEFAULT 'Novo',
  value           NUMERIC,
  connection_level VARCHAR(10),
  responsible_id  UUID REFERENCES Crm.users(id),
  new_message     BOOLEAN,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- 4.12 Crm.follow_up_tasks
CREATE TABLE IF NOT EXISTS Crm.follow_up_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES Crm.leads(id),
  opportunity_id  UUID REFERENCES Crm.opportunities(id),
  aces_id         INTEGER DEFAULT 1 REFERENCES Crm.accounts(id),
  due_at          TIMESTAMPTZ NOT NULL,
  completed       BOOLEAN DEFAULT false,
  completed_at    TIMESTAMPTZ,
  notes           TEXT,
  lead_name       TEXT,
  lead_phone      TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 4.13 Crm.agendamentos
CREATE TABLE IF NOT EXISTS Crm.agendamentos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          UUID NOT NULL REFERENCES Crm.leads(id),
  aces_id          INTEGER REFERENCES Crm.accounts(id),
  lead_name        TEXT,
  lead_phone       TEXT,
  email            TEXT,
  tipo             TEXT,
  data_agendamento TIMESTAMP,
  retorno_3d       TIMESTAMP GENERATED ALWAYS AS (data_agendamento - INTERVAL '3 days') STORED,
  retorno_2d       TIMESTAMP GENERATED ALWAYS AS (data_agendamento - INTERVAL '2 days') STORED,
  retorno_1d       TIMESTAMP GENERATED ALWAYS AS (data_agendamento - INTERVAL '1 day')  STORED,
  retorno_1h       TIMESTAMP GENERATED ALWAYS AS (data_agendamento - INTERVAL '1 hour') STORED,
  compleat_3d      BOOLEAN DEFAULT false,
  compleat_2d      BOOLEAN DEFAULT false,
  compleat_1d      BOOLEAN DEFAULT false,
  compleat_1h      BOOLEAN DEFAULT false,
  created_at       TIMESTAMP DEFAULT now()
);

-- 4.14 Crm.receituarios
CREATE TABLE IF NOT EXISTS Crm.receituarios (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          UUID NOT NULL REFERENCES Crm.leads(id),
  aces_id          INTEGER REFERENCES Crm.accounts(id),
  data_receita     DATE,
  tipo_lente       TEXT,
  od_longe         TEXT,
  oe_longe         TEXT,
  od_perto         TEXT,
  oe_perto         TEXT,
  "Adição"         TEXT,
  receita_vale_ate DATE,
  observacoes      TEXT,
  metadados        JSONB,
  criado_em        TIMESTAMP DEFAULT now()
);

-- 4.15 Crm.lead_remarketing
CREATE TABLE IF NOT EXISTS Crm.lead_remarketing (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id              UUID UNIQUE NOT NULL REFERENCES Crm.leads(id),
  aces_id              INTEGER NOT NULL,
  contact_phone        TEXT,
  name                 TEXT,
  status               TEXT DEFAULT 'active',
  current_step         INTEGER DEFAULT 0,
  next_message_date    DATE NOT NULL,
  last_message_sent_at TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

-- 4.16 Crm.user_invitations
CREATE TABLE IF NOT EXISTS Crm.user_invitations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT NOT NULL,
  name               TEXT,
  role               Crm.user_role DEFAULT 'NENHUM',
  invited_by_user_id UUID NOT NULL REFERENCES Crm.users(id),
  aces_id            INTEGER NOT NULL,
  status             TEXT DEFAULT 'pending'
                       CHECK (status IN ('pending','accepted','expired','cancelled')),
  invited_at         TIMESTAMPTZ DEFAULT now(),
  expires_at         TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days'),
  accepted_at        TIMESTAMPTZ
);
COMMENT ON TABLE Crm.user_invitations IS 'Rastreia convites enviados para novos usuários';

-- 4.17 Crm.consumo_historico
CREATE TABLE IF NOT EXISTS Crm.consumo_historico (
  id                  INTEGER PRIMARY KEY DEFAULT nextval('Crm.consumo_historico_id_seq'),
  aces_id             INTEGER NOT NULL REFERENCES Crm.accounts(id),
  ano_mes             DATE NOT NULL,
  plano_id            INTEGER REFERENCES Crm.planos(id),
  plano_nome          VARCHAR(100),
  total_caracteres    BIGINT DEFAULT 0,
  caracteres_limite   BIGINT,
  percentual_consumo  NUMERIC,
  estourou_limite     BOOLEAN DEFAULT false,
  custo_real          NUMERIC,
  mensalidade_cobrada NUMERIC,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE Crm.consumo_historico IS 'Histórico mensal de consumo por empresa';

-- ---------------------------------------------------------------------------
-- 5. TABELAS — SCHEMA PUBLIC
-- ---------------------------------------------------------------------------

-- 5.1 public.billing_plans
CREATE TABLE IF NOT EXISTS public.billing_plans (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 TEXT UNIQUE NOT NULL,
  name                 TEXT NOT NULL,
  monthly_token_limit  BIGINT NOT NULL CHECK (monthly_token_limit > 0),
  monthly_credit_limit BIGINT NOT NULL CHECK (monthly_credit_limit > 0),
  is_active            BOOLEAN DEFAULT true,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

-- 5.2 public.user_profiles
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id          UUID PRIMARY KEY REFERENCES auth.users(id),
  aces_id          INTEGER REFERENCES Crm.accounts(id),
  display_name     TEXT,
  username         TEXT CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,30}$'),
  avatar_path      TEXT,
  avatar_url       TEXT,
  plan_id          UUID REFERENCES public.billing_plans(id),
  billing_anchor_day SMALLINT DEFAULT 1
                     CHECK (billing_anchor_day >= 1 AND billing_anchor_day <= 31),
  billing_timezone TEXT DEFAULT 'America/Sao_Paulo',
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- 5.3 public.llm_model_pricing
CREATE TABLE IF NOT EXISTS public.llm_model_pricing (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                  TEXT NOT NULL,
  model                     TEXT NOT NULL,
  input_usd_per_1m_tokens   NUMERIC NOT NULL CHECK (input_usd_per_1m_tokens >= 0),
  output_usd_per_1m_tokens  NUMERIC NOT NULL CHECK (output_usd_per_1m_tokens >= 0),
  is_active                 BOOLEAN DEFAULT true,
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now()
);

-- 5.4 public.llm_settings
CREATE TABLE IF NOT EXISTS public.llm_settings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id),
  provider   TEXT NOT NULL CHECK (provider IN ('openai','google','gemini')),
  model      TEXT NOT NULL,
  api_key    TEXT NOT NULL,
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5.5 public.agents
CREATE TABLE IF NOT EXISTS public.agents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  name          TEXT NOT NULL,
  description   TEXT DEFAULT '',
  system_prompt TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- 5.6 public.agent_tables
CREATE TABLE IF NOT EXISTS public.agent_tables (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES public.agents(id),
  schema_name TEXT NOT NULL CHECK (schema_name = 'public'),
  table_name  TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 5.7 public.conversations
CREATE TABLE IF NOT EXISTS public.conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  agent_id   UUID REFERENCES public.agents(id),
  title      TEXT NOT NULL DEFAULT 'Nova Conversa',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5.8 public.messages
CREATE TABLE IF NOT EXISTS public.messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id),
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 5.9 public.billing_usage_events
CREATE TABLE IF NOT EXISTS public.billing_usage_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  aces_id         BIGINT NOT NULL,
  conversation_id UUID REFERENCES public.conversations(id),
  interaction_id  UUID NOT NULL,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens   INTEGER NOT NULL CHECK (output_tokens >= 0),
  total_tokens    INTEGER NOT NULL CHECK (total_tokens >= 0),
  credits_used    NUMERIC NOT NULL CHECK (credits_used >= 0),
  usd_cost        NUMERIC NOT NULL CHECK (usd_cost >= 0),
  cycle_start_at  TIMESTAMPTZ NOT NULL,
  cycle_end_at    TIMESTAMPTZ NOT NULL,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 5.10 public.billing_usage_cycles
CREATE TABLE IF NOT EXISTS public.billing_usage_cycles (
  user_id        UUID NOT NULL REFERENCES auth.users(id),
  cycle_start_at TIMESTAMPTZ NOT NULL,
  cycle_end_at   TIMESTAMPTZ NOT NULL,
  aces_id        BIGINT NOT NULL,
  tokens_used    BIGINT  DEFAULT 0 CHECK (tokens_used >= 0),
  credits_used   NUMERIC DEFAULT 0 CHECK (credits_used >= 0),
  usd_spent      NUMERIC DEFAULT 0 CHECK (usd_spent >= 0),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, cycle_start_at)
);

-- 5.11 public.database_metadata_cache
CREATE TABLE IF NOT EXISTS public.database_metadata_cache (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_name  TEXT NOT NULL CHECK (schema_name = 'public'),
  table_name   TEXT NOT NULL,
  column_name  TEXT NOT NULL,
  data_type    TEXT NOT NULL,
  is_nullable  BOOLEAN DEFAULT true,
  column_default TEXT,
  cached_at    TIMESTAMPTZ DEFAULT now()
);

-- 5.12 public.frontend_error_logs
CREATE TABLE IF NOT EXISTS public.frontend_error_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  conversation_id UUID REFERENCES public.conversations(id),
  category        TEXT NOT NULL,
  stage           TEXT,
  code            TEXT,
  message         TEXT NOT NULL,
  pathname        TEXT,
  user_agent      TEXT,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 5.13 public.token_usage  (dados ERP / n8n)
CREATE TABLE IF NOT EXISTS public.token_usage (
  id                   SERIAL PRIMARY KEY,
  aces_id              BIGINT REFERENCES Crm.users_arquem(aces_id),
  execution_id         VARCHAR UNIQUE,
  workflow_id          VARCHAR,
  workflow_name        VARCHAR,
  timestamp            TIMESTAMP,
  model_node           VARCHAR,
  executions_with_tokens INTEGER,
  models_used          TEXT,
  input_tokens         INTEGER,
  output_tokens        INTEGER,
  total_tokens         INTEGER,
  input_cost_brl       NUMERIC,
  output_cost_brl      NUMERIC,
  total_cost_brl       NUMERIC,
  analysis_cost_brl    NUMERIC,
  image_edit_cost_brl  NUMERIC,
  total_cost_image_brl NUMERIC,
  tipo                 TEXT,
  cliente              TEXT,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 6. ÍNDICES ESSENCIAIS
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_leads_aces_id      ON Crm.leads(aces_id);
CREATE INDEX IF NOT EXISTS idx_leads_stage_id     ON Crm.leads(stage_id);
CREATE INDEX IF NOT EXISTS idx_leads_status       ON Crm.leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_phone        ON Crm.leads(contact_phone);
CREATE INDEX IF NOT EXISTS idx_leads_instancia    ON Crm.leads(instancia);
CREATE INDEX IF NOT EXISTS idx_leads_created_at   ON Crm.leads(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_lead      ON Crm.message_history(lead_id);
CREATE INDEX IF NOT EXISTS idx_messages_aces      ON Crm.message_history(aces_id);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at   ON Crm.message_history(sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_tags_lead     ON Crm.lead_tags(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_tags_tag      ON Crm.lead_tags(tag_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_aces      ON Crm.pipeline_stages(aces_id, position);

CREATE INDEX IF NOT EXISTS idx_conv_user          ON public.conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_msg_conv           ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_billing_user_cycle ON public.billing_usage_cycles(user_id, cycle_start_at);
CREATE INDEX IF NOT EXISTS idx_billing_events_user ON public.billing_usage_events(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 7. FUNÇÕES UTILITÁRIAS
-- ---------------------------------------------------------------------------

-- 7.1 Atualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 7.2 Sincroniza aces_id para o JWT do usuário auth
CREATE OR REPLACE FUNCTION public.sync_aces_id_to_jwt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data =
    COALESCE(raw_app_meta_data, '{}'::jsonb) ||
    jsonb_build_object('aces_id', NEW.aces_id)
  WHERE id = NEW.auth_user_id;
  RETURN NEW;
END;
$$;

-- 7.3 Cria perfil público quando novo auth.user é criado
CREATE OR REPLACE FUNCTION public.handle_new_auth_user_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  default_plan_id uuid;
BEGIN
  SELECT id INTO default_plan_id FROM public.billing_plans
  WHERE code = 'test_1m' ORDER BY created_at ASC LIMIT 1;

  IF default_plan_id IS NULL THEN
    SELECT id INTO default_plan_id FROM public.billing_plans
    WHERE is_active = true ORDER BY created_at ASC LIMIT 1;
  END IF;

  INSERT INTO public.user_profiles (user_id, display_name, plan_id, billing_anchor_day, billing_timezone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    default_plan_id,
    EXTRACT(DAY FROM timezone('America/Sao_Paulo', now()))::smallint,
    'America/Sao_Paulo'
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 7.4 Normaliza campos de perfil antes de salvar
CREATE OR REPLACE FUNCTION public.normalize_user_profile_fields()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE default_plan_id uuid;
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
  IF NEW.plan_id IS NULL THEN
    SELECT id INTO default_plan_id FROM public.billing_plans
    WHERE code = 'test_1m' ORDER BY created_at ASC LIMIT 1;
    IF default_plan_id IS NULL THEN
      SELECT id INTO default_plan_id FROM public.billing_plans
      WHERE is_active = true ORDER BY created_at ASC LIMIT 1;
    END IF;
    NEW.plan_id := default_plan_id;
  END IF;
  RETURN NEW;
END;
$$;

-- 7.5 Auto-remarketing: insere na fila quando lead→Remarketing
CREATE OR REPLACE FUNCTION public.auto_add_to_remarketing()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'Remarketing' AND NOT EXISTS (
    SELECT 1 FROM Crm.lead_remarketing WHERE lead_id = NEW.id AND status = 'active'
  ) THEN
    INSERT INTO Crm.lead_remarketing
      (lead_id, aces_id, next_message_date, last_message_sent_at, contact_phone, name)
    VALUES (
      NEW.id, NEW.aces_id,
      (NEW.last_message_at::date + INTERVAL '1 day')::date,
      NEW.last_message_at, NEW.contact_phone, NEW.name
    )
    ON CONFLICT (lead_id) DO UPDATE SET
      status = 'active', current_step = 0,
      next_message_date = (NEW.last_message_at::date + INTERVAL '1 day')::date,
      last_message_sent_at = NEW.last_message_at,
      contact_phone = NEW.contact_phone, name = NEW.name, updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- 7.6 Remove do remarketing quando status muda
CREATE OR REPLACE FUNCTION public.remove_from_remarketing()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'Remarketing' AND NEW.status != 'Remarketing' THEN
    UPDATE Crm.lead_remarketing
    SET status = 'cancelled', updated_at = NOW()
    WHERE lead_id = NEW.id AND status = 'active';
  END IF;
  RETURN NEW;
END;
$$;

-- 7.7 Executa query SELECT segura (somente schema public)
CREATE OR REPLACE FUNCTION public.app_execute_safe_query(query_text TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  result       json;
  upper_query  text;
  schema_ref   text;
BEGIN
  query_text  := trim(query_text);
  upper_query := upper(query_text);
  IF query_text = '' THEN RAISE EXCEPTION 'A query nao pode ser vazia.'; END IF;
  IF position(';' in query_text) > 0 THEN RAISE EXCEPTION 'Nao use ponto e virgula (;).'; END IF;
  IF upper_query NOT LIKE 'SELECT%' AND upper_query NOT LIKE 'WITH%' THEN
    RAISE EXCEPTION 'Apenas SELECT e permitido.';
  END IF;
  IF upper_query ~ '\m(INSERT|DELETE|UPDATE|DROP|TRUNCATE|ALTER|GRANT|REVOKE|EXEC|EXECUTE|CREATE|COPY|VACUUM|ANALYZE)\M' THEN
    RAISE EXCEPTION 'Operacao nao permitida.';
  END IF;
  FOR schema_ref IN
    SELECT lower((m)[1])
    FROM regexp_matches(query_text, '(?i)\m(?:from|join)\s+(?:only\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\.', 'g') AS m
  LOOP
    IF schema_ref <> 'public' THEN
      RAISE EXCEPTION 'Schema "%" nao permitido. Use apenas o schema public.', schema_ref;
    END IF;
  END LOOP;
  EXECUTE format('SELECT json_agg(t) FROM (%s) t', query_text) INTO result;
  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- 7.8 Retorna metadados do banco (schema public)
CREATE OR REPLACE FUNCTION public.app_get_database_metadata()
RETURNS TABLE(schema_name text, table_name text, column_name text,
              data_type text, is_nullable boolean, column_default text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT c.table_schema::text, c.table_name::text, c.column_name::text,
         c.data_type::text, (c.is_nullable = 'YES'), c.column_default::text
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
  ORDER BY c.table_name, c.ordinal_position;
$$;

-- 7.9 Ciclo de billing: calcula start/end do período
CREATE OR REPLACE FUNCTION public.billing_cycle_bounds(
  p_reference_at TIMESTAMPTZ DEFAULT NULL,
  p_anchor_day   INTEGER     DEFAULT 1,
  p_timezone     TEXT        DEFAULT 'America/Sao_Paulo'
)
RETURNS TABLE(cycle_start_at TIMESTAMPTZ, cycle_end_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  reference_local           timestamp;
  tz                        text;
  anchor_day                integer;
  month_start               date;
  this_month_last_day       integer;
  this_month_effective_day  integer;
  previous_month_start      date;
  previous_month_last_day   integer;
  previous_month_effective_day integer;
  next_month_start          date;
  next_month_last_day       integer;
  next_month_effective_day  integer;
  start_date                date;
  end_date                  date;
BEGIN
  tz         := COALESCE(NULLIF(trim(p_timezone), ''), 'America/Sao_Paulo');
  anchor_day := LEAST(31, GREATEST(1, COALESCE(p_anchor_day, 1)));
  reference_local := COALESCE(p_reference_at, now()) AT TIME ZONE tz;
  month_start := date_trunc('month', reference_local)::date;
  this_month_last_day := EXTRACT(DAY FROM (month_start + INTERVAL '1 month - 1 day'))::integer;
  this_month_effective_day := LEAST(anchor_day, this_month_last_day);
  IF reference_local::date >= (month_start + (this_month_effective_day - 1)) THEN
    start_date := month_start + (this_month_effective_day - 1);
  ELSE
    previous_month_start := (month_start - INTERVAL '1 month')::date;
    previous_month_last_day := EXTRACT(DAY FROM (month_start - INTERVAL '1 day'))::integer;
    previous_month_effective_day := LEAST(anchor_day, previous_month_last_day);
    start_date := previous_month_start + (previous_month_effective_day - 1);
  END IF;
  next_month_start := date_trunc('month', (start_date + INTERVAL '1 month')::timestamp)::date;
  next_month_last_day := EXTRACT(DAY FROM (next_month_start + INTERVAL '1 month - 1 day'))::integer;
  next_month_effective_day := LEAST(anchor_day, next_month_last_day);
  end_date := next_month_start + (next_month_effective_day - 1);
  cycle_start_at := start_date::timestamp AT TIME ZONE tz;
  cycle_end_at   := end_date::timestamp AT TIME ZONE tz;
  RETURN NEXT;
END;
$$;

-- 7.10 Snapshot de uso do billing do usuário atual
CREATE OR REPLACE FUNCTION public.billing_get_my_usage_summary()
RETURNS SETOF public.billing_usage_cycles LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  RETURN QUERY SELECT * FROM public.billing_get_usage_snapshot(auth.uid(), now());
END;
$$;

-- 7.11 Registro de uso de LLM + atualização do ciclo
CREATE OR REPLACE FUNCTION public.billing_record_usage(
  p_user_id         UUID,
  p_provider        TEXT,
  p_model           TEXT,
  p_input_tokens    INTEGER DEFAULT 0,
  p_output_tokens   INTEGER DEFAULT 0,
  p_conversation_id UUID DEFAULT NULL,
  p_interaction_id  UUID DEFAULT NULL,
  p_metadata        JSONB DEFAULT NULL,
  p_reference_at    TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(event_id uuid, user_id uuid, aces_id bigint,
              cycle_start_at timestamptz, cycle_end_at timestamptz,
              tokens_used bigint, credits_used numeric, usd_spent numeric)
LANGUAGE plpgsql SECURITY DEFINER AS $$
#variable_conflict use_column
DECLARE
  snapshot_row      record;
  pricing_row       record;
  normalized_prov   text;
  normalized_model  text;
  inp_tok           integer;
  out_tok           integer;
  tot_tok           integer;
  cons_credits      numeric(20,4);
  cons_usd          numeric(20,6);
  created_event_id  uuid;
BEGIN
  SELECT * INTO snapshot_row
  FROM public.billing_get_usage_snapshot(p_user_id, COALESCE(p_reference_at, now()))
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
  IF snapshot_row.aces_id IS NULL THEN RAISE EXCEPTION 'USER_NOT_LINKED_TO_ACES'; END IF;

  normalized_prov  := lower(trim(COALESCE(p_provider, '')));
  normalized_model := trim(COALESCE(p_model, ''));

  SELECT input_usd_per_1m_tokens, output_usd_per_1m_tokens INTO pricing_row
  FROM public.llm_model_pricing
  WHERE provider = normalized_prov AND model = normalized_model AND is_active = true
  ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'MODEL_PRICING_NOT_FOUND'; END IF;

  inp_tok     := GREATEST(COALESCE(p_input_tokens, 0), 0);
  out_tok     := GREATEST(COALESCE(p_output_tokens, 0), 0);
  tot_tok     := inp_tok + out_tok;
  cons_credits := ROUND((tot_tok::numeric / 10::numeric), 4);
  cons_usd    := ROUND(
    ((inp_tok::numeric * pricing_row.input_usd_per_1m_tokens) +
     (out_tok::numeric * pricing_row.output_usd_per_1m_tokens)) / 1000000::numeric, 6);

  INSERT INTO public.billing_usage_events
    (aces_id, user_id, conversation_id, interaction_id, provider, model,
     input_tokens, output_tokens, total_tokens, credits_used, usd_cost,
     cycle_start_at, cycle_end_at, metadata)
  VALUES
    (snapshot_row.aces_id, p_user_id, p_conversation_id,
     COALESCE(p_interaction_id, gen_random_uuid()),
     normalized_prov, normalized_model, inp_tok, out_tok, tot_tok,
     cons_credits, cons_usd,
     snapshot_row.cycle_start_at, snapshot_row.cycle_end_at,
     COALESCE(p_metadata, '{}'::jsonb))
  RETURNING id INTO created_event_id;

  INSERT INTO public.billing_usage_cycles
    (user_id, cycle_start_at, cycle_end_at, aces_id,
     tokens_used, credits_used, usd_spent, updated_at)
  VALUES
    (p_user_id, snapshot_row.cycle_start_at, snapshot_row.cycle_end_at,
     snapshot_row.aces_id, tot_tok, cons_credits, cons_usd, now())
  ON CONFLICT ON CONSTRAINT billing_usage_cycles_pkey DO UPDATE SET
    aces_id      = EXCLUDED.aces_id,
    cycle_end_at = EXCLUDED.cycle_end_at,
    tokens_used  = public.billing_usage_cycles.tokens_used + EXCLUDED.tokens_used,
    credits_used = public.billing_usage_cycles.credits_used + EXCLUDED.credits_used,
    usd_spent    = public.billing_usage_cycles.usd_spent + EXCLUDED.usd_spent,
    updated_at   = now();

  RETURN QUERY
  SELECT created_event_id, buc.user_id, buc.aces_id,
         buc.cycle_start_at, buc.cycle_end_at,
         buc.tokens_used, buc.credits_used, buc.usd_spent
  FROM public.billing_usage_cycles buc
  WHERE buc.user_id = p_user_id AND buc.cycle_start_at = snapshot_row.cycle_start_at
  LIMIT 1;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. TRIGGERS
-- ---------------------------------------------------------------------------

-- updated_at automático para tabelas Crm
CREATE OR REPLACE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON Crm.leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_pipeline_stages_updated_at
  BEFORE UPDATE ON Crm.pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_opportunities_updated_at
  BEFORE UPDATE ON Crm.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON Crm.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- updated_at automático para tabelas public
CREATE OR REPLACE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_agents_updated_at
  BEFORE UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Sync aces_id → JWT quando usuário Crm é atualizado
CREATE OR REPLACE TRIGGER trg_sync_aces_to_jwt
  AFTER INSERT OR UPDATE OF aces_id ON Crm.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_aces_id_to_jwt();

-- Auto-criar perfil quando auth.user é criado
CREATE OR REPLACE TRIGGER trg_new_auth_user_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user_profile();

-- Normalizar campos de perfil
CREATE OR REPLACE TRIGGER trg_normalize_profile
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.normalize_user_profile_fields();

-- Auto-add remarketing quando status = 'Remarketing'
CREATE OR REPLACE TRIGGER trg_auto_remarketing
  AFTER UPDATE OF status ON Crm.leads
  FOR EACH ROW EXECUTE FUNCTION public.auto_add_to_remarketing();

-- Remove do remarketing quando status muda
CREATE OR REPLACE TRIGGER trg_remove_remarketing
  AFTER UPDATE OF status ON Crm.leads
  FOR EACH ROW EXECUTE FUNCTION public.remove_from_remarketing();

-- ---------------------------------------------------------------------------
-- 9. ROW LEVEL SECURITY (RLS)
-- ---------------------------------------------------------------------------

-- Habilitar RLS
ALTER TABLE Crm.leads            ENABLE ROW LEVEL SECURITY;
ALTER TABLE Crm.users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE Crm.message_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE Crm.opportunities    ENABLE ROW LEVEL SECURITY;
ALTER TABLE Crm.follow_up_tasks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE Crm.pipeline_stages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE Crm.tags             ENABLE ROW LEVEL SECURITY;
ALTER TABLE Crm.lead_tags        ENABLE ROW LEVEL SECURITY;
ALTER TABLE Crm.user_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE Crm.accounts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE Crm.instance         ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.conversations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tables           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_settings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_plans          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_model_pricing      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_usage_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_usage_cycles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.database_metadata_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frontend_error_logs    ENABLE ROW LEVEL SECURITY;

-- ── Crm.leads ──────────────────────────────────────────────────────────────
CREATE POLICY leads_select ON Crm.leads FOR SELECT
  USING (aces_id = (SELECT aces_id FROM Crm.users WHERE auth_user_id = auth.uid()));

CREATE POLICY leads_insert ON Crm.leads FOR INSERT
  WITH CHECK (aces_id = (SELECT aces_id FROM Crm.users WHERE auth_user_id = auth.uid()));

CREATE POLICY leads_update ON Crm.leads FOR UPDATE
  USING (aces_id = (SELECT aces_id FROM Crm.users WHERE auth_user_id = auth.uid()));

CREATE POLICY leads_delete ON Crm.leads FOR DELETE
  USING (
    aces_id = (
      SELECT aces_id FROM Crm.users
      WHERE auth_user_id = auth.uid() AND role = 'ADMIN'
    )
  );

-- ── Crm.users ──────────────────────────────────────────────────────────────
CREATE POLICY users_select ON Crm.users FOR SELECT
  USING (aces_id = (SELECT aces_id FROM Crm.users cu WHERE cu.auth_user_id = auth.uid()));

CREATE POLICY users_update ON Crm.users FOR UPDATE
  USING (auth_user_id = auth.uid());

-- ── Crm.message_history ────────────────────────────────────────────────────
CREATE POLICY msg_select ON Crm.message_history FOR SELECT
  USING (aces_id = (SELECT aces_id FROM Crm.users WHERE auth_user_id = auth.uid()));

CREATE POLICY msg_insert ON Crm.message_history FOR INSERT
  WITH CHECK (aces_id = (SELECT aces_id FROM Crm.users WHERE auth_user_id = auth.uid()));

-- ── Crm.pipeline_stages ────────────────────────────────────────────────────
CREATE POLICY ps_select ON Crm.pipeline_stages FOR SELECT
  USING (aces_id = (SELECT aces_id FROM Crm.users WHERE auth_user_id = auth.uid()));

CREATE POLICY ps_insert ON Crm.pipeline_stages FOR INSERT
  WITH CHECK (
    aces_id = (
      SELECT aces_id FROM Crm.users
      WHERE auth_user_id = auth.uid() AND role = 'ADMIN'
    )
  );

CREATE POLICY ps_update ON Crm.pipeline_stages FOR UPDATE
  USING (
    aces_id = (
      SELECT aces_id FROM Crm.users
      WHERE auth_user_id = auth.uid() AND role = 'ADMIN'
    )
  );

CREATE POLICY ps_delete ON Crm.pipeline_stages FOR DELETE
  USING (
    aces_id = (
      SELECT aces_id FROM Crm.users
      WHERE auth_user_id = auth.uid() AND role = 'ADMIN'
    )
  );

-- ── Crm.tags ───────────────────────────────────────────────────────────────
CREATE POLICY tags_all ON Crm.tags FOR ALL
  USING (aces_id = (SELECT aces_id FROM Crm.users WHERE auth_user_id = auth.uid()));

-- ── Crm.lead_tags ──────────────────────────────────────────────────────────
CREATE POLICY lead_tags_all ON Crm.lead_tags FOR ALL
  USING (
    lead_id IN (
      SELECT id FROM Crm.leads
      WHERE aces_id = (SELECT aces_id FROM Crm.users WHERE auth_user_id = auth.uid())
    )
  );

-- ── Crm.opportunities ──────────────────────────────────────────────────────
CREATE POLICY opp_all ON Crm.opportunities FOR ALL
  USING (aces_id = (SELECT aces_id FROM Crm.users WHERE auth_user_id = auth.uid()));

-- ── Crm.follow_up_tasks ────────────────────────────────────────────────────
CREATE POLICY tasks_all ON Crm.follow_up_tasks FOR ALL
  USING (aces_id = (SELECT aces_id FROM Crm.users WHERE auth_user_id = auth.uid()));

-- ── Crm.accounts ───────────────────────────────────────────────────────────
CREATE POLICY accounts_select ON Crm.accounts FOR SELECT
  USING (id = (SELECT aces_id FROM Crm.users WHERE auth_user_id = auth.uid()));

-- ── Crm.instance ───────────────────────────────────────────────────────────
CREATE POLICY instance_select ON Crm.instance FOR SELECT
  USING (aces_id = (SELECT aces_id FROM Crm.users WHERE auth_user_id = auth.uid()));

-- ── Crm.user_invitations ───────────────────────────────────────────────────
CREATE POLICY inv_select ON Crm.user_invitations FOR SELECT
  USING (aces_id = (SELECT aces_id FROM Crm.users WHERE auth_user_id = auth.uid()));

CREATE POLICY inv_insert ON Crm.user_invitations FOR INSERT
  WITH CHECK (
    aces_id = (
      SELECT aces_id FROM Crm.users
      WHERE auth_user_id = auth.uid() AND role = 'ADMIN'
    )
  );

-- ── public.conversations ───────────────────────────────────────────────────
CREATE POLICY conv_own ON public.conversations FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── public.messages ────────────────────────────────────────────────────────
CREATE POLICY msg_own ON public.messages FOR ALL
  USING (
    conversation_id IN (
      SELECT id FROM public.conversations WHERE user_id = auth.uid()
    )
  );

-- ── public.agents ──────────────────────────────────────────────────────────
CREATE POLICY agents_own ON public.agents FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── public.agent_tables ────────────────────────────────────────────────────
CREATE POLICY agent_tables_own ON public.agent_tables FOR ALL
  USING (
    agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
  );

-- ── public.llm_settings ────────────────────────────────────────────────────
CREATE POLICY llm_own ON public.llm_settings FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── public.user_profiles ───────────────────────────────────────────────────
CREATE POLICY profiles_own ON public.user_profiles FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── public.billing_plans (somente leitura para todos autenticados) ─────────
CREATE POLICY billing_plans_read ON public.billing_plans FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ── public.llm_model_pricing (somente leitura) ─────────────────────────────
CREATE POLICY pricing_read ON public.llm_model_pricing FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ── public.billing_usage_events ────────────────────────────────────────────
CREATE POLICY bue_own ON public.billing_usage_events FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY bue_insert ON public.billing_usage_events FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ── public.billing_usage_cycles ────────────────────────────────────────────
CREATE POLICY buc_own ON public.billing_usage_cycles FOR ALL
  USING (user_id = auth.uid());

-- ── public.database_metadata_cache ────────────────────────────────────────
CREATE POLICY dmc_read ON public.database_metadata_cache FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY dmc_write ON public.database_metadata_cache FOR ALL
  USING (auth.uid() IS NOT NULL);

-- ── public.frontend_error_logs ─────────────────────────────────────────────
CREATE POLICY fel_own ON public.frontend_error_logs FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 10. DADOS INICIAIS (Seed)
-- ---------------------------------------------------------------------------

-- Plano padrão de billing
INSERT INTO public.billing_plans (code, name, monthly_token_limit, monthly_credit_limit)
VALUES ('test_1m', 'Plano Teste 1M', 1000000, 100000)
ON CONFLICT (code) DO NOTHING;

-- Preços dos modelos LLM
INSERT INTO public.llm_model_pricing
  (provider, model, input_usd_per_1m_tokens, output_usd_per_1m_tokens)
VALUES
  ('openai',  'gpt-4o',              5.00,  15.00),
  ('openai',  'gpt-4o-mini',         0.15,   0.60),
  ('openai',  'gpt-3.5-turbo',       0.50,   1.50),
  ('google',  'gemini-1.5-pro',      3.50,  10.50),
  ('google',  'gemini-1.5-flash',    0.075,  0.30),
  ('gemini',  'gemini-2.0-flash',    0.075,  0.30),
  ('gemini',  'gemini-1.5-pro',      3.50,  10.50),
  ('gemini',  'gemini-1.5-flash',    0.075,  0.30)
ON CONFLICT DO NOTHING;
