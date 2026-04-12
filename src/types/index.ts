export type LeadStatus = "Aberto" | "Ganho" | "Perdido";
export type UserRole = "admin" | "vendedor";
export type PeriodFilter = "hoje" | "7d" | "30d" | "total" | "custom";

export interface Lead {
  id: string;
  nome: string;
  cidade: string;
  email: string | null; // Permitindo null
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

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface PipelineStage {
  id: string;
  name: string;
  color: string;
  position: number;
  category: LeadStatus;
  aces_id: number;
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