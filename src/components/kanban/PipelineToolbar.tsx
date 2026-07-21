import { Bot, Building2, HelpCircle, Loader2, Plus, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { useApp } from "@/context/AppContext";
import { cn } from "@/lib/utils";

interface PipelineOption {
  id: string;
  name: string;
  aiClassificationEnabled: boolean;
}

interface PipelineToolbarProps {
  onAddLead: () => void;
  selectedInstance: string;
  onInstanceChange: (instance: string) => void;
  instanceOptions: string[];
  instancesLoading?: boolean;
  selectedPipelineId: string;
  onPipelineChange: (pipelineId: string) => void;
  onCreatePipeline: () => void;
  onToggleClassification: (enabled: boolean) => void;
  classificationLoading?: boolean;
  pipelineOptions: PipelineOption[];
  pipelinesLoading?: boolean;
}

export function PipelineToolbar({
  onAddLead,
  selectedInstance,
  onInstanceChange,
  instanceOptions,
  instancesLoading = false,
  selectedPipelineId,
  onPipelineChange,
  onCreatePipeline,
  onToggleClassification,
  classificationLoading = false,
  pipelineOptions,
  pipelinesLoading = false,
}: PipelineToolbarProps) {
  const { userRole } = useAuth();
  const { openModal } = useApp();
  const isAdmin = userRole === "ADMIN";
  const selectedPipeline = pipelineOptions.find((pipeline) => pipeline.id === selectedPipelineId);
  const automaticEnabled = selectedPipeline?.aiClassificationEnabled ?? true;

  return (
    <TooltipProvider delayDuration={250}>
      <div className="pipeline-toolbar">
        <div className="pipeline-toolbar__actions">
          <Button onClick={onAddLead} className="pipeline-toolbar__primary">
            <Plus className="h-4 w-4" />
            Novo lead
          </Button>
          {isAdmin && (
            <Button
              variant="ghost"
              onClick={() => openModal("STAGE_FORM", { pipelineId: selectedPipelineId })}
              disabled={!selectedPipelineId}
            >
              <Plus className="h-4 w-4" />
              Nova etapa
            </Button>
          )}
        </div>

        <div className="pipeline-toolbar__filters">
          {isAdmin && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onCreatePipeline} aria-label="Criar novo pipeline">
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Novo pipeline</TooltipContent>
            </Tooltip>
          )}

          <Select value={selectedPipelineId} onValueChange={onPipelineChange} disabled={pipelinesLoading || pipelineOptions.length === 0}>
            <SelectTrigger className="pipeline-toolbar__select pipeline-toolbar__select--pipeline">
              <Workflow className="h-4 w-4 shrink-0 text-[var(--color-gray-500)]" />
              <SelectValue placeholder="Pipeline" />
            </SelectTrigger>
            <SelectContent>
              {pipelineOptions.map((pipeline) => (
                <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  "pipeline-ai-toggle",
                  automaticEnabled ? "pipeline-ai-toggle--active" : "pipeline-ai-toggle--inactive"
                )}
                aria-pressed={automaticEnabled}
                aria-label={automaticEnabled ? "Desativar classificacao automatica" : "Ativar classificacao automatica"}
                onClick={() => isAdmin && !classificationLoading && onToggleClassification(!automaticEnabled)}
                disabled={!isAdmin || classificationLoading || !selectedPipelineId}
              >
                {classificationLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {isAdmin
                ? "Classifica e move leads apos a conversa. Nao altera as respostas da IA."
                : "Somente administradores podem alterar este controle."}
            </TooltipContent>
          </Tooltip>

          <Select value={selectedInstance} onValueChange={onInstanceChange} disabled={instancesLoading}>
            <SelectTrigger className="pipeline-toolbar__select">
              <Building2 className="h-4 w-4 shrink-0 text-[var(--color-gray-500)]" />
              <SelectValue placeholder="Todas as instancias" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as instancias</SelectItem>
              {instanceOptions.map((instance) => <SelectItem key={instance} value={instance}>{instance}</SelectItem>)}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Ajuda do pipeline">
                <HelpCircle className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80">
              <h4 className="text-sm font-semibold">Atalhos do pipeline</h4>
              <ul className="mt-3 space-y-2 text-sm text-[var(--color-gray-600)]">
                <li className="flex justify-between"><span>Novo lead</span><kbd>N</kbd></li>
                <li className="flex justify-between"><span>Mover entre colunas</span><kbd>Arrastar</kbd></li>
                <li className="flex justify-between"><span>Abrir detalhes</span><kbd>Enter</kbd></li>
              </ul>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </TooltipProvider>
  );
}
