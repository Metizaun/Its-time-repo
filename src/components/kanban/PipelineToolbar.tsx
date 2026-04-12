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
    <div className="flex items-center justify-between p-4 bg-card border border-border rounded-lg">
      <div className="flex items-center gap-3">
        <Button onClick={onAddLead} size="default" className="gap-2">
          <Plus className="w-4 h-4" />
          Novo Lead
        </Button>

        {isAdmin && (
          <Button 
            onClick={() => openModal('STAGE_FORM')} 
            variant="outline" 
            size="default" 
            className="gap-2 border-dashed"
          >
            <Plus className="w-4 h-4" />
            Nova Etapa
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3">
      <Select value={selectedInstance} onValueChange={onInstanceChange} disabled={instancesLoading}>
        <SelectTrigger className="w-[240px]">
          <Building2 className="w-4 h-4 mr-2" />
          <SelectValue placeholder="Todas as Instâncias" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas as Instâncias</SelectItem>
          {instanceOptions.map((instance) => (
            <SelectItem key={instance} value={instance}>
              {instance}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon">
            <HelpCircle className="w-4 h-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <div className="space-y-2">
            <h4 className="font-semibold">Atalhos do Pipeline</h4>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li><kbd className="px-1.5 py-0.5 text-xs bg-muted rounded">N</kbd> - Novo Lead</li>
              <li><kbd className="px-1.5 py-0.5 text-xs bg-muted rounded">M</kbd> - Mover lead focado</li>
              <li><kbd className="px-1.5 py-0.5 text-xs bg-muted rounded">Arrastar</kbd> - Mover entre colunas</li>
              <li><kbd className="px-1.5 py-0.5 text-xs bg-muted rounded">Enter</kbd> - Abrir detalhes</li>
            </ul>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  </div>
);
}
