-- Load the production chat list with one bounded database query instead of
-- sending hundreds of ids back to PostgREST in follow-up requests.
CREATE OR REPLACE FUNCTION crm.rpc_list_customer_conversations(p_aces_id integer)
RETURNS TABLE(
  conversation_id uuid,
  aces_id integer,
  lead_id uuid,
  connection_id uuid,
  interaction_mode text,
  conversation_status text,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_message_preview text,
  conversation_created_at timestamptz,
  lead_name text,
  lead_email text,
  lead_phone text,
  lead_source text,
  lead_stage_id uuid,
  lead_owner_id uuid,
  lead_status text,
  connection_channel_type text,
  connection_provider text,
  connection_display_name text,
  connection_instance_name text,
  connection_capability text,
  connection_status text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    conversation.id,
    conversation.aces_id,
    conversation.lead_id,
    conversation.connection_id,
    conversation.interaction_mode,
    conversation.status,
    conversation.last_message_at,
    conversation.last_inbound_at,
    conversation.last_message_preview,
    conversation.created_at,
    lead.name::text,
    lead.email,
    lead.contact_phone::text,
    lead."Fonte",
    lead.stage_id,
    lead.owner_id,
    lead.status::text,
    connection.channel_type,
    connection.provider,
    connection.display_name,
    connection.legacy_instance_name,
    connection.capability,
    connection.status
  FROM crm.customer_conversations AS conversation
  JOIN crm.leads AS lead
    ON lead.id = conversation.lead_id
   AND lead.aces_id = conversation.aces_id
   AND lead.view IS TRUE
  JOIN crm.messaging_connections AS connection
    ON connection.id = conversation.connection_id
   AND connection.aces_id = conversation.aces_id
  WHERE conversation.aces_id = p_aces_id
    AND conversation.status = 'active'
  ORDER BY
    conversation.last_message_at DESC NULLS LAST,
    conversation.created_at DESC,
    conversation.id DESC;
$$;

REVOKE ALL ON FUNCTION crm.rpc_list_customer_conversations(integer)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.rpc_list_customer_conversations(integer)
  TO service_role;

COMMENT ON FUNCTION crm.rpc_list_customer_conversations(integer) IS
  'Service-role-only projection used by the CRM backend to list active chat conversations in one query.';

-- Keep the RLS-aware authorization boundary exposed in crm, while doing the
-- expensive aggregation in a non-exposed helper after access is validated.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticator;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.get_customer_conversation_unread_counts()
RETURNS TABLE(conversation_id uuid, unread_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH caller_context AS MATERIALIZED (
    SELECT
      auth.uid() AS auth_user_id,
      public.current_aces_id() AS aces_id,
      public.current_crm_user_id() AS crm_user_id,
      crm.current_user_is_account_admin() AS is_admin
  ),
  accessible_conversations AS MATERIALIZED (
    SELECT conversation.id
    FROM crm.customer_conversations AS conversation
    CROSS JOIN caller_context AS context
    WHERE context.auth_user_id IS NOT NULL
      AND context.aces_id IS NOT NULL
      AND context.crm_user_id IS NOT NULL
      AND conversation.aces_id = context.aces_id
      AND conversation.status = 'active'
      AND (
        context.is_admin
        OR crm.current_user_can_access_conversation(conversation.id)
      )
  )
  SELECT
    message.customer_conversation_id,
    count(*)::bigint
  FROM accessible_conversations AS conversation
  CROSS JOIN caller_context AS context
  JOIN crm.message_history AS message
    ON message.customer_conversation_id = conversation.id
   AND message.aces_id = context.aces_id
  LEFT JOIN crm.customer_conversation_read_states AS read_state
    ON read_state.conversation_id = conversation.id
   AND read_state.crm_user_id = context.crm_user_id
   AND read_state.aces_id = context.aces_id
  WHERE lower(message.direction) IN ('in', 'inbound')
    AND (
      read_state.last_read_at IS NULL
      OR message.sent_at > read_state.last_read_at
    )
  GROUP BY message.customer_conversation_id;
$$;

REVOKE ALL ON FUNCTION private.get_customer_conversation_unread_counts()
  FROM PUBLIC, anon, authenticator;
GRANT EXECUTE ON FUNCTION private.get_customer_conversation_unread_counts()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION crm.rpc_get_customer_conversation_unread_counts()
RETURNS TABLE(conversation_id uuid, unread_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT result.conversation_id, result.unread_count
  FROM private.get_customer_conversation_unread_counts() AS result;
$$;

REVOKE ALL ON FUNCTION crm.rpc_get_customer_conversation_unread_counts()
  FROM PUBLIC, anon, authenticator;
GRANT EXECUTE ON FUNCTION crm.rpc_get_customer_conversation_unread_counts()
  TO authenticated;

COMMENT ON FUNCTION crm.rpc_get_customer_conversation_unread_counts() IS
  'Returns unread counts only for conversations accessible to the authenticated CRM user.';
