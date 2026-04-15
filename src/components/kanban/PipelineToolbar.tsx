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
    <div className="flex items-center justify-between p-3 bg-[#131313] rounded-2xl w-full">
      <div className="flex items-center gap-3">
        <button onClick={onAddLead} className="flex items-center gap-2 px-5 py-2.5 bg-[var(--color-accent)] text-white text-sm font-semibold rounded-xl hover:brightness-110 transition-all shadow-[0_4px_16px_rgba(229,57,58,0.2)]">
          <Plus className="w-4 h-4" />
          Novo Lead
        </button>

        {isAdmin && (
          <button 
            onClick={() => openModal('STAGE_FORM')} 
            className="flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] text-white/90 text-sm font-semibold rounded-xl hover:bg-[#242424] transition-all"
          >
            <Plus className="w-4 h-4 opacity-70" />
            Nova Etapa
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
      <Select value={selectedInstance} onValueChange={onInstanceChange} disabled={instancesLoading}>
        <SelectTrigger className="w-[220px] bg-[#1A1A1A] border-none text-white rounded-xl focus:ring-0 focus:ring-offset-0">
          <Building2 className="w-4 h-4 mr-2 text-white/40" />
          <SelectValue placeholder="Todas as Instâncias" />
        </SelectTrigger>
        <SelectContent className="bg-[#1A1A1A] border border-white/5 rounded-xl">
          <SelectItem value="all" className="text-white focus:bg-[#242424] focus:text-white cursor-pointer">Todas as Instâncias</SelectItem>
          {instanceOptions.map((instance) => (
            <SelectItem key={instance} value={instance} className="text-white focus:bg-[#242424] focus:text-white cursor-pointer">
              {instance}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover>
        <PopoverTrigger asChild>
          <button className="flex items-center justify-center w-10 h-10 bg-[#1A1A1A] text-white/70 hover:text-white hover:bg-[#242424] rounded-xl transition-all">
            <HelpCircle className="w-4 h-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 bg-[#131313] border border-white/5 text-white rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.8)]">
          <div className="space-y-3">
            <h4 className="font-bold text-sm">Atalhos do Pipeline</h4>
            <ul className="space-y-2 text-sm text-[var(--color-text-secondary)]">
              <li className="flex items-center justify-between"><span>Novo Lead</span><kbd className="px-1.5 py-0.5 text-xs bg-[#1A1A1A] rounded font-mono font-bold text-white/70">N</kbd></li>
              <li className="flex items-center justify-between"><span>Mover lead focado</span><kbd className="px-1.5 py-0.5 text-xs bg-[#1A1A1A] rounded font-mono font-bold text-white/70">M</kbd></li>
              <li className="flex items-center justify-between"><span>Mover entre colunas</span><kbd className="px-1.5 py-0.5 text-xs bg-[#1A1A1A] rounded font-mono font-bold text-white/70">Arrastar</kbd></li>
              <li className="flex items-center justify-between"><span>Abrir detalhes</span><kbd className="px-1.5 py-0.5 text-xs bg-[#1A1A1A] rounded font-mono font-bold text-white/70">Enter</kbd></li>
            </ul>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  </div>
);
}
