ALTER TABLE crm.leads
  ADD COLUMN IF NOT EXISTS last_lead_inbound_at timestamptz;

WITH latest_inbound AS (
  SELECT
    history.aces_id,
    history.lead_id,
    max(history.sent_at) AS sent_at
  FROM crm.message_history AS history
  WHERE history.direction = 'inbound'
    AND history.source_type = 'lead'
  GROUP BY history.aces_id, history.lead_id
)
UPDATE crm.leads AS lead
SET last_lead_inbound_at = latest.sent_at
FROM latest_inbound AS latest
WHERE lead.aces_id = latest.aces_id
  AND lead.id = latest.lead_id
  AND (
    lead.last_lead_inbound_at IS NULL
    OR lead.last_lead_inbound_at < latest.sent_at
  );
