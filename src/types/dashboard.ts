import type { PeriodFilter } from "@/types";

export type DashboardFilters = {
  period: PeriodFilter;
  customRange?: { from: Date | null; to: Date | null };
  instance: string;
};

export type DashboardKpis = {
  leads_period: number;
  open_leads: number;
  ai_assisted_leads: number;
  ai_response_rate: number;
};

export type DashboardFunnelItem = {
  id?: string;
  name: string;
  value: number;
  color?: string | null;
  category?: string | null;
  position?: number;
  is_funnel_stage?: boolean;
};

export type DashboardLeadEvolutionItem = {
  date: string;
  leads: number;
  ganhos: number;
};

export type DashboardHeatmapCell = {
  date: string;
  weekday: number;
  week_index: number;
  month_label: string | null;
  leads: number;
  intensity: 0 | 1 | 2 | 3 | 4;
};

export type DashboardPipelineMetrics = {
  funnel: DashboardFunnelItem[];
  evolution: DashboardLeadEvolutionItem[];
  heatmap: DashboardHeatmapCell[];
  conversion_rate: number;
  won_leads: number;
};

export type DashboardConversationEvolutionItem = {
  date: string;
  ai: number;
  automation: number;
  human: number;
  lead: number;
};

export type DashboardStaleLead = {
  id: string;
  name: string;
  instance: string | null;
  last_message_at: string | null;
  stage: string | null;
};

export type DashboardConversationMetrics = {
  evolution: DashboardConversationEvolutionItem[];
  responded_after_ai_leads: number;
  ai_messages: number;
  automation_messages: number;
  human_messages: number;
  lead_messages: number;
  stale_leads: number;
  stale_leads_list: DashboardStaleLead[];
};

export type DashboardInstanceMetric = {
  instance: string;
  leads: number;
  messages: number;
  lead_messages: number;
  ai_assisted: number;
  responded_after_ai: number;
  response_rate: number;
  won: number;
};

export type DashboardOptionalMetrics = {
  revenue_registered: number;
  leads_with_revenue: number;
  dispatches_sent: number;
  dispatches_pending: number;
};

export type DashboardOperationalMetrics = {
  kpis: DashboardKpis;
  pipeline: DashboardPipelineMetrics;
  conversation: DashboardConversationMetrics;
  instances: DashboardInstanceMetric[];
  optional: DashboardOptionalMetrics;
};
