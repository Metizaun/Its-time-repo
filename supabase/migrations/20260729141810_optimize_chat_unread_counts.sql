-- Keep unread-count scans on the account's inbound-message slice instead of
-- combining three independent indexes and evaluating old outbound rows.
CREATE INDEX IF NOT EXISTS idx_message_history_chat_unread
  ON crm.message_history(aces_id, sent_at, lead_id)
  WHERE lower(direction) IN ('in', 'inbound');

CREATE OR REPLACE FUNCTION crm.rpc_get_chat_unread_counts()
RETURNS TABLE(lead_id uuid, unread_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO crm, public
AS $$
  WITH request_context AS MATERIALIZED (
    SELECT
      public.current_aces_id() AS aces_id,
      public.current_crm_user_id() AS crm_user_id
  )
  SELECT
    mh.lead_id,
    count(*)::bigint AS unread_count
  FROM request_context AS context
  JOIN crm.message_history AS mh
    ON mh.aces_id = context.aces_id
  LEFT JOIN crm.chat_read_states AS rs
    ON rs.lead_id = mh.lead_id
   AND rs.crm_user_id = context.crm_user_id
  WHERE lower(mh.direction) IN ('in', 'inbound')
    AND mh.sent_at > GREATEST(
      COALESCE(rs.last_read_at, '-infinity'::timestamptz),
      timestamptz '2026-07-14 00:00:00-03'
    )
  GROUP BY mh.lead_id;
$$;

GRANT EXECUTE ON FUNCTION crm.rpc_get_chat_unread_counts() TO authenticated;
REVOKE ALL ON FUNCTION crm.rpc_get_chat_unread_counts() FROM PUBLIC, anon;
