export type AdminPlan = {
  id: string;
  code: string;
  name: string;
  mensalidade_brl: number;
  implantacao_brl: number;
  ai_budget_brl: number | null;
  warn_threshold_pct: number;
  max_usuarios: number | null;
  max_instancias: number | null;
  is_active: boolean;
};

export type AdminSubscription = {
  id: string;
  aces_id: number;
  plan_id: string;
  status: "active" | "suspended" | "canceled";
  started_at: string;
  ended_at: string | null;
  cycle_anchor_day: number;
  implantacao_brl: number | null;
  implantacao_paga_em: string | null;
  mensalidade_brl_override: number | null;
  ai_budget_brl_override: number | null;
  enforcement_enabled: boolean;
};

export type AdminAccount = {
  aces_id: number;
  account_name: string;
  account_status: string;
  is_internal: boolean;
  subscription_id: string | null;
  subscription_status: string | null;
  enforcement_enabled: boolean | null;
  plan_id: string | null;
  plan_code: string | null;
  plan_name: string | null;
  mrr_brl: number | null;
  cycle_id: string | null;
  cycle_start: string | null;
  cycle_end: string | null;
  budget_brl: number | null;
  consumed_brl: number | null;
  credit_brl: number | null;
  effective_consumed_brl: number | null;
  consumed_pct: number | null;
  cycle_status: "ok" | "warned" | "exceeded" | "blocked" | null;
  instances_count?: number;
  provider_cost_brl?: number;
  revenue_brl?: number;
};

export type AdminMonthlyFinancial = {
  competencia: string;
  mrr_brl: number;
  revenue_booked_brl: number;
  revenue_paid_brl: number;
  billed_consumption_brl: number;
  provider_cost_brl: number;
  fx_margin_brl: number;
  client_margin_brl: number;
  fixed_cost_brl: number;
  result_brl: number;
};

export type AdminOverview = {
  kpis: {
    mrrBrl: number;
    revenueBookedBrl: number;
    revenuePaidBrl: number;
    billedConsumptionBrl: number;
    providerCostBrl: number;
    fxMarginBrl: number;
    clientMarginBrl: number;
    fixedCostBrl: number;
    resultBrl: number;
  };
  series: AdminMonthlyFinancial[];
  ranking: Array<{ aces_id: number; name: string; consumed_brl: number; provider_cost_brl: number }>;
  providers: Array<{ provider: string; billed_cost_brl: number; provider_cost_brl: number }>;
  unratedCount: number;
};

export type AdminCostDimension = {
  competencia: string;
  aces_id: number;
  instance_name: string | null;
  feature_key: string;
  provider: string;
  model: string;
  event_count: number;
  unrated_count: number;
  cost_usd: number | null;
  billed_cost_brl: number | null;
  provider_cost_brl: number | null;
};

export type AdminRevenueEntry = {
  id: string;
  aces_id: number;
  competencia: string;
  tipo: "mensalidade" | "implantacao" | "avulso" | "desconto";
  valor_brl: number;
  status: "previsto" | "pago";
  pago_em: string | null;
  descricao: string | null;
  created_by: string;
};

export type AdminFixedCost = {
  id: string;
  nome: string;
  categoria: "infra" | "ferramenta" | "pessoal" | "outro";
  valor_brl: number;
  recorrencia: "mensal" | "anual" | "unico";
  vigencia_inicio: string;
  vigencia_fim: string | null;
};

export type AdminExchangeRate = {
  id: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  rate_kind: "internal" | "provider";
  source: string;
  effective_at: string;
};

export type AdminAccountDetail = {
  account: AdminAccount;
  subscription: AdminSubscription | null;
  dimensions: AdminCostDimension[];
  revenue: AdminRevenueEntry[];
  resets: Array<{ id: string; credit_delta_brl: number; reason: string; created_at: string }>;
};

export type AdminFinanceCatalog = {
  plans: AdminPlan[];
  revenue: AdminRevenueEntry[];
  fixedCosts: AdminFixedCost[];
  exchangeRates: AdminExchangeRate[];
};
