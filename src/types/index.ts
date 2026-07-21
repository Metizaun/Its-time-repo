export type LeadStatus = "Aberto" | "Ganho" | "Perdido";
export type UserRole = "admin" | "vendedor";
export type PeriodFilter = "hoje" | "7d" | "30d" | "total" | "custom";

export interface Lead {
  id: string;
  nome: string;
  cidade: string;
  email: string | null;
  telefone: string;
  origem: string;
  conexao: "Baixa" | "Média" | "Alta";
  valor: number;
  dataCriacao: string;
  responsavel: string;
  status: string;
  stage_id: string | null;
  observacoes?: string;
  instance_name?: string | null;
  last_tag_name?: string | null;
}

export interface AIAgent {
  id: string;
  aces_id: number;
  instance_name: string;
  name: string;
  system_prompt: string;
  provider: "gemini";
  model: string;
  is_active: boolean;
  temperature: number;
  buffer_wait_ms: number;
  human_pause_minutes: number;
  auto_apply_threshold: number;
  handoff_enabled: boolean;
  handoff_prompt: string | null;
  handoff_target_phone: string | null;
  template_key: string | null;
  template_version: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface PipelineStage {
  id: string;
  pipeline_id: string;
  name: string;
  color: string;
  position: number;
  category: LeadStatus;
  aces_id: number;
  is_funnel_stage: boolean;
  classifier_description: string;
  classifier_positive_signals: string[];
  classifier_negative_signals: string[];
  classifier_examples: string[];
  classifier_semantic_key: string | null;
  classifier_is_destination: boolean;
  isAttendanceStage: boolean;
}

export interface Pipeline {
  id: string;
  aces_id: number;
  name: string;
  description: string;
  classifier_key: string;
  is_default: boolean;
  is_active: boolean;
  ai_reply_enabled: boolean;
  ai_classification_enabled: boolean;
  classification_auto_apply_threshold: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface KanbanColumn {
  id: string;
  name: string;
  color: string;
}

export interface Toast {
  id: string;
  message: string;
  type?: "success" | "error" | "info";
  action?: {
    label: string;
    handler: () => void;
  };
}

export interface AppState {
  currentUser: User;
  users: User[];
  leads: Lead[];
  ui: {
    theme: "dark" | "light";
    periodFilter: PeriodFilter;
    customRange: { from: Date | null; to: Date | null };
    searchQuery: string;
    toastQueue: Toast[];
    modal: { type: string; payload?: any } | null;
    drawerLeadId: string | null;
    kanbanColumns: KanbanColumn[];
  };
}
