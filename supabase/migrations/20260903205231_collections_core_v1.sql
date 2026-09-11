-- Canonical, provider-neutral collection orchestration core.
-- This migration is intentionally additive. The legacy RB runtime remains
-- available until each account is switched through collections.runtime_controls.

CREATE SCHEMA IF NOT EXISTS collections;
REVOKE ALL ON SCHEMA collections FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA collections TO service_role;

CREATE TABLE collections.source_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  source_type text NOT NULL,
  delivery_mode text NOT NULL,
  default_ingestion_mode text NOT NULL DEFAULT 'incremental',
  status text NOT NULL DEFAULT 'active',
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  stale_after_minutes integer NOT NULL DEFAULT 1440,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_received_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  created_by uuid REFERENCES crm.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_connections_id_tenant_unique UNIQUE (id, aces_id),
  CONSTRAINT source_connections_name_tenant_unique UNIQUE (aces_id, name),
  CONSTRAINT source_connections_source_type_check
    CHECK (source_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT source_connections_delivery_mode_check
    CHECK (delivery_mode IN ('pull', 'push', 'file')),
  CONSTRAINT source_connections_ingestion_mode_check
    CHECK (default_ingestion_mode IN ('snapshot', 'incremental')),
  CONSTRAINT source_connections_status_check
    CHECK (status IN ('active', 'paused', 'error', 'disabled')),
  CONSTRAINT source_connections_stale_after_check CHECK (stale_after_minutes > 0),
  CONSTRAINT source_connections_capabilities_object_check
    CHECK (jsonb_typeof(capabilities) = 'object'),
  CONSTRAINT source_connections_config_object_check
    CHECK (jsonb_typeof(config) = 'object')
);

CREATE TABLE collections.source_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  source_connection_id uuid NOT NULL,
  credential_type text NOT NULL,
  ciphertext bytea NOT NULL,
  iv bytea NOT NULL,
  auth_tag bytea NOT NULL,
  key_version text NOT NULL,
  status text NOT NULL DEFAULT 'current',
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_credentials_connection_tenant_fkey
    FOREIGN KEY (source_connection_id, aces_id)
    REFERENCES collections.source_connections(id, aces_id) ON DELETE CASCADE,
  CONSTRAINT source_credentials_type_check
    CHECK (credential_type IN ('rb_token', 'webhook_hmac')),
  CONSTRAINT source_credentials_status_check
    CHECK (status IN ('current', 'previous', 'revoked')),
  CONSTRAINT source_credentials_crypto_check
    CHECK (octet_length(iv) = 12 AND octet_length(auth_tag) = 16)
);

CREATE UNIQUE INDEX source_credentials_one_current_idx
  ON collections.source_credentials(source_connection_id, credential_type)
  WHERE status = 'current';
CREATE INDEX source_credentials_connection_idx
  ON collections.source_credentials(source_connection_id, status, valid_until);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_tools_id_tenant_unique'
      AND conrelid = 'agents.agent_tools'::regclass
  ) THEN
    ALTER TABLE agents.agent_tools
      ADD CONSTRAINT agent_tools_id_tenant_unique UNIQUE (id, aces_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leads_id_tenant_unique'
      AND conrelid = 'crm.leads'::regclass
  ) THEN
    ALTER TABLE crm.leads
      ADD CONSTRAINT leads_id_tenant_unique UNIQUE (id, aces_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'automation_funnels_id_tenant_unique'
      AND conrelid = 'crm.automation_funnels'::regclass
  ) THEN
    ALTER TABLE crm.automation_funnels
      ADD CONSTRAINT automation_funnels_id_tenant_unique UNIQUE (id, aces_id);
  END IF;
END;
$$;

CREATE TABLE collections.agent_source_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  agent_tool_id uuid NOT NULL,
  source_connection_id uuid NOT NULL,
  creditor_external_id text,
  priority integer NOT NULL DEFAULT 100,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_source_bindings_tool_tenant_fkey
    FOREIGN KEY (agent_tool_id, aces_id)
    REFERENCES agents.agent_tools(id, aces_id) ON DELETE CASCADE,
  CONSTRAINT agent_source_bindings_connection_tenant_fkey
    FOREIGN KEY (source_connection_id, aces_id)
    REFERENCES collections.source_connections(id, aces_id) ON DELETE CASCADE,
  CONSTRAINT agent_source_bindings_priority_check CHECK (priority >= 0)
);

CREATE UNIQUE INDEX agent_source_bindings_scoped_unique_idx
  ON collections.agent_source_bindings(agent_tool_id, source_connection_id, creditor_external_id)
  WHERE creditor_external_id IS NOT NULL;
CREATE UNIQUE INDEX agent_source_bindings_default_unique_idx
  ON collections.agent_source_bindings(agent_tool_id, source_connection_id)
  WHERE creditor_external_id IS NULL;
CREATE INDEX agent_source_bindings_route_idx
  ON collections.agent_source_bindings(aces_id, source_connection_id, creditor_external_id, priority)
  WHERE is_enabled IS TRUE;

CREATE TABLE collections.ingestion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  source_connection_id uuid NOT NULL,
  external_idempotency_key text,
  payload_hash text NOT NULL,
  mode text NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'accepted',
  received_count integer NOT NULL DEFAULT 0,
  accepted_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  unchanged_count integer NOT NULL DEFAULT 0,
  not_present_count integer NOT NULL DEFAULT 0,
  affected_cases_count integer NOT NULL DEFAULT 0,
  error_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingestion_runs_id_tenant_unique UNIQUE (id, aces_id),
  CONSTRAINT ingestion_runs_connection_tenant_fkey
    FOREIGN KEY (source_connection_id, aces_id)
    REFERENCES collections.source_connections(id, aces_id) ON DELETE CASCADE,
  CONSTRAINT ingestion_runs_mode_check CHECK (mode IN ('snapshot', 'incremental')),
  CONSTRAINT ingestion_runs_status_check
    CHECK (status IN ('accepted', 'processing', 'succeeded', 'partial', 'failed')),
  CONSTRAINT ingestion_runs_scope_object_check CHECK (jsonb_typeof(scope) = 'object'),
  CONSTRAINT ingestion_runs_error_object_check CHECK (jsonb_typeof(error_summary) = 'object'),
  CONSTRAINT ingestion_runs_counts_check CHECK (
    received_count >= 0 AND accepted_count >= 0 AND rejected_count >= 0
    AND created_count >= 0 AND updated_count >= 0 AND unchanged_count >= 0
    AND not_present_count >= 0 AND affected_cases_count >= 0
  )
);

CREATE UNIQUE INDEX ingestion_runs_idempotency_idx
  ON collections.ingestion_runs(source_connection_id, external_idempotency_key)
  WHERE external_idempotency_key IS NOT NULL;
CREATE INDEX ingestion_runs_source_created_idx
  ON collections.ingestion_runs(source_connection_id, created_at DESC);
CREATE INDEX ingestion_runs_pending_idx
  ON collections.ingestion_runs(status, created_at)
  WHERE status IN ('accepted', 'processing');

CREATE TABLE collections.ingestion_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  ingestion_run_id uuid NOT NULL,
  row_number integer,
  external_receivable_id text,
  status text NOT NULL,
  error_code text,
  error_message text,
  payload_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingestion_items_run_tenant_fkey
    FOREIGN KEY (ingestion_run_id, aces_id)
    REFERENCES collections.ingestion_runs(id, aces_id) ON DELETE CASCADE,
  CONSTRAINT ingestion_items_status_check
    CHECK (status IN ('accepted', 'rejected', 'unchanged')),
  CONSTRAINT ingestion_items_row_check CHECK (row_number IS NULL OR row_number > 0)
);

CREATE INDEX ingestion_items_run_idx
  ON collections.ingestion_items(ingestion_run_id, row_number, created_at);
CREATE INDEX ingestion_items_errors_idx
  ON collections.ingestion_items(ingestion_run_id, status)
  WHERE status = 'rejected';

