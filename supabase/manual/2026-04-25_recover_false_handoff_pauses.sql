-- Recuperacao emergencial para leads pausados indevidamente por webhook fromMe.
-- Use no SQL Editor do Supabase apos aplicar a migration 20260423113000.

-- 1) Diagnostico: quantos leads seguem pausados por origem.
select
  ag.instance_name,
  coalesce(als.pause_origin, 'null') as pause_origin,
  count(*) as paused_leads
from crm.ai_lead_state als
join crm.ai_agents ag on ag.id = als.agent_id
where als.status = 'paused'
  and coalesce(als.manual_ai_enabled, true) = true
group by ag.instance_name, coalesce(als.pause_origin, 'null')
order by paused_leads desc, ag.instance_name asc;

-- 2) Recuperacao: reativa pausas geradas por handoff falso do webhook.
update crm.ai_lead_state als
set
  freeze_until = null,
  status = 'active',
  pause_origin = null,
  pause_reference = null,
  paused_at = null,
  updated_at = now()
from crm.ai_agents ag
where ag.id = als.agent_id
  and als.status = 'paused'
  and coalesce(als.manual_ai_enabled, true) = true
  and coalesce(als.pause_origin, 'human_webhook') = 'human_webhook';

-- 3) Auditoria: registra a recuperacao manual nos runs.
insert into crm.ai_runs (
  agent_id,
  lead_id,
  input_snapshot,
  output_snapshot,
  action_taken
)
select
  als.agent_id,
  als.lead_id,
  jsonb_build_object(
    'reason', 'manual_false_handoff_recovery'
  ),
  jsonb_build_object(
    'repaired', true,
    'reference', 'supabase/manual/2026-04-25_recover_false_handoff_pauses.sql'
  ),
  'freeze_repair'
from crm.ai_lead_state als
where als.status = 'active'
  and als.updated_at >= now() - interval '10 minutes';
