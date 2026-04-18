import { Plus, HelpCircle, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { useApp } from "@/context/AppContext";

interface PipelineToolbarProps {
  onAddLead: () => void;
  selectedInstance: string;
  onInstanceChange: (instance: string) => void;
  instanceOptions: string[];
  instancesLoading?: boolean;
}

export function PipelineToolbar({
  onAddLead,
  selectedInstance,
  onInstanceChange,
  instanceOptions,
  instancesLoading = false
}: PipelineToolbarProps) {
  const { userRole } = useAuth();
  const { openModal } = useApp();
  const isAdmin = userRole === 'ADMIN';

  return (
    <div className="flex items-center justify-between p-3 bg-[var(--color-bg-surface)] rounded-2xl w-full">
      <div className="flex items-center gap-3">
        <button onClick={onAddLead} className="flex items-center gap-2 px-5 py-2.5 bg-[var(--color-accent)] text-white text-sm font-semibold rounded-xl hover:brightness-110 transition-all shadow-[0_4px_16px_rgba(229,57,58,0.2)]">
          <Plus className="w-4 h-4" />
          Novo Lead
        </button>

        {isAdmin && (
          <button 
            onClick={() => openModal('STAGE_FORM')} 
            className="flex items-center gap-2 px-5 py-2.5 bg-[var(--color-bg-surface)] text-foreground/70 text-sm font-semibold rounded-xl hover:bg-[var(--color-bg-elevated)] transition-all"
          >
            <Plus className="w-4 h-4 opacity-70" />
            Nova Etapa
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
      <Select value={selectedInstance} onValueChange={onInstanceChange} disabled={instancesLoading}>
        <SelectTrigger className="w-[220px] bg-[var(--color-bg-surface)] border-[var(--color-border-subtle)] text-foreground rounded-xl focus:ring-0 focus:ring-offset-0">
          <Building2 className="w-4 h-4 mr-2 text-[var(--color-text-secondary)]" />
          <SelectValue placeholder="Todas as Instâncias" />
        </SelectTrigger>
        <SelectContent className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-xl">
          <SelectItem value="all" className="text-foreground focus:bg-[var(--color-bg-surface)] focus:text-foreground cursor-pointer">Todas as Instâncias</SelectItem>
          {instanceOptions.map((instance) => (
            <SelectItem key={instance} value={instance} className="text-foreground focus:bg-[var(--color-bg-surface)] focus:text-foreground cursor-pointer">
              {instance}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover>
        <PopoverTrigger asChild>
          <button className="flex items-center justify-center w-10 h-10 bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:text-foreground hover:bg-[var(--color-bg-elevated)] rounded-xl transition-all">
            <HelpCircle className="w-4 h-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] text-foreground rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.12)]">
          <div className="space-y-3">
            <h4 className="font-bold text-sm">{"Atalhos do Pipeline"}</h4>
            <ul className="space-y-2 text-sm text-[var(--color-text-secondary)]">
              <li className="flex items-center justify-between"><span>Novo Lead</span><kbd className="px-1.5 py-0.5 text-xs bg-[var(--color-bg-surface)] rounded font-mono font-bold text-[var(--color-text-secondary)]">N</kbd></li>
              <li className="flex items-center justify-between"><span>Mover lead focado</span><kbd className="px-1.5 py-0.5 text-xs bg-[var(--color-bg-surface)] rounded font-mono font-bold text-[var(--color-text-secondary)]">M</kbd></li>
              <li className="flex items-center justify-between"><span>Mover entre colunas</span><kbd className="px-1.5 py-0.5 text-xs bg-[var(--color-bg-surface)] rounded font-mono font-bold text-[var(--color-text-secondary)]">Arrastar</kbd></li>
              <li className="flex items-center justify-between"><span>Abrir detalhes</span><kbd className="px-1.5 py-0.5 text-xs bg-[var(--color-bg-surface)] rounded font-mono font-bold text-[var(--color-text-secondary)]">Enter</kbd></li>
            </ul>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  </div>
);
}
