CREATE OR REPLACE FUNCTION crm.rpc_dashboard_operational_metrics(
  p_period text DEFAULT '30d',
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_instance text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = crm, public
AS $$
DECLARE
  v_now timestamptz := now();
  v_from timestamptz;
  v_to timestamptz;
  v_heatmap_from timestamptz;
  v_heatmap_to timestamptz;
  v_heatmap_week_start date;
  v_instance text := NULLIF(NULLIF(btrim(COALESCE(p_instance, '')), ''), 'todas');
  v_result jsonb;
BEGIN
  v_from := CASE p_period
    WHEN 'hoje' THEN date_trunc('day', v_now)
    WHEN '7d' THEN v_now - interval '7 days'
    WHEN '30d' THEN v_now - interval '30 days'
    WHEN 'custom' THEN p_from
    ELSE NULL
  END;

  v_to := CASE p_period
    WHEN 'hoje' THEN date_trunc('day', v_now) + interval '1 day'
    WHEN 'custom' THEN p_to
    ELSE NULL
  END;

  v_heatmap_from := CASE
    WHEN p_period = 'total' THEN date_trunc('day', v_now) - interval '179 days'
    ELSE date_trunc('day', COALESCE(v_from, v_now - interval '29 days'))
  END;

  v_heatmap_to := CASE
    WHEN p_period = 'custom' THEN date_trunc('day', COALESCE(v_to, v_now)) + interval '1 day'
    WHEN p_period = 'hoje' THEN v_to
    ELSE date_trunc('day', COALESCE(v_to, v_now)) + interval '1 day'
  END;

  v_heatmap_week_start := v_heatmap_from::date - extract(dow from v_heatmap_from)::integer;

  WITH filtered_leads AS (
    SELECT
      l.id,
      l.lead_name,
      l.source,
      l.status,
      l.stage_id,
      l.created_at,
      l.last_message_at,
      l.owner_name,
      COALESCE(l.value, 0)::numeric AS value,
      l.instance_name
    FROM crm.v_lead_details l
    WHERE (v_instance IS NULL OR l.instance_name = v_instance)
      AND (v_from IS NULL OR l.created_at >= v_from)
      AND (v_to IS NULL OR l.created_at < v_to)
  ),
  stage_rows AS (
    SELECT
      ps.id,
      ps.name,
      ps.color,
      ps.position,
      ps.category::text AS category,
      ps.is_funnel_stage
    FROM crm.pipeline_stages ps
    WHERE ps.aces_id = public.current_aces_id()
    ORDER BY ps.position ASC, ps.created_at ASC
  ),
  lead_stage AS (
    SELECT
      fl.*,
      sr.category AS stage_category,
      sr.name AS stage_name
    FROM filtered_leads fl
    LEFT JOIN stage_rows sr
      ON sr.id = fl.stage_id
  ),
  filtered_messages AS (
    SELECT
      mh.id,
      mh.lead_id,
      mh.source_type,
      mh.instance,
      mh.sent_at
    FROM crm.message_history mh
    WHERE mh.aces_id = public.current_aces_id()
      AND (v_instance IS NULL OR mh.instance = v_instance)
      AND (v_from IS NULL OR mh.sent_at >= v_from)
      AND (v_to IS NULL OR mh.sent_at < v_to)
      AND mh.source_type IN ('lead', 'human', 'ai', 'automation')
  ),
  ai_responded AS (
    SELECT DISTINCT lead_msg.lead_id
    FROM filtered_messages lead_msg
    WHERE lead_msg.lead_id IS NOT NULL
      AND lead_msg.source_type = 'lead'
      AND EXISTS (
        SELECT 1
        FROM filtered_messages ai_msg
        WHERE ai_msg.lead_id = lead_msg.lead_id
          AND ai_msg.source_type IN ('ai', 'automation')
          AND ai_msg.sent_at < lead_msg.sent_at
      )
  ),
  lead_counts AS (
    SELECT
      count(*)::integer AS total_leads,
      count(*) FILTER (WHERE stage_category = 'Aberto')::integer AS open_leads,
      count(*) FILTER (WHERE stage_category = 'Ganho')::integer AS won_leads,
      count(*) FILTER (
        WHERE stage_category = 'Aberto'
          AND (last_message_at IS NULL OR last_message_at < v_now - interval '7 days')
      )::integer AS stale_leads,
      count(*) FILTER (WHERE value > 0)::integer AS leads_with_revenue,
      COALESCE(sum(value) FILTER (WHERE value > 0), 0)::numeric AS revenue_registered
    FROM lead_stage
  ),
  conversation_counts AS (
    SELECT
      count(DISTINCT lead_id) FILTER (WHERE source_type IN ('ai', 'automation'))::integer AS ai_assisted_leads,
      (SELECT count(*)::integer FROM ai_responded) AS responded_after_ai_leads,
      count(*) FILTER (WHERE source_type = 'ai')::integer AS ai_messages,
      count(*) FILTER (WHERE source_type = 'automation')::integer AS automation_messages,
      count(*) FILTER (WHERE source_type = 'human')::integer AS human_messages,
      count(*) FILTER (WHERE source_type = 'lead')::integer AS lead_messages
    FROM filtered_messages
  ),
  automation_counts AS (
    SELECT
      count(*) FILTER (WHERE ae.status = 'sent')::integer AS sent,
      count(*) FILTER (WHERE ae.status IN ('pending', 'processing'))::integer AS pending
    FROM crm.automation_executions ae
    WHERE ae.aces_id = public.current_aces_id()
      AND (v_instance IS NULL OR ae.instance_snapshot = v_instance)
      AND (v_from IS NULL OR COALESCE(ae.sent_at, ae.scheduled_at, ae.created_at) >= v_from)
      AND (v_to IS NULL OR COALESCE(ae.sent_at, ae.scheduled_at, ae.created_at) < v_to)
  ),
  pipeline_funnel AS (
    SELECT
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', sr.id,
            'name', sr.name,
            'value', COALESCE(stage_count.value, 0),
            'color', sr.color,
            'category', sr.category,
            'position', sr.position,
            'is_funnel_stage', sr.is_funnel_stage
          )
          ORDER BY sr.position ASC
        ),
        '[]'::jsonb
      ) AS data
    FROM stage_rows sr
    LEFT JOIN (
      SELECT stage_id, count(*)::integer AS value
      FROM filtered_leads
      WHERE stage_id IS NOT NULL
      GROUP BY stage_id
    ) stage_count
      ON stage_count.stage_id = sr.id
  ),
  leads_evolution AS (
    SELECT
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'date', to_char(day_key, 'DD/MM'),
            'leads', leads,
            'ganhos', won
          )
          ORDER BY day_key ASC
        ),
        '[]'::jsonb
      ) AS data
    FROM (
      SELECT
        date_trunc('day', created_at) AS day_key,
        count(*)::integer AS leads,
        count(*) FILTER (WHERE stage_category = 'Ganho')::integer AS won
      FROM lead_stage
      GROUP BY day_key
    ) daily
  ),
  heatmap_days AS (
    SELECT generate_series(
      v_heatmap_from::date,
      (v_heatmap_to::date - 1),
      interval '1 day'
    )::date AS day_key
  ),
  heatmap_counts AS (
    SELECT
      date_trunc('day', l.created_at)::date AS day_key,
      count(*)::integer AS leads
    FROM crm.v_lead_details l
    WHERE (v_instance IS NULL OR l.instance_name = v_instance)
      AND l.created_at >= v_heatmap_from
      AND l.created_at < v_heatmap_to
    GROUP BY date_trunc('day', l.created_at)::date
  ),
  heatmap_base AS (
    SELECT
      hd.day_key,
      COALESCE(hc.leads, 0)::integer AS leads,
      COALESCE(max(COALESCE(hc.leads, 0)) OVER (), 0)::integer AS max_leads
    FROM heatmap_days hd
    LEFT JOIN heatmap_counts hc
      ON hc.day_key = hd.day_key
  ),
  lead_heatmap AS (
    SELECT
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'date', to_char(day_key, 'YYYY-MM-DD'),
            'weekday', extract(dow from day_key)::integer,
            'week_index', floor((day_key - v_heatmap_week_start)::numeric / 7)::integer,
            'month_label', CASE
              WHEN day_key = v_heatmap_from::date OR extract(day from day_key)::integer = 1
                THEN trim(to_char(day_key, 'Mon'))
              ELSE NULL
            END,
            'leads', leads,
            'intensity', CASE
              WHEN leads = 0 OR max_leads = 0 THEN 0
              WHEN leads::numeric / max_leads <= 0.25 THEN 1
              WHEN leads::numeric / max_leads <= 0.50 THEN 2
              WHEN leads::numeric / max_leads <= 0.75 THEN 3
              ELSE 4
            END
          )
          ORDER BY day_key ASC
        ),
        '[]'::jsonb
      ) AS data
    FROM heatmap_base
  ),
  conversation_evolution AS (
    SELECT
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'date', to_char(day_key, 'DD/MM'),
            'ai', ai,
            'automation', automation,
            'human', human,
            'lead', lead
          )
          ORDER BY day_key ASC
        ),
        '[]'::jsonb
      ) AS data
    FROM (
      SELECT
        date_trunc('day', sent_at) AS day_key,
        count(*) FILTER (WHERE source_type = 'ai')::integer AS ai,
        count(*) FILTER (WHERE source_type = 'automation')::integer AS automation,
        count(*) FILTER (WHERE source_type = 'human')::integer AS human,
        count(*) FILTER (WHERE source_type = 'lead')::integer AS lead
      FROM filtered_messages
      GROUP BY day_key
    ) daily
  ),
  stale_list AS (
    SELECT
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', id,
            'name', COALESCE(lead_name, 'Sem nome'),
            'instance', instance_name,
            'last_message_at', last_message_at,
            'stage', stage_name
          )
          ORDER BY last_message_at ASC NULLS FIRST, created_at ASC
        ),
        '[]'::jsonb
      ) AS data
    FROM (
      SELECT *
      FROM lead_stage
      WHERE stage_category = 'Aberto'
        AND (last_message_at IS NULL OR last_message_at < v_now - interval '7 days')
      ORDER BY last_message_at ASC NULLS FIRST, created_at ASC
      LIMIT 5
    ) stale
  ),
  instance_rows AS (
    SELECT
      COALESCE(ls.instance_name, fm.instance) AS instance_name,
      count(DISTINCT ls.id)::integer AS leads,
      count(DISTINCT ls.id) FILTER (WHERE ls.stage_category = 'Ganho')::integer AS won,
      count(fm.id)::integer AS messages,
      count(fm.id) FILTER (WHERE fm.source_type = 'lead')::integer AS lead_messages,
      count(DISTINCT fm.lead_id) FILTER (WHERE fm.source_type IN ('ai', 'automation'))::integer AS ai_assisted,
      count(DISTINCT ar.lead_id)::integer AS responded_after_ai
    FROM lead_stage ls
    FULL OUTER JOIN filtered_messages fm
      ON fm.lead_id = ls.id
    LEFT JOIN ai_responded ar
      ON ar.lead_id = COALESCE(ls.id, fm.lead_id)
    WHERE COALESCE(ls.instance_name, fm.instance) IS NOT NULL
    GROUP BY COALESCE(ls.instance_name, fm.instance)
  ),
  instance_performance AS (
    SELECT
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'instance', instance_name,
            'leads', leads,
            'messages', messages,
            'lead_messages', lead_messages,
            'ai_assisted', ai_assisted,
            'responded_after_ai', responded_after_ai,
            'response_rate', CASE WHEN ai_assisted > 0 THEN round((responded_after_ai::numeric / ai_assisted::numeric) * 100, 1) ELSE 0 END,
            'won', won
          )
          ORDER BY leads DESC, messages DESC, instance_name ASC
        ),
        '[]'::jsonb
      ) AS data
    FROM instance_rows
  )
  SELECT jsonb_build_object(
    'kpis', jsonb_build_object(
      'leads_period', lc.total_leads,
      'open_leads', lc.open_leads,
      'ai_assisted_leads', cc.ai_assisted_leads,
      'ai_response_rate', CASE WHEN cc.ai_assisted_leads > 0 THEN round((cc.responded_after_ai_leads::numeric / cc.ai_assisted_leads::numeric) * 100, 1) ELSE 0 END
    ),
    'pipeline', jsonb_build_object(
      'funnel', pf.data,
      'evolution', le.data,
      'heatmap', lh.data,
      'conversion_rate', CASE WHEN lc.total_leads > 0 THEN round((lc.won_leads::numeric / lc.total_leads::numeric) * 100, 1) ELSE 0 END,
      'won_leads', lc.won_leads
    ),
    'conversation', jsonb_build_object(
      'evolution', ce.data,
      'responded_after_ai_leads', cc.responded_after_ai_leads,
      'ai_messages', cc.ai_messages,
      'automation_messages', cc.automation_messages,
      'human_messages', cc.human_messages,
      'lead_messages', cc.lead_messages,
      'stale_leads', lc.stale_leads,
      'stale_leads_list', sl.data
    ),
    'instances', ip.data,
    'optional', jsonb_build_object(
      'revenue_registered', lc.revenue_registered,
      'leads_with_revenue', lc.leads_with_revenue,
      'dispatches_sent', ac.sent,
      'dispatches_pending', ac.pending
    )
  )
  INTO v_result
  FROM lead_counts lc
  CROSS JOIN conversation_counts cc
  CROSS JOIN automation_counts ac
  CROSS JOIN pipeline_funnel pf
  CROSS JOIN leads_evolution le
  CROSS JOIN lead_heatmap lh
  CROSS JOIN conversation_evolution ce
  CROSS JOIN stale_list sl
  CROSS JOIN instance_performance ip;

  RETURN COALESCE(
    v_result,
    jsonb_build_object(
      'kpis', jsonb_build_object('leads_period', 0, 'open_leads', 0, 'ai_assisted_leads', 0, 'ai_response_rate', 0),
      'pipeline', jsonb_build_object('funnel', '[]'::jsonb, 'evolution', '[]'::jsonb, 'heatmap', '[]'::jsonb, 'conversion_rate', 0, 'won_leads', 0),
      'conversation', jsonb_build_object('evolution', '[]'::jsonb, 'responded_after_ai_leads', 0, 'ai_messages', 0, 'automation_messages', 0, 'human_messages', 0, 'lead_messages', 0, 'stale_leads', 0, 'stale_leads_list', '[]'::jsonb),
      'instances', '[]'::jsonb,
      'optional', jsonb_build_object('revenue_registered', 0, 'leads_with_revenue', 0, 'dispatches_sent', 0, 'dispatches_pending', 0)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION crm.rpc_dashboard_operational_metrics(text, timestamptz, timestamptz, text) TO authenticated;