CREATE TABLE collections.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  source_connection_id uuid NOT NULL,
  external_customer_id text NOT NULL,
  creditor_external_id text NOT NULL,
  lead_id uuid,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  customer_document text,
  creditor_name text,
  creditor_document text,
  communication_status text NOT NULL DEFAULT 'eligible',
  pause_reason text,
  total_open_amount numeric(18,2) NOT NULL DEFAULT 0,
  open_receivables_count integer NOT NULL DEFAULT 0,
  oldest_due_date date,
  newest_due_date date,
  most_overdue_days integer,
  source_freshness text NOT NULL DEFAULT 'fresh',
  last_source_update_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cases_id_tenant_unique UNIQUE (id, aces_id),
  CONSTRAINT cases_connection_tenant_fkey
    FOREIGN KEY (source_connection_id, aces_id)
    REFERENCES collections.source_connections(id, aces_id) ON DELETE CASCADE,
  CONSTRAINT cases_lead_tenant_fkey
    FOREIGN KEY (lead_id, aces_id)
    REFERENCES crm.leads(id, aces_id) ON DELETE RESTRICT,
  CONSTRAINT cases_identity_unique
    UNIQUE (source_connection_id, external_customer_id, creditor_external_id),
  CONSTRAINT cases_communication_status_check
    CHECK (communication_status IN ('eligible', 'scheduled', 'in_service', 'paused', 'completed', 'stale', 'error')),
  CONSTRAINT cases_freshness_check CHECK (source_freshness IN ('fresh', 'stale', 'unknown')),
  CONSTRAINT cases_amount_check CHECK (total_open_amount >= 0),
  CONSTRAINT cases_count_check CHECK (open_receivables_count >= 0)
);

CREATE INDEX cases_lead_idx ON collections.cases(aces_id, lead_id)
  WHERE lead_id IS NOT NULL;
CREATE INDEX cases_phone_idx ON collections.cases(aces_id, customer_phone);
CREATE INDEX cases_eligible_idx
  ON collections.cases(aces_id, communication_status, most_overdue_days DESC, total_open_amount DESC)
  WHERE communication_status = 'eligible';

CREATE TABLE collections.receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  source_connection_id uuid NOT NULL,
  case_id uuid NOT NULL,
  external_receivable_id text NOT NULL,
  external_customer_id text NOT NULL,
  creditor_external_id text NOT NULL,
  description text,
  original_amount numeric(18,2),
  remaining_amount numeric(18,2) NOT NULL,
  currency text NOT NULL DEFAULT 'BRL',
  due_date date NOT NULL,
  financial_status text NOT NULL,
  record_status text NOT NULL DEFAULT 'current',
  payment_method text,
  trusted_payment_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_updated_at timestamptz NOT NULL,
  last_seen_ingestion_id uuid,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  canonical_hash text NOT NULL,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receivables_connection_tenant_fkey
    FOREIGN KEY (source_connection_id, aces_id)
    REFERENCES collections.source_connections(id, aces_id) ON DELETE CASCADE,
  CONSTRAINT receivables_case_tenant_fkey
    FOREIGN KEY (case_id, aces_id)
    REFERENCES collections.cases(id, aces_id) ON DELETE CASCADE,
  CONSTRAINT receivables_ingestion_tenant_fkey
    FOREIGN KEY (last_seen_ingestion_id, aces_id)
    REFERENCES collections.ingestion_runs(id, aces_id) ON DELETE SET NULL,
  CONSTRAINT receivables_identity_unique UNIQUE (source_connection_id, external_receivable_id),
  CONSTRAINT receivables_financial_status_check
    CHECK (financial_status IN ('open', 'settled', 'cancelled', 'suspended', 'unknown')),
  CONSTRAINT receivables_record_status_check
    CHECK (record_status IN ('current', 'not_present', 'stale', 'rejected')),
  CONSTRAINT receivables_payment_method_check CHECK (
    payment_method IS NULL OR payment_method IN ('pix', 'boleto', 'card', 'cash', 'bank_transfer', 'store_credit', 'other')
  ),
  CONSTRAINT receivables_amount_check CHECK (
    remaining_amount >= 0 AND (original_amount IS NULL OR original_amount >= 0)
  ),
  CONSTRAINT receivables_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT receivables_payment_data_object_check CHECK (jsonb_typeof(trusted_payment_data) = 'object'),
  CONSTRAINT receivables_metadata_object_check CHECK (jsonb_typeof(source_metadata) = 'object')
);

CREATE INDEX receivables_case_status_idx
  ON collections.receivables(case_id, record_status, financial_status, due_date);
CREATE INDEX receivables_source_seen_idx
  ON collections.receivables(source_connection_id, last_seen_ingestion_id);
CREATE INDEX receivables_open_due_idx
  ON collections.receivables(aces_id, due_date, case_id)
  WHERE financial_status = 'open' AND record_status = 'current';

CREATE TABLE collections.journey_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  funnel_id uuid NOT NULL,
  timing_relation text NOT NULL,
  days_offset integer NOT NULL DEFAULT 0,
  priority integer NOT NULL DEFAULT 100,
  financial_statuses jsonb NOT NULL DEFAULT '["open"]'::jsonb,
  payment_methods jsonb NOT NULL DEFAULT '[]'::jsonb,
  currency text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journey_rules_id_tenant_unique UNIQUE (id, aces_id),
  CONSTRAINT journey_rules_funnel_tenant_fkey
    FOREIGN KEY (funnel_id, aces_id)
    REFERENCES crm.automation_funnels(id, aces_id) ON DELETE CASCADE,
  CONSTRAINT journey_rules_funnel_unique UNIQUE (funnel_id),
  CONSTRAINT journey_rules_timing_check
    CHECK (timing_relation IN ('before_due', 'on_due', 'after_due')),
  CONSTRAINT journey_rules_days_check CHECK (days_offset >= 0),
  CONSTRAINT journey_rules_priority_check CHECK (priority >= 0),
  CONSTRAINT journey_rules_statuses_array_check CHECK (jsonb_typeof(financial_statuses) = 'array'),
  CONSTRAINT journey_rules_payment_array_check CHECK (jsonb_typeof(payment_methods) = 'array'),
  CONSTRAINT journey_rules_currency_check CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$')
);

CREATE TABLE collections.journey_source_bindings (
  journey_rule_id uuid NOT NULL,
  source_connection_id uuid NOT NULL,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (journey_rule_id, source_connection_id),
  CONSTRAINT journey_source_rule_tenant_fkey
    FOREIGN KEY (journey_rule_id, aces_id)
    REFERENCES collections.journey_rules(id, aces_id) ON DELETE CASCADE,
  CONSTRAINT journey_source_connection_tenant_fkey
    FOREIGN KEY (source_connection_id, aces_id)
    REFERENCES collections.source_connections(id, aces_id) ON DELETE CASCADE
);

CREATE INDEX journey_source_connection_idx
  ON collections.journey_source_bindings(source_connection_id, journey_rule_id);

CREATE TABLE collections.mapping_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  source_connection_id uuid NOT NULL,
  name text NOT NULL,
  file_kind text NOT NULL,
  sheet_name text,
  column_mapping jsonb NOT NULL,
  default_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  date_format text NOT NULL DEFAULT 'YYYY-MM-DD',
  decimal_format text NOT NULL DEFAULT 'pt-BR',
  header_row integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES crm.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mapping_profiles_id_tenant_unique UNIQUE (id, aces_id),
  CONSTRAINT mapping_profiles_connection_tenant_fkey
    FOREIGN KEY (source_connection_id, aces_id)
    REFERENCES collections.source_connections(id, aces_id) ON DELETE CASCADE,
  CONSTRAINT mapping_profiles_name_unique UNIQUE (source_connection_id, name),
  CONSTRAINT mapping_profiles_kind_check CHECK (file_kind IN ('csv', 'xlsx')),
  CONSTRAINT mapping_profiles_mapping_object_check CHECK (jsonb_typeof(column_mapping) = 'object'),
  CONSTRAINT mapping_profiles_defaults_object_check CHECK (jsonb_typeof(default_values) = 'object'),
  CONSTRAINT mapping_profiles_header_check CHECK (header_row > 0)
);

