import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type {
  DashboardFilters,
  DashboardOperationalMetrics,
} from "@/types/dashboard";

const EMPTY_DASHBOARD_METRICS: DashboardOperationalMetrics = {
  kpis: {
    leads_period: 0,
    open_leads: 0,
    ai_assisted_leads: 0,
    ai_response_rate: 0,
  },
  pipeline: {
    funnel: [],
    evolution: [],
    heatmap: [],
    conversion_rate: 0,
    won_leads: 0,
  },
  conversation: {
    evolution: [],
    responded_after_ai_leads: 0,
    ai_messages: 0,
    automation_messages: 0,
    human_messages: 0,
    lead_messages: 0,
    stale_leads: 0,
    stale_leads_list: [],
  },
  instances: [],
  optional: {
    revenue_registered: 0,
    leads_with_revenue: 0,
    dispatches_sent: 0,
    dispatches_pending: 0,
  },
};

const DASHBOARD_RPC_SAFE_MODE = import.meta.env.DEV || import.meta.env.MODE === "test";
const DASHBOARD_RPC_FLAG = import.meta.env.VITE_ENABLE_DASHBOARD_RPC;

export const DASHBOARD_RPC_ENABLED =
  DASHBOARD_RPC_FLAG === "true" || (!DASHBOARD_RPC_SAFE_MODE && DASHBOARD_RPC_FLAG !== "false");

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeMetrics(value: unknown): DashboardOperationalMetrics {
  const raw = (value || {}) as Partial<DashboardOperationalMetrics>;
  const kpis = (raw.kpis || {}) as Partial<DashboardOperationalMetrics["kpis"]>;
  const pipeline = (raw.pipeline || {}) as Partial<DashboardOperationalMetrics["pipeline"]>;
  const conversation = (raw.conversation || {}) as Partial<DashboardOperationalMetrics["conversation"]>;
  const optional = (raw.optional || {}) as Partial<DashboardOperationalMetrics["optional"]>;

  return {
    kpis: {
      leads_period: asNumber(kpis.leads_period),
      open_leads: asNumber(kpis.open_leads),
      ai_assisted_leads: asNumber(kpis.ai_assisted_leads),
      ai_response_rate: asNumber(kpis.ai_response_rate),
    },
    pipeline: {
      funnel: asArray(pipeline.funnel),
      evolution: asArray(pipeline.evolution),
      heatmap: asArray(pipeline.heatmap),
      conversion_rate: asNumber(pipeline.conversion_rate),
      won_leads: asNumber(pipeline.won_leads),
    },
    conversation: {
      evolution: asArray(conversation.evolution),
      responded_after_ai_leads: asNumber(conversation.responded_after_ai_leads),
      ai_messages: asNumber(conversation.ai_messages),
      automation_messages: asNumber(conversation.automation_messages),
      human_messages: asNumber(conversation.human_messages),
      lead_messages: asNumber(conversation.lead_messages),
      stale_leads: asNumber(conversation.stale_leads),
      stale_leads_list: asArray(conversation.stale_leads_list),
    },
    instances: asArray(raw.instances),
    optional: {
      revenue_registered: asNumber(optional.revenue_registered),
      leads_with_revenue: asNumber(optional.leads_with_revenue),
      dispatches_sent: asNumber(optional.dispatches_sent),
      dispatches_pending: asNumber(optional.dispatches_pending),
    },
  };
}

function buildDashboardQueryKey(filters: DashboardFilters) {
  return [
    "dashboard",
    "operational-metrics",
    filters.period,
    filters.instance,
    filters.customRange?.from?.toISOString() ?? null,
    filters.customRange?.to?.toISOString() ?? null,
  ] as const;
}

async function fetchDashboardMetrics(filters: DashboardFilters) {
  if (!DASHBOARD_RPC_ENABLED) {
    return EMPTY_DASHBOARD_METRICS;
  }

  const { data, error } = await supabase.rpc("rpc_dashboard_operational_metrics", {
    p_period: filters.period,
    p_from: filters.period === "custom" ? filters.customRange?.from?.toISOString() ?? null : null,
    p_to: filters.period === "custom" ? filters.customRange?.to?.toISOString() ?? null : null,
    p_instance: filters.instance,
  });

  if (error) {
    throw error;
  }

  return normalizeMetrics(data);
}

export function useDashboardOperationalQuery(filters: DashboardFilters) {
  return useQuery({
    queryKey: [...buildDashboardQueryKey(filters), DASHBOARD_RPC_ENABLED],
    queryFn: () => fetchDashboardMetrics(filters),
    enabled: DASHBOARD_RPC_ENABLED,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

export function useDashboardMetrics(filters: DashboardFilters) {
  const query = useDashboardOperationalQuery(filters);
  const metrics = query.data ?? EMPTY_DASHBOARD_METRICS;

  return {
    metrics,
    kpis: metrics.kpis,
    pipeline: metrics.pipeline,
    optional: metrics.optional,
    loading: query.isLoading,
    fetching: query.isFetching,
    error: query.error,
    rpcEnabled: DASHBOARD_RPC_ENABLED,
    refetch: query.refetch,
  };
}
