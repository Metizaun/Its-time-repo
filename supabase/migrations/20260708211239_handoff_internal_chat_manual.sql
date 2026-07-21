ALTER TABLE crm.leads
  ADD COLUMN IF NOT EXISTS interaction_mode text NOT NULL DEFAULT 'ai';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leads_interaction_mode_check'
      AND conrelid = 'crm.leads'::regclass
  ) THEN
    ALTER TABLE crm.leads
      ADD CONSTRAINT leads_interaction_mode_check
      CHECK (interaction_mode IN ('ai', 'human'));
  END IF;
END
$$;

UPDATE crm.leads
SET interaction_mode = 'ai'
WHERE interaction_mode IS NULL;

CREATE OR REPLACE VIEW crm.v_lead_details AS
SELECT
  l.id,
  l.name AS lead_name,
  l.email,
  l.contact_phone,
  l."Fonte" AS source,
  l.status,
  l.stage_id,
  l.created_at,
  l.updated_at,
  l.last_message_at,
  l.last_city,
  l.last_region,
  l.last_country,
  l.lead_number,
  owner_user.name AS owner_name,
  l.owner_id,
  latest_opp.value,
  latest_opp.connection_level,
  latest_opp.status::text AS opportunity_status,
  l.notes,
  l.instancia AS instance_name,
  inst.color AS instance_color,
  latest_tag.last_tag_name,
  latest_tag.last_tag_urgencia,
  l.aces_id,
  l.interaction_mode,
  CASE
    WHEN l.interaction_mode <> 'human' THEN NULL::text
    WHEN handoff_state.last_handoff_at IS NULL THEN 'clear'
    WHEN handoff_state.last_human_reply_at IS NULL THEN 'waiting_first_reply'
    WHEN handoff_state.last_lead_inbound_at IS NOT NULL
      AND handoff_state.last_lead_inbound_at > handoff_state.last_human_reply_at
      THEN 'waiting_reply'
    ELSE 'clear'
  END AS manual_pending_state,
  CASE
    WHEN l.interaction_mode <> 'human' THEN NULL::timestamptz
    WHEN handoff_state.last_handoff_at IS NULL THEN NULL::timestamptz
    WHEN handoff_state.last_human_reply_at IS NULL THEN handoff_state.last_handoff_at
    WHEN handoff_state.last_lead_inbound_at IS NOT NULL
      AND handoff_state.last_lead_inbound_at > handoff_state.last_human_reply_at
      THEN handoff_state.last_lead_inbound_at
    ELSE NULL::timestamptz
  END AS manual_pending_since
FROM crm.leads l
LEFT JOIN crm.users owner_user
  ON owner_user.id = l.owner_id
 AND owner_user.aces_id = l.aces_id
LEFT JOIN crm.instance inst
  ON inst.instancia = l.instancia
 AND inst.aces_id = l.aces_id
LEFT JOIN LATERAL (
  SELECT o.value, o.connection_level, o.status
  FROM crm.opportunities o
  WHERE o.lead_id = l.id
  ORDER BY o.updated_at DESC NULLS LAST, o.created_at DESC NULLS LAST
  LIMIT 1
) latest_opp ON true
LEFT JOIN LATERAL (
  SELECT
    lt.tag_name AS last_tag_name,
    t.urgencia AS last_tag_urgencia
  FROM crm.lead_tags lt
  LEFT JOIN crm.tags t
    ON t.id = lt.tag_id
   AND t.aces_id = l.aces_id
  WHERE lt.lead_id = l.id
  ORDER BY lt.created_at DESC NULLS LAST
  LIMIT 1
) latest_tag ON true
LEFT JOIN LATERAL (
  WITH last_handoff AS (
    SELECT mh.sent_at
    FROM crm.message_history mh
    WHERE mh.lead_id = l.id
      AND mh.aces_id = l.aces_id
      AND mh.source_type = 'system'
      AND mh.content = 'Transferido para atendimento humano'
    ORDER BY mh.sent_at DESC, mh.id DESC
    LIMIT 1
  )
  SELECT
    lh.sent_at AS last_handoff_at,
    (
      SELECT mh.sent_at
      FROM crm.message_history mh
      WHERE mh.lead_id = l.id
        AND mh.aces_id = l.aces_id
        AND mh.source_type = 'human'
        AND mh.direction = 'outbound'
        AND mh.sent_at >= lh.sent_at
      ORDER BY mh.sent_at DESC, mh.id DESC
      LIMIT 1
    ) AS last_human_reply_at,
    (
      SELECT mh.sent_at
      FROM crm.message_history mh
      WHERE mh.lead_id = l.id
        AND mh.aces_id = l.aces_id
        AND mh.source_type = 'lead'
        AND mh.direction = 'inbound'
        AND mh.sent_at >= lh.sent_at
      ORDER BY mh.sent_at DESC, mh.id DESC
      LIMIT 1
    ) AS last_lead_inbound_at
  FROM last_handoff lh
) handoff_state ON true;

ALTER VIEW crm.v_lead_details SET (security_invoker = true);
GRANT SELECT ON crm.v_lead_details TO authenticated;