CREATE TABLE collections.spreadsheet_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  source_connection_id uuid NOT NULL,
  mapping_profile_id uuid,
  storage_bucket text NOT NULL DEFAULT 'collection-imports',
  storage_path text NOT NULL UNIQUE,
  original_file_name text NOT NULL,
  file_kind text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL,
  selected_sheet text,
  header_row integer NOT NULL DEFAULT 1,
  date_format text NOT NULL DEFAULT 'YYYY-MM-DD',
  decimal_format text NOT NULL DEFAULT 'pt-BR',
  mode text,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'uploaded',
  preview_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingestion_run_id uuid,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_by uuid REFERENCES crm.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spreadsheet_imports_connection_tenant_fkey
    FOREIGN KEY (source_connection_id, aces_id)
    REFERENCES collections.source_connections(id, aces_id) ON DELETE CASCADE,
  CONSTRAINT spreadsheet_imports_profile_tenant_fkey
    FOREIGN KEY (mapping_profile_id, aces_id)
    REFERENCES collections.mapping_profiles(id, aces_id) ON DELETE RESTRICT,
  CONSTRAINT spreadsheet_imports_ingestion_tenant_fkey
    FOREIGN KEY (ingestion_run_id, aces_id)
    REFERENCES collections.ingestion_runs(id, aces_id) ON DELETE SET NULL,
  CONSTRAINT spreadsheet_imports_kind_check CHECK (file_kind IN ('csv', 'xlsx')),
  CONSTRAINT spreadsheet_imports_mode_check CHECK (mode IS NULL OR mode IN ('snapshot', 'incremental')),
  CONSTRAINT spreadsheet_imports_status_check
    CHECK (status IN ('uploaded', 'previewing', 'ready', 'publishing', 'succeeded', 'failed', 'expired')),
  CONSTRAINT spreadsheet_imports_file_size_check CHECK (file_size > 0 AND file_size <= 20971520),
  CONSTRAINT spreadsheet_imports_header_check CHECK (header_row > 0),
  CONSTRAINT spreadsheet_imports_json_check CHECK (
    jsonb_typeof(scope) = 'object' AND jsonb_typeof(mapping) = 'object'
    AND jsonb_typeof(defaults) = 'object' AND jsonb_typeof(preview_summary) = 'object'
  )
);

CREATE INDEX spreadsheet_imports_tenant_status_idx
  ON collections.spreadsheet_imports(aces_id, status, created_at DESC);
CREATE INDEX spreadsheet_imports_expiry_idx
  ON collections.spreadsheet_imports(expires_at)
  WHERE status NOT IN ('expired', 'publishing');

CREATE TABLE collections.outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  topic text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT outbox_status_check CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  CONSTRAINT outbox_attempt_check CHECK (attempt_count >= 0),
  CONSTRAINT outbox_payload_object_check CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX outbox_claim_idx ON collections.outbox(status, available_at, created_at)
  WHERE status IN ('pending', 'processing');

CREATE TABLE collections.runtime_controls (
  aces_id integer PRIMARY KEY REFERENCES crm.accounts(id) ON DELETE CASCADE,
  active_dispatcher text NOT NULL DEFAULT 'legacy_rb',
  changed_by uuid REFERENCES crm.users(id) ON DELETE SET NULL,
  change_reason text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT runtime_controls_dispatcher_check
    CHECK (active_dispatcher IN ('legacy_rb', 'canonical', 'paused'))
);

CREATE TABLE collections.contact_daily_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  normalized_phone_hash text NOT NULL,
  local_date date NOT NULL,
  case_id uuid NOT NULL,
  execution_id uuid NOT NULL REFERENCES crm.automation_executions(id) ON DELETE CASCADE,
  decision_key text NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT contact_daily_case_tenant_fkey
    FOREIGN KEY (case_id, aces_id)
    REFERENCES collections.cases(id, aces_id) ON DELETE CASCADE,
  CONSTRAINT contact_daily_unique UNIQUE (aces_id, normalized_phone_hash, local_date),
  CONSTRAINT contact_daily_execution_unique UNIQUE (execution_id)
);

CREATE INDEX contact_daily_case_idx
  ON collections.contact_daily_dispatches(case_id, local_date DESC);

-- Every table remains server-side only. RLS is defense in depth for accidental grants.
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'source_connections', 'source_credentials', 'agent_source_bindings',
    'ingestion_runs', 'ingestion_items', 'cases', 'receivables',
    'journey_rules', 'journey_source_bindings', 'mapping_profiles',
    'spreadsheet_imports', 'outbox', 'runtime_controls', 'contact_daily_dispatches'
  ]
  LOOP
    EXECUTE format('ALTER TABLE collections.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON collections.%I FROM PUBLIC, anon, authenticated', v_table);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON collections.%I TO service_role', v_table);
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'source_connections', 'source_credentials', 'agent_source_bindings', 'cases',
    'receivables', 'journey_rules', 'mapping_profiles', 'spreadsheet_imports',
    'runtime_controls'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON collections.%I', 'trg_' || v_table || '_updated_at', v_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON collections.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',
      'trg_' || v_table || '_updated_at', v_table
    );
  END LOOP;
END;
$$;

-- Automation source identity. Collection enrollment is case-scoped, like a
-- calendar enrollment is event-scoped, while keeping all existing entry types.
ALTER TABLE crm.automation_funnels ALTER COLUMN trigger_stage_id DROP NOT NULL;
ALTER TABLE crm.automation_enrollments
  ADD COLUMN IF NOT EXISTS source_collection_case_id uuid REFERENCES collections.cases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_collection_decision_key text;
ALTER TABLE crm.automation_executions
  ADD COLUMN IF NOT EXISTS source_collection_case_id uuid REFERENCES collections.cases(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'automation_funnels_entry_source_check'
      AND conrelid = 'crm.automation_funnels'::regclass
  ) THEN
    ALTER TABLE crm.automation_funnels DROP CONSTRAINT automation_funnels_entry_source_check;
  END IF;
  ALTER TABLE crm.automation_funnels ADD CONSTRAINT automation_funnels_entry_source_check
    CHECK (entry_source IN ('conditions', 'rb', 'calendar_event', 'collection'));

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'automation_funnels_entry_shape_check'
      AND conrelid = 'crm.automation_funnels'::regclass
  ) THEN
    ALTER TABLE crm.automation_funnels DROP CONSTRAINT automation_funnels_entry_shape_check;
  END IF;
  ALTER TABLE crm.automation_funnels ADD CONSTRAINT automation_funnels_entry_shape_check CHECK (
    (entry_source = 'calendar_event' AND trigger_event_status IS NOT NULL)
    OR (entry_source = 'collection' AND trigger_event_status IS NULL)
    OR (entry_source IN ('conditions', 'rb') AND trigger_stage_id IS NOT NULL)
  );

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'automation_enrollments_anchor_event_check'
      AND conrelid = 'crm.automation_enrollments'::regclass
  ) THEN
    ALTER TABLE crm.automation_enrollments DROP CONSTRAINT automation_enrollments_anchor_event_check;
  END IF;
  ALTER TABLE crm.automation_enrollments ADD CONSTRAINT automation_enrollments_anchor_event_check CHECK (
    anchor_event IN ('stage_entered_at', 'last_outbound', 'last_inbound',
      'event_start_time', 'event_end_time', 'event_status_changed_at', 'collection_eligible_at')
  );
END;
$$;

DROP INDEX IF EXISTS crm.idx_automation_enrollments_active_anchor;
CREATE UNIQUE INDEX idx_automation_enrollments_active_anchor
  ON crm.automation_enrollments(funnel_id, lead_id, anchor_event, anchor_at)
  WHERE status = 'active'
    AND source_calendar_event_id IS NULL
    AND source_collection_case_id IS NULL;
CREATE UNIQUE INDEX automation_enrollments_collection_decision_idx
  ON crm.automation_enrollments(source_collection_decision_key)
  WHERE source_collection_decision_key IS NOT NULL;
