-- The view is security-invoker. Provider identities are readable only by an
-- authenticated CRM user who can already access the related lead.
GRANT SELECT ON crm.lead_channel_identities, crm.instance_channels TO authenticated;

DROP POLICY IF EXISTS lead_channel_identities_select ON crm.lead_channel_identities;
CREATE POLICY lead_channel_identities_select
  ON crm.lead_channel_identities
  FOR SELECT
  TO authenticated
  USING (crm.current_user_can_access_lead(lead_id));

DROP POLICY IF EXISTS instance_channels_select ON crm.instance_channels;
CREATE POLICY instance_channels_select
  ON crm.instance_channels
  FOR SELECT
  TO authenticated
  USING (aces_id = public.current_aces_id());

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
    WHEN handoff_state.last_handoff_at IS NULL THEN 'clear'::text
    WHEN handoff_state.last_human_reply_at IS NULL THEN 'waiting_first_reply'::text
    WHEN handoff_state.last_lead_inbound_at IS NOT NULL
      AND handoff_state.last_lead_inbound_at > handoff_state.last_human_reply_at
      THEN 'waiting_reply'::text
    ELSE 'clear'::text
  END AS manual_pending_state,
  CASE
    WHEN l.interaction_mode <> 'human' THEN NULL::timestamptz
    WHEN handoff_state.last_handoff_at IS NULL THEN NULL::timestamptz
    WHEN handoff_state.last_human_reply_at IS NULL THEN handoff_state.last_handoff_at
    WHEN handoff_state.last_lead_inbound_at IS NOT NULL
      AND handoff_state.last_lead_inbound_at > handoff_state.last_human_reply_at
      THEN handoff_state.last_lead_inbound_at
    ELSE NULL::timestamptz
  END AS manual_pending_since,
  l.empresa_id,
  empresa.name AS empresa_name,
  empresa.cnpj AS empresa_cnpj,
  instagram_identity.instagram_username,
  instagram_identity.instagram_profile_picture_url
FROM crm.leads AS l
LEFT JOIN crm.users AS owner_user
  ON owner_user.id = l.owner_id
 AND owner_user.aces_id = l.aces_id
LEFT JOIN crm.instance AS inst
  ON inst.instancia = l.instancia::text
 AND inst.aces_id = l.aces_id
LEFT JOIN crm.empresas AS empresa
  ON empresa.id = l.empresa_id
 AND empresa.aces_id = l.aces_id
LEFT JOIN LATERAL (
  SELECT o.value, o.connection_level, o.status
  FROM crm.opportunities AS o
  WHERE o.lead_id = l.id
  ORDER BY o.updated_at DESC NULLS LAST, o.created_at DESC NULLS LAST
  LIMIT 1
) AS latest_opp ON TRUE
LEFT JOIN LATERAL (
  SELECT
    lt.tag_name AS last_tag_name,
    t.urgencia AS last_tag_urgencia
  FROM crm.lead_tags AS lt
  LEFT JOIN crm.tags AS t
    ON t.id = lt.tag_id
   AND t.aces_id = l.aces_id
  WHERE lt.lead_id = l.id
  ORDER BY lt.created_at DESC NULLS LAST
  LIMIT 1
) AS latest_tag ON TRUE
LEFT JOIN LATERAL (
  WITH last_handoff AS (
    SELECT mh.sent_at
    FROM crm.message_history AS mh
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
      FROM crm.message_history AS mh
      WHERE mh.lead_id = l.id
        AND mh.aces_id = l.aces_id
        AND mh.source_type = 'human'
        AND mh.direction::text = 'outbound'
        AND mh.sent_at >= lh.sent_at
      ORDER BY mh.sent_at DESC, mh.id DESC
      LIMIT 1
    ) AS last_human_reply_at,
    (
      SELECT mh.sent_at
      FROM crm.message_history AS mh
      WHERE mh.lead_id = l.id
        AND mh.aces_id = l.aces_id
        AND mh.source_type = 'lead'
        AND mh.direction::text = 'inbound'
        AND mh.sent_at >= lh.sent_at
      ORDER BY mh.sent_at DESC, mh.id DESC
      LIMIT 1
    ) AS last_lead_inbound_at
  FROM last_handoff AS lh
) AS handoff_state ON TRUE
LEFT JOIN LATERAL (
  SELECT
    identity.display_username AS instagram_username,
    identity.profile_picture_url AS instagram_profile_picture_url
  FROM crm.lead_channel_identities AS identity
  JOIN crm.instance_channels AS channel
    ON channel.id = identity.channel_id
   AND channel.aces_id = identity.aces_id
   AND channel.provider = 'instagram'
  WHERE identity.lead_id = l.id
    AND identity.aces_id = l.aces_id
  ORDER BY identity.updated_at DESC NULLS LAST, identity.created_at DESC NULLS LAST
  LIMIT 1
) AS instagram_identity ON TRUE;

ALTER VIEW crm.v_lead_details SET (security_invoker = true);
GRANT SELECT ON crm.v_lead_details TO authenticated;