CREATE INDEX automation_enrollments_collection_case_idx
  ON crm.automation_enrollments(funnel_id, source_collection_case_id, created_at DESC)
  WHERE source_collection_case_id IS NOT NULL;

DROP INDEX IF EXISTS crm.idx_automation_execution_pending_funnel_lead_step;
CREATE UNIQUE INDEX idx_automation_execution_pending_funnel_lead_step
  ON crm.automation_executions(funnel_id, lead_id, step_id)
  WHERE status IN ('pending', 'processing')
    AND funnel_id IS NOT NULL AND lead_id IS NOT NULL AND step_id IS NOT NULL
    AND source_calendar_event_id IS NULL AND source_collection_case_id IS NULL;
CREATE INDEX automation_executions_collection_case_idx
  ON crm.automation_executions(source_collection_case_id, status, scheduled_at)
  WHERE source_collection_case_id IS NOT NULL;

CREATE OR REPLACE FUNCTION collections.propagate_collection_execution_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.enrollment_id IS NOT NULL AND NEW.source_collection_case_id IS NULL THEN
    SELECT source_collection_case_id INTO NEW.source_collection_case_id
    FROM crm.automation_enrollments
    WHERE id = NEW.enrollment_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_collection_execution_source ON crm.automation_executions;
CREATE TRIGGER trg_propagate_collection_execution_source
  BEFORE INSERT OR UPDATE OF enrollment_id ON crm.automation_executions
  FOR EACH ROW EXECUTE FUNCTION collections.propagate_collection_execution_source();

CREATE OR REPLACE FUNCTION collections.ingest_envelope(
  p_source_connection_id uuid,
  p_external_idempotency_key text,
  p_payload_hash text,
  p_mode text,
  p_scope jsonb,
  p_records jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_connection collections.source_connections%ROWTYPE;
  v_existing_run collections.ingestion_runs%ROWTYPE;
  v_run_id uuid;
  v_record jsonb;
  v_case_id uuid;
  v_existing collections.receivables%ROWTYPE;
  v_source_updated_at timestamptz;
  v_financial_status text;
  v_payment_data jsonb;
  v_created integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_not_present integer := 0;
  v_received integer := 0;
  v_affected integer := 0;
  v_creditor_scope text := NULLIF(COALESCE(p_scope, '{}'::jsonb)->>'creditorExternalId', '');
BEGIN
  IF p_mode NOT IN ('snapshot', 'incremental') THEN
    RAISE EXCEPTION 'COLLECTION_INVALID_MODE';
  END IF;
  IF jsonb_typeof(p_records) <> 'array' OR jsonb_array_length(p_records) > 50000 THEN
    RAISE EXCEPTION 'COLLECTION_INVALID_RECORDS';
  END IF;

  SELECT * INTO v_connection
  FROM collections.source_connections
  WHERE id = p_source_connection_id
  FOR UPDATE;
  IF NOT FOUND OR v_connection.status IN ('disabled', 'paused') THEN
    RAISE EXCEPTION 'COLLECTION_SOURCE_UNAVAILABLE';
  END IF;
  IF p_mode = 'snapshot'
     AND COALESCE((v_connection.capabilities->>'supportsAuthoritativeSnapshot')::boolean, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'COLLECTION_SNAPSHOT_NOT_AUTHORIZED';
  END IF;

  IF NULLIF(trim(COALESCE(p_external_idempotency_key, '')), '') IS NOT NULL THEN
    SELECT * INTO v_existing_run
    FROM collections.ingestion_runs
    WHERE source_connection_id = p_source_connection_id
      AND external_idempotency_key = p_external_idempotency_key
    LIMIT 1;
    IF FOUND THEN
      IF v_existing_run.payload_hash <> p_payload_hash THEN
        RAISE EXCEPTION 'COLLECTION_IDEMPOTENCY_CONFLICT';
      END IF;
      RETURN jsonb_build_object(
        'accepted', TRUE, 'duplicate', TRUE, 'ingestionId', v_existing_run.id,
        'status', v_existing_run.status
      );
    END IF;
  END IF;

  INSERT INTO collections.ingestion_runs (
    aces_id, source_connection_id, external_idempotency_key, payload_hash,
    mode, scope, status, received_count, started_at
  ) VALUES (
    v_connection.aces_id, v_connection.id, NULLIF(trim(COALESCE(p_external_idempotency_key, '')), ''),
    p_payload_hash, p_mode, COALESCE(p_scope, '{}'::jsonb), 'processing',
    jsonb_array_length(p_records), now()
  ) RETURNING id INTO v_run_id;

  FOR v_record IN SELECT value FROM jsonb_array_elements(p_records)
  LOOP
    v_received := v_received + 1;
    v_source_updated_at := (v_record->'source'->>'sourceUpdatedAt')::timestamptz;
    v_financial_status := v_record->'receivable'->>'status';

    INSERT INTO collections.cases (
      aces_id, source_connection_id, external_customer_id, creditor_external_id,
      customer_name, customer_phone, customer_document, creditor_name,
      creditor_document, last_source_update_at
    ) VALUES (
      v_connection.aces_id, v_connection.id,
      v_record->'customer'->>'externalId', v_record->'creditor'->>'externalId',
      v_record->'customer'->>'name', v_record->'customer'->>'phone',
      NULLIF(v_record->'customer'->>'document', ''), NULLIF(v_record->'creditor'->>'name', ''),
      NULLIF(v_record->'creditor'->>'document', ''), v_source_updated_at
    )
    ON CONFLICT (source_connection_id, external_customer_id, creditor_external_id)
    DO UPDATE SET
      customer_name = EXCLUDED.customer_name,
      customer_phone = EXCLUDED.customer_phone,
      customer_document = EXCLUDED.customer_document,
      creditor_name = EXCLUDED.creditor_name,
      creditor_document = EXCLUDED.creditor_document,
      last_source_update_at = GREATEST(collections.cases.last_source_update_at, EXCLUDED.last_source_update_at),
      source_freshness = 'fresh',
      updated_at = now()
    RETURNING id INTO v_case_id;

    SELECT * INTO v_existing
    FROM collections.receivables
    WHERE source_connection_id = v_connection.id
      AND external_receivable_id = v_record->'receivable'->>'externalId'
    FOR UPDATE;

    IF FOUND AND v_existing.source_updated_at > v_source_updated_at THEN
      v_unchanged := v_unchanged + 1;
      INSERT INTO collections.ingestion_items (
        aces_id, ingestion_run_id, row_number, external_receivable_id,
        status, error_code, error_message, payload_hash
      ) VALUES (
        v_connection.aces_id, v_run_id, v_received,
        v_record->'receivable'->>'externalId', 'unchanged', 'stale_event',
        'Evento anterior ao estado atual', encode(extensions.digest(v_record::text, 'sha256'), 'hex')
      );
      CONTINUE;
    END IF;

    v_payment_data := CASE
      WHEN COALESCE((v_connection.capabilities->>'suppliesPaymentInstructions')::boolean, FALSE)
        THEN jsonb_strip_nulls(jsonb_build_object(
          'pixKey', NULLIF(v_record->'payment'->>'pixKey', ''),
          'paymentUrl', NULLIF(v_record->'payment'->>'paymentUrl', ''),
          'expiresAt', NULLIF(v_record->'payment'->>'expiresAt', '')
        ))
      ELSE '{}'::jsonb
    END;

    INSERT INTO collections.receivables (
      aces_id, source_connection_id, case_id, external_receivable_id,
      external_customer_id, creditor_external_id, description, original_amount,
      remaining_amount, currency, due_date, financial_status, record_status,
      payment_method, trusted_payment_data, source_updated_at, last_seen_ingestion_id,
      last_seen_at, canonical_hash, source_metadata
    ) VALUES (
      v_connection.aces_id, v_connection.id, v_case_id,
      v_record->'receivable'->>'externalId', v_record->'customer'->>'externalId',
      v_record->'creditor'->>'externalId', NULLIF(v_record->'receivable'->>'description', ''),
      NULLIF(v_record->'receivable'->>'originalAmount', '')::numeric,
      (v_record->'receivable'->>'remainingAmount')::numeric,
      upper(v_record->'receivable'->>'currency'),
      (v_record->'receivable'->>'dueDate')::date, v_financial_status, 'current',
      NULLIF(v_record->'payment'->>'method', ''), v_payment_data,
      v_source_updated_at, v_run_id, now(), encode(extensions.digest(v_record::text, 'sha256'), 'hex'),
      COALESCE(v_record->'metadata', '{}'::jsonb)
    )
    ON CONFLICT (source_connection_id, external_receivable_id)
    DO UPDATE SET
      case_id = EXCLUDED.case_id,
      external_customer_id = EXCLUDED.external_customer_id,
      creditor_external_id = EXCLUDED.creditor_external_id,
      description = EXCLUDED.description,
      original_amount = EXCLUDED.original_amount,
      remaining_amount = EXCLUDED.remaining_amount,
      currency = EXCLUDED.currency,
      due_date = EXCLUDED.due_date,
      financial_status = EXCLUDED.financial_status,
      record_status = 'current',
      payment_method = EXCLUDED.payment_method,
      trusted_payment_data = EXCLUDED.trusted_payment_data,
      source_updated_at = EXCLUDED.source_updated_at,
      last_seen_ingestion_id = EXCLUDED.last_seen_ingestion_id,
      last_seen_at = now(),
      canonical_hash = EXCLUDED.canonical_hash,
      source_metadata = EXCLUDED.source_metadata,
      updated_at = now();

    IF v_existing.id IS NULL THEN v_created := v_created + 1;
    ELSE v_updated := v_updated + 1;
    END IF;

    INSERT INTO collections.ingestion_items (
      aces_id, ingestion_run_id, row_number, external_receivable_id, status, payload_hash
    ) VALUES (
      v_connection.aces_id, v_run_id, v_received,
      v_record->'receivable'->>'externalId', 'accepted', encode(extensions.digest(v_record::text, 'sha256'), 'hex')
    );
  END LOOP;

  IF p_mode = 'snapshot' THEN
    WITH changed AS (
      UPDATE collections.receivables
      SET record_status = 'not_present', updated_at = now()
      WHERE source_connection_id = v_connection.id
        AND record_status = 'current'
        AND last_seen_ingestion_id IS DISTINCT FROM v_run_id
        AND (v_creditor_scope IS NULL OR creditor_external_id = v_creditor_scope)
      RETURNING id
    ) SELECT count(*) INTO v_not_present FROM changed;
  END IF;

  UPDATE collections.cases c
  SET
    total_open_amount = aggregate.total_open_amount,
    open_receivables_count = aggregate.open_receivables_count,
    oldest_due_date = aggregate.oldest_due_date,
    newest_due_date = aggregate.newest_due_date,
    most_overdue_days = aggregate.most_overdue_days,
    source_freshness = CASE WHEN aggregate.open_receivables_count > 0 THEN 'fresh' ELSE c.source_freshness END,
    communication_status = CASE
      WHEN c.communication_status IN ('paused', 'in_service', 'error') THEN c.communication_status
      WHEN aggregate.open_receivables_count > 0 THEN 'eligible'
      ELSE 'completed'
    END,
    updated_at = now()
  FROM (
    SELECT
      c2.id,
      COALESCE(sum(r.remaining_amount) FILTER (
        WHERE r.financial_status = 'open' AND r.record_status = 'current'
      ), 0)::numeric(18,2) AS total_open_amount,
      count(r.id) FILTER (
        WHERE r.financial_status = 'open' AND r.record_status = 'current'
      )::integer AS open_receivables_count,
      min(r.due_date) FILTER (
        WHERE r.financial_status = 'open' AND r.record_status = 'current'
      ) AS oldest_due_date,
      max(r.due_date) FILTER (
        WHERE r.financial_status = 'open' AND r.record_status = 'current'
      ) AS newest_due_date,
      max(GREATEST(current_date - r.due_date, 0)) FILTER (
        WHERE r.financial_status = 'open' AND r.record_status = 'current'
      )::integer AS most_overdue_days
    FROM collections.cases c2
    LEFT JOIN collections.receivables r ON r.case_id = c2.id
    WHERE c2.source_connection_id = v_connection.id
      AND (v_creditor_scope IS NULL OR c2.creditor_external_id = v_creditor_scope)
    GROUP BY c2.id
  ) aggregate
  WHERE c.id = aggregate.id;

  INSERT INTO collections.outbox (
    aces_id, topic, aggregate_type, aggregate_id, idempotency_key, payload
  )
  SELECT
    c.aces_id, 'case.reevaluate', 'collection_case', c.id,
    'ingestion:' || v_run_id::text || ':case:' || c.id::text,
    jsonb_build_object('ingestionId', v_run_id, 'caseId', c.id)
  FROM collections.cases c
  WHERE c.source_connection_id = v_connection.id
    AND (v_creditor_scope IS NULL OR c.creditor_external_id = v_creditor_scope)
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT count(*) INTO v_affected
  FROM collections.cases c
  WHERE c.source_connection_id = v_connection.id
    AND (v_creditor_scope IS NULL OR c.creditor_external_id = v_creditor_scope);

  UPDATE collections.ingestion_runs
  SET status = 'succeeded', accepted_count = v_created + v_updated,
      created_count = v_created, updated_count = v_updated,
      unchanged_count = v_unchanged, not_present_count = v_not_present,
      affected_cases_count = v_affected, completed_at = now()
  WHERE id = v_run_id;

  UPDATE collections.source_connections
  SET last_received_at = now(), last_success_at = now(),
      last_error_at = NULL, last_error_code = NULL, updated_at = now()
  WHERE id = v_connection.id;

  RETURN jsonb_build_object(
    'accepted', TRUE, 'duplicate', FALSE, 'ingestionId', v_run_id,
    'status', 'succeeded', 'receivedCount', v_received,
    'createdCount', v_created, 'updatedCount', v_updated,
    'unchangedCount', v_unchanged, 'notPresentCount', v_not_present,
    'affectedCasesCount', v_affected
  );
EXCEPTION WHEN OTHERS THEN
  IF v_run_id IS NOT NULL THEN
    UPDATE collections.ingestion_runs
    SET status = 'failed', error_summary = jsonb_build_object('code', SQLSTATE, 'message', SQLERRM),
        completed_at = now()
    WHERE id = v_run_id;
  END IF;
  UPDATE collections.source_connections
  SET last_error_at = now(), last_error_code = SQLSTATE, updated_at = now()
  WHERE id = p_source_connection_id;
  RETURN jsonb_build_object(
    'accepted', FALSE, 'duplicate', FALSE, 'ingestionId', v_run_id,
    'status', 'failed', 'errorCode', SQLSTATE, 'errorMessage', SQLERRM
  );
END;
$$;

CREATE OR REPLACE FUNCTION collections.claim_outbox(
  p_worker_id text,
  p_limit integer DEFAULT 50,
  p_lease_seconds integer DEFAULT 120
)
RETURNS SETOF collections.outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id FROM collections.outbox
    WHERE (
      status = 'pending'
      OR (status = 'processing' AND locked_at < now() - make_interval(secs => GREATEST(p_lease_seconds, 30)))
    )
      AND available_at <= now()
    ORDER BY available_at, created_at, id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE collections.outbox o
  SET status = 'processing', locked_at = now(), locked_by = p_worker_id,
      attempt_count = o.attempt_count + 1
  FROM candidates c
  WHERE o.id = c.id
  RETURNING o.*;
END;
$$;

CREATE OR REPLACE FUNCTION collections.complete_outbox(p_id uuid, p_worker_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE collections.outbox
  SET status = 'processed', processed_at = now(), locked_at = NULL, locked_by = NULL, last_error = NULL
  WHERE id = p_id AND status = 'processing' AND locked_by = p_worker_id
  RETURNING TRUE;
$$;

CREATE OR REPLACE FUNCTION collections.fail_outbox(
  p_id uuid,
  p_worker_id text,
  p_error text,
  p_retry_seconds integer DEFAULT 60,
  p_max_attempts integer DEFAULT 8
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE collections.outbox
  SET status = CASE WHEN attempt_count >= GREATEST(p_max_attempts, 1) THEN 'failed' ELSE 'pending' END,
      available_at = CASE WHEN attempt_count >= GREATEST(p_max_attempts, 1)
        THEN available_at ELSE now() + make_interval(secs => GREATEST(p_retry_seconds, 5)) END,
      locked_at = NULL, locked_by = NULL, last_error = left(p_error, 2000)
  WHERE id = p_id AND status = 'processing' AND locked_by = p_worker_id
  RETURNING TRUE;
$$;

CREATE OR REPLACE FUNCTION collections.get_collection_context(
  p_lead_id uuid,
  p_case_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'hasOpenReceivables', EXISTS (
      SELECT 1 FROM collections.cases cx
      WHERE cx.lead_id = p_lead_id AND cx.open_receivables_count > 0
        AND (p_case_id IS NULL OR cx.id = p_case_id)
    ),
    'freshness', CASE
      WHEN bool_and(c.source_freshness = 'fresh') THEN 'fresh'
      WHEN bool_or(c.source_freshness = 'stale') THEN 'stale'
      ELSE 'unknown'
    END,
    'cases', COALESCE(jsonb_agg(jsonb_build_object(
      'caseId', c.id,
      'sourceConnectionId', c.source_connection_id,
      'communicationStatus', c.communication_status,
      'freshness', c.source_freshness,
      'customer', jsonb_build_object('name', c.customer_name, 'phone', c.customer_phone),
      'creditor', jsonb_strip_nulls(jsonb_build_object('name', c.creditor_name, 'document', c.creditor_document)),
      'totalOpenAmount', c.total_open_amount::text,
      'currency', COALESCE((SELECT r.currency FROM collections.receivables r
        WHERE r.case_id = c.id AND r.financial_status = 'open' AND r.record_status = 'current'
        ORDER BY r.due_date, r.id LIMIT 1), 'BRL'),
      'openReceivablesCount', c.open_receivables_count,
      'oldestDueDate', c.oldest_due_date,
      'mostOverdueDays', c.most_overdue_days,
      'payment', COALESCE((SELECT jsonb_strip_nulls(jsonb_build_object(
          'method', r.payment_method,
          'pixKey', r.trusted_payment_data->>'pixKey',
          'paymentUrl', r.trusted_payment_data->>'paymentUrl',
          'expiresAt', r.trusted_payment_data->>'expiresAt'
        )) FROM collections.receivables r
        WHERE r.case_id = c.id AND r.financial_status = 'open' AND r.record_status = 'current'
        ORDER BY r.due_date, r.id LIMIT 1), '{}'::jsonb),
      'receivables', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', r.id, 'externalId', r.external_receivable_id,
          'description', r.description, 'remainingAmount', r.remaining_amount::text,
          'currency', r.currency, 'dueDate', r.due_date, 'financialStatus', r.financial_status
        ) ORDER BY r.due_date, r.id)
        FROM collections.receivables r
        WHERE r.case_id = c.id AND r.financial_status = 'open' AND r.record_status = 'current'
      ), '[]'::jsonb)
    ) ORDER BY c.created_at), '[]'::jsonb)
  )
  FROM collections.cases c
  WHERE c.lead_id = p_lead_id
    AND (p_case_id IS NULL OR c.id = p_case_id);
$$;

CREATE OR REPLACE FUNCTION collections.enroll_collection_case(
  p_case_id uuid,
  p_journey_rule_id uuid,
  p_decision_key text,
  p_anchor_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_case collections.cases%ROWTYPE;
  v_rule collections.journey_rules%ROWTYPE;
  v_funnel crm.automation_funnels%ROWTYPE;
  v_enrollment_id uuid;
  v_scheduled integer := 0;
BEGIN
  SELECT * INTO v_case FROM collections.cases WHERE id = p_case_id FOR UPDATE;
  SELECT * INTO v_rule FROM collections.journey_rules WHERE id = p_journey_rule_id AND is_active IS TRUE;
  IF v_case.id IS NULL OR v_rule.id IS NULL OR v_case.aces_id <> v_rule.aces_id THEN
    RETURN jsonb_build_object('scheduled', 0, 'reason', 'case_or_rule_not_found');
  END IF;
  IF v_case.lead_id IS NULL OR v_case.communication_status <> 'eligible'
     OR v_case.source_freshness <> 'fresh' OR v_case.open_receivables_count <= 0 THEN
    RETURN jsonb_build_object('scheduled', 0, 'reason', 'case_not_eligible');
  END IF;
  IF COALESCE((SELECT active_dispatcher FROM collections.runtime_controls WHERE aces_id = v_case.aces_id), 'legacy_rb') <> 'canonical' THEN
    RETURN jsonb_build_object('scheduled', 0, 'reason', 'canonical_dispatcher_inactive');
  END IF;
  IF EXISTS (SELECT 1 FROM collections.journey_source_bindings WHERE journey_rule_id = v_rule.id)
     AND NOT EXISTS (SELECT 1 FROM collections.journey_source_bindings
       WHERE journey_rule_id = v_rule.id AND source_connection_id = v_case.source_connection_id) THEN
    RETURN jsonb_build_object('scheduled', 0, 'reason', 'source_not_bound');
  END IF;

  SELECT * INTO v_funnel FROM crm.automation_funnels
  WHERE id = v_rule.funnel_id AND aces_id = v_case.aces_id
    AND entry_source = 'collection' AND is_active IS TRUE;
  IF v_funnel.id IS NULL THEN
    RETURN jsonb_build_object('scheduled', 0, 'reason', 'funnel_not_available');
  END IF;

  INSERT INTO crm.automation_enrollments (
    aces_id, funnel_id, lead_id, status, anchor_event, anchor_at,
    current_stage_id, reply_target_stage_id, last_evaluated_at,
    source_collection_case_id, source_collection_decision_key
  ) VALUES (
    v_case.aces_id, v_funnel.id, v_case.lead_id, 'active', 'collection_eligible_at',
    p_anchor_at, NULL, v_funnel.reply_target_stage_id, now(), v_case.id, p_decision_key
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_enrollment_id;

  IF v_enrollment_id IS NULL THEN
    RETURN jsonb_build_object('scheduled', 0, 'reason', 'duplicate_decision');
  END IF;
  v_scheduled := crm.schedule_enrollment_executions(v_enrollment_id);
  IF v_scheduled > 0 THEN
    UPDATE collections.cases SET communication_status = 'scheduled', updated_at = now()
    WHERE id = v_case.id;
  END IF;
  RETURN jsonb_build_object('scheduled', v_scheduled, 'enrollmentId', v_enrollment_id);
END;
$$;

CREATE OR REPLACE FUNCTION collections.cancel_pending_for_case(p_case_id uuid, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE crm.automation_executions
  SET status = 'cancelled', cancelled_at = now(), completed_reason = p_reason,
      last_error = p_reason, updated_at = now()
  WHERE source_collection_case_id = p_case_id AND status = 'pending';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE crm.automation_enrollments
  SET status = 'cancelled', stopped_reason = p_reason, updated_at = now()
  WHERE source_collection_case_id = p_case_id AND status = 'active';
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION collections.cancel_collection_execution(p_execution_id uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_case_id uuid;
BEGIN
  UPDATE crm.automation_executions
  SET status = 'cancelled', cancelled_at = now(), completed_reason = p_reason,
      last_error = p_reason, claimed_by = NULL, updated_at = now()
  WHERE id = p_execution_id AND source_collection_case_id IS NOT NULL
    AND status IN ('pending', 'processing')
  RETURNING source_collection_case_id INTO v_case_id;
  IF v_case_id IS NULL THEN RETURN FALSE; END IF;
  UPDATE crm.automation_enrollments
  SET status = 'cancelled', stopped_reason = p_reason, updated_at = now()
  WHERE source_collection_case_id = v_case_id AND status = 'active';
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION collections.get_execution_dispatch_context(p_execution_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_execution crm.automation_executions%ROWTYPE;
  v_case collections.cases%ROWTYPE;
  v_source collections.source_connections%ROWTYPE;
  v_context jsonb;
BEGIN
  SELECT * INTO v_execution FROM crm.automation_executions WHERE id = p_execution_id;
  IF v_execution.source_collection_case_id IS NULL THEN
    RETURN jsonb_build_object('collection', FALSE, 'action', 'continue');
  END IF;
  SELECT * INTO v_case FROM collections.cases WHERE id = v_execution.source_collection_case_id;
  SELECT * INTO v_source FROM collections.source_connections WHERE id = v_case.source_connection_id;
  IF v_case.id IS NULL OR v_source.id IS NULL
     OR v_source.status <> 'active' OR v_case.source_freshness <> 'fresh'
     OR v_case.communication_status IN ('paused', 'in_service', 'completed', 'stale', 'error')
     OR v_case.open_receivables_count <= 0
     OR EXISTS (SELECT 1 FROM crm.leads l WHERE l.id = v_case.lead_id
       AND (l.view IS DISTINCT FROM TRUE OR lower(btrim(COALESCE(l.status::text, ''))) IN ('atendimento', 'em atendimento')))
     OR EXISTS (SELECT 1 FROM agents.ai_lead_state als WHERE als.lead_id = v_case.lead_id
       AND (als.manual_ai_enabled IS FALSE OR als.status = 'paused' OR als.freeze_until > now()))
     OR COALESCE((SELECT active_dispatcher FROM collections.runtime_controls WHERE aces_id = v_case.aces_id), 'legacy_rb') <> 'canonical' THEN
    RETURN jsonb_build_object('collection', TRUE, 'action', 'cancel', 'reason', 'collection_case_not_eligible');
  END IF;
  v_context := collections.get_collection_context(v_case.lead_id, v_case.id);
  RETURN jsonb_build_object('collection', TRUE, 'action', 'continue', 'caseId', v_case.id,
    'timezone', v_source.timezone, 'context', v_context);
END;
$$;

CREATE OR REPLACE FUNCTION collections.reserve_collection_dispatch(p_execution_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_execution crm.automation_executions%ROWTYPE;
  v_case collections.cases%ROWTYPE;
  v_source collections.source_connections%ROWTYPE;
  v_phone_hash text;
  v_local_date date;
  v_existing collections.contact_daily_dispatches%ROWTYPE;
  v_decision_key text;
  v_defer_until timestamptz;
BEGIN
  SELECT * INTO v_execution FROM crm.automation_executions WHERE id = p_execution_id FOR UPDATE;
  IF v_execution.source_collection_case_id IS NULL THEN
    RETURN jsonb_build_object('reserved', TRUE, 'collection', FALSE);
  END IF;
  SELECT * INTO v_case FROM collections.cases WHERE id = v_execution.source_collection_case_id;
  SELECT * INTO v_source FROM collections.source_connections WHERE id = v_case.source_connection_id;
  v_phone_hash := encode(extensions.digest(regexp_replace(v_case.customer_phone, '[^0-9]', '', 'g'), 'sha256'), 'hex');
  v_local_date := (now() AT TIME ZONE v_source.timezone)::date;
  v_decision_key := COALESCE((SELECT source_collection_decision_key FROM crm.automation_enrollments
    WHERE id = v_execution.enrollment_id), 'execution:' || p_execution_id::text);

  SELECT * INTO v_existing FROM collections.contact_daily_dispatches
  WHERE aces_id = v_case.aces_id AND normalized_phone_hash = v_phone_hash AND local_date = v_local_date;
  IF FOUND THEN
    IF v_existing.execution_id = p_execution_id THEN
      RETURN jsonb_build_object('reserved', TRUE, 'collection', TRUE, 'duplicate', TRUE);
    END IF;
    v_defer_until := ((v_local_date + 1)::date + time '09:00') AT TIME ZONE v_source.timezone;
    RETURN jsonb_build_object('reserved', FALSE, 'collection', TRUE,
      'reason', 'deferred_contact_daily_limit', 'deferUntil', v_defer_until);
  END IF;

  INSERT INTO collections.contact_daily_dispatches (
    aces_id, normalized_phone_hash, local_date, case_id, execution_id, decision_key
  ) VALUES (
    v_case.aces_id, v_phone_hash, v_local_date, v_case.id, p_execution_id, v_decision_key
  );
  RETURN jsonb_build_object('reserved', TRUE, 'collection', TRUE, 'duplicate', FALSE);
EXCEPTION WHEN unique_violation THEN
  v_defer_until := ((v_local_date + 1)::date + time '09:00') AT TIME ZONE v_source.timezone;
  RETURN jsonb_build_object('reserved', FALSE, 'collection', TRUE,
    'reason', 'deferred_contact_daily_limit', 'deferUntil', v_defer_until);
END;
$$;

CREATE OR REPLACE FUNCTION collections.mark_collection_dispatch_sent(p_execution_id uuid, p_sent_at timestamptz)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE collections.contact_daily_dispatches SET sent_at = p_sent_at
  WHERE execution_id = p_execution_id RETURNING TRUE;
$$;

CREATE OR REPLACE FUNCTION collections.list_eligible_decisions(p_limit integer DEFAULT 500)
RETURNS TABLE (
  case_id uuid,
  aces_id integer,
  source_connection_id uuid,
  journey_rule_id uuid,
  funnel_id uuid,
  customer_phone text,
  priority integer,
  most_overdue_days integer,
  total_open_amount numeric,
  local_date date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT ON (c.id, jr.id)
    c.id, c.aces_id, c.source_connection_id, jr.id, jr.funnel_id,
    c.customer_phone, jr.priority, COALESCE(c.most_overdue_days, 0),
    c.total_open_amount, (now() AT TIME ZONE sc.timezone)::date
  FROM collections.cases c
  JOIN collections.source_connections sc ON sc.id = c.source_connection_id AND sc.status = 'active'
  JOIN collections.receivables r ON r.case_id = c.id
    AND r.record_status = 'current' AND r.financial_status = 'open'
  JOIN collections.journey_rules jr ON jr.aces_id = c.aces_id AND jr.is_active IS TRUE
    AND (jr.currency IS NULL OR jr.currency = r.currency)
    AND (jsonb_array_length(jr.payment_methods) = 0 OR jr.payment_methods ? COALESCE(r.payment_method, ''))
    AND jr.financial_statuses ? r.financial_status
    AND (
      (jr.timing_relation = 'before_due' AND r.due_date - (now() AT TIME ZONE sc.timezone)::date = jr.days_offset)
      OR (jr.timing_relation = 'on_due' AND r.due_date = (now() AT TIME ZONE sc.timezone)::date)
      OR (jr.timing_relation = 'after_due' AND (now() AT TIME ZONE sc.timezone)::date - r.due_date = jr.days_offset)
    )
  JOIN crm.automation_funnels f ON f.id = jr.funnel_id AND f.entry_source = 'collection' AND f.is_active IS TRUE
  JOIN collections.runtime_controls rc ON rc.aces_id = c.aces_id AND rc.active_dispatcher = 'canonical'
  WHERE c.communication_status = 'eligible' AND c.source_freshness = 'fresh'
    AND c.lead_id IS NOT NULL
    AND (
      NOT EXISTS (SELECT 1 FROM collections.journey_source_bindings jsb WHERE jsb.journey_rule_id = jr.id)
      OR EXISTS (SELECT 1 FROM collections.journey_source_bindings jsb
        WHERE jsb.journey_rule_id = jr.id AND jsb.source_connection_id = c.source_connection_id)
    )
  ORDER BY c.id, jr.id, r.due_date, r.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 5000);
$$;

CREATE OR REPLACE FUNCTION collections.mark_stale_sources()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_count integer;
BEGIN
  WITH stale_connections AS (
    SELECT id FROM collections.source_connections
    WHERE status = 'active'
      AND COALESCE(last_success_at, created_at) < now() - make_interval(mins => stale_after_minutes)
  ), changed_cases AS (
    UPDATE collections.cases c
    SET source_freshness = 'stale', communication_status = CASE
      WHEN communication_status IN ('paused', 'in_service', 'error') THEN communication_status ELSE 'stale' END,
      updated_at = now()
    WHERE c.source_connection_id IN (SELECT id FROM stale_connections)
      AND c.source_freshness <> 'stale'
    RETURNING c.id, c.aces_id
  ), changed_receivables AS (
    UPDATE collections.receivables r
    SET record_status = 'stale', updated_at = now()
    WHERE r.case_id IN (SELECT id FROM changed_cases) AND r.record_status = 'current'
    RETURNING r.id
  )
  SELECT count(*) INTO v_count FROM changed_cases;

  PERFORM collections.cancel_pending_for_case(c.id, 'Fonte de cobranca desatualizada')
  FROM collections.cases c WHERE c.source_freshness = 'stale';
  RETURN v_count;
END;
$$;

-- Collection-aware progress: calendar events and collection cases are both
-- enrollment-scoped. Traditional stage journeys remain lead-scoped.
CREATE OR REPLACE FUNCTION crm.find_next_enrollment_step(p_enrollment_id uuid)
RETURNS TABLE(
  step_id uuid, is_active boolean, step_position integer, delay_minutes integer,
  message_template text, step_rule jsonb, label text, created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_is_scoped boolean := FALSE;
BEGIN
  SELECT * INTO v_enrollment FROM crm.automation_enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_is_scoped := v_enrollment.source_calendar_event_id IS NOT NULL
    OR v_enrollment.source_collection_case_id IS NOT NULL;
  RETURN QUERY
  SELECT s.id, s.is_active, s.position, s.delay_minutes, s.message_template,
    s.step_rule, s.label, s.created_at
  FROM crm.automation_steps s
  WHERE s.funnel_id = v_enrollment.funnel_id
    AND NOT EXISTS (
      SELECT 1 FROM crm.automation_step_progress asp
      WHERE asp.step_id = s.id AND (
        (v_is_scoped AND asp.enrollment_id = v_enrollment.id)
        OR (NOT v_is_scoped AND asp.enrollment_id IS NULL
          AND asp.funnel_id = v_enrollment.funnel_id AND asp.lead_id = v_enrollment.lead_id)
      )
    )
  ORDER BY s.position, s.created_at
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_complete_automation_execution(
  p_execution_id uuid,
  p_rendered_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_execution crm.automation_executions%ROWTYPE;
  v_sent_at timestamptz := now();
  v_scheduled integer := 0;
  v_is_scoped boolean := FALSE;
BEGIN
  SELECT * INTO v_execution FROM crm.automation_executions
  WHERE id = p_execution_id AND status = 'processing';
  IF NOT FOUND THEN RAISE EXCEPTION 'Execucao nao encontrada para conclusao'; END IF;
  UPDATE crm.automation_executions SET status = 'sent', sent_at = v_sent_at,
    rendered_message = COALESCE(p_rendered_message, rendered_message), completed_reason = 'sent',
    attempt_count = attempt_count + 1, updated_at = now() WHERE id = v_execution.id;
  v_is_scoped := v_execution.enrollment_id IS NOT NULL AND
    (v_execution.source_calendar_event_id IS NOT NULL OR v_execution.source_collection_case_id IS NOT NULL);

  IF v_execution.funnel_id IS NOT NULL AND v_execution.step_id IS NOT NULL THEN
    IF v_is_scoped THEN
      INSERT INTO crm.automation_step_progress (
        aces_id, funnel_id, lead_id, step_id, enrollment_id, sent_execution_id, first_sent_at
      ) VALUES (
        v_execution.aces_id, v_execution.funnel_id, v_execution.lead_id, v_execution.step_id,
        v_execution.enrollment_id, v_execution.id, v_sent_at
      ) ON CONFLICT (enrollment_id, step_id) WHERE enrollment_id IS NOT NULL DO UPDATE
      SET first_sent_at = LEAST(crm.automation_step_progress.first_sent_at, EXCLUDED.first_sent_at),
          sent_execution_id = COALESCE(crm.automation_step_progress.sent_execution_id, EXCLUDED.sent_execution_id),
          updated_at = now();
    ELSE
      INSERT INTO crm.automation_step_progress (
        aces_id, funnel_id, lead_id, step_id, sent_execution_id, first_sent_at
      ) VALUES (
        v_execution.aces_id, v_execution.funnel_id, v_execution.lead_id, v_execution.step_id,
        v_execution.id, v_sent_at
      ) ON CONFLICT (funnel_id, lead_id, step_id) WHERE enrollment_id IS NULL DO UPDATE
      SET first_sent_at = LEAST(crm.automation_step_progress.first_sent_at, EXCLUDED.first_sent_at),
          sent_execution_id = COALESCE(crm.automation_step_progress.sent_execution_id, EXCLUDED.sent_execution_id),
          updated_at = now();
    END IF;
  END IF;

  IF v_execution.funnel_id IS NOT NULL AND COALESCE(v_execution.instance_snapshot, '') <> '' THEN
    PERFORM crm.recalculate_automation_funnel_dispatch_state(
      v_execution.aces_id, v_execution.funnel_id, v_execution.instance_snapshot
    );
  END IF;
  IF v_execution.enrollment_id IS NOT NULL THEN
    v_scheduled := crm.schedule_enrollment_executions(v_execution.enrollment_id);
    UPDATE crm.automation_enrollments SET last_evaluated_at = now(), updated_at = now()
    WHERE id = v_execution.enrollment_id AND status = 'active';
  END IF;
  IF v_execution.source_collection_case_id IS NOT NULL AND v_scheduled = 0 THEN
    UPDATE collections.cases
    SET communication_status = CASE
          WHEN source_freshness = 'fresh' AND open_receivables_count > 0 THEN 'eligible'
          WHEN source_freshness <> 'fresh' THEN 'stale'
          ELSE 'completed'
        END,
        updated_at = now()
    WHERE id = v_execution.source_collection_case_id
      AND communication_status = 'scheduled';
  END IF;
  RETURN jsonb_build_object('success', TRUE, 'scheduled', v_scheduled);
END;
$$;

-- Provider-neutral tool. Secrets and connections are relational, never stored
-- inside the tool JSON config.
INSERT INTO agents.tool_definitions (
  tool_key, version, display_name, description, icon, config_schema, is_active
) VALUES (
  'collection_orchestration', 1, 'Cobranca',
  'Orquestra cobrancas a partir de fontes financeiras conectadas.', 'wallet-cards',
  '{"type":"object","properties":{},"additionalProperties":false}'::jsonb, TRUE
)
ON CONFLICT (tool_key, version) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  config_schema = EXCLUDED.config_schema,
  is_active = TRUE,
  updated_at = now();

-- Private storage bucket. Uploads are issued by the backend with service-role
-- signed URLs; no browser role receives direct object grants.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'collection-imports', 'collection-imports', FALSE, 20971520,
  ARRAY[
    'text/csv', 'application/csv', 'text/plain',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = FALSE, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types, updated_at = now();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA collections FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION collections.ingest_envelope(uuid, text, text, text, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION collections.claim_outbox(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION collections.complete_outbox(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION collections.fail_outbox(uuid, text, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION collections.get_collection_context(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION collections.enroll_collection_case(uuid, uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION collections.cancel_pending_for_case(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION collections.cancel_collection_execution(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION collections.get_execution_dispatch_context(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION collections.reserve_collection_dispatch(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION collections.mark_collection_dispatch_sent(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION collections.list_eligible_decisions(integer) TO service_role;
GRANT EXECUTE ON FUNCTION collections.mark_stale_sources() TO service_role;

COMMENT ON SCHEMA collections IS
  'Provider-neutral collection orchestration. Financial truth remains owned by source systems.';
COMMENT ON COLUMN collections.receivables.financial_status IS
  'Explicit source-owned status. Absence from an incremental feed never changes it to settled.';
COMMENT ON COLUMN collections.receivables.record_status IS
  'Core observation status, deliberately separate from financial_status.';
