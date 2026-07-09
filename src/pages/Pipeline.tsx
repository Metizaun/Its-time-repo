import { useState } from "react";
import { toast } from "sonner";
import { useLeads } from "@/hooks/useLeads";
import { useInstances } from "@/hooks/useInstances";
import { usePipelines } from "@/hooks/usePipelines";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { PipelineToolbar } from "@/components/kanban/PipelineToolbar";
import { useApp } from "@/context/AppContext";

export default function Pipeline() {
  const { leads, loading, refetch } = useLeads({ enableRealtime: false });
  const { instances, loading: instancesLoading } = useInstances();
  const { pipelines, loading: pipelinesLoading, createPipeline } = usePipelines();
  const { ui, openModal } = useApp();
  const [selectedInstance, setSelectedInstance] = useState<string>("all");
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");

  const effectivePipelineId =
    selectedPipelineId || pipelines.find((pipeline) => pipeline.is_default)?.id || pipelines[0]?.id || "";
  const { stages } = usePipelineStages(effectivePipelineId || null);
  const stageIdsInPipeline = new Set(stages.map((stage) => stage.id));

  const filteredLeads = leads.filter((lead) => {
    const matchesSearch =
      !ui.searchQuery ||
      lead.lead_name.toLowerCase().includes(ui.searchQuery.toLowerCase()) ||
      lead.email?.toLowerCase().includes(ui.searchQuery.toLowerCase()) ||
      lead.contact_phone?.toLowerCase().includes(ui.searchQuery.toLowerCase());

    const matchesInstance = selectedInstance === "all" || lead.instance_name === selectedInstance;
    const matchesPipeline =
      !effectivePipelineId || !lead.stage_id || stageIdsInPipeline.has(lead.stage_id);

    return matchesSearch && matchesInstance && matchesPipeline;
  });

  const handleCreatePipeline = async () => {
    const name = window.prompt("Nome do novo pipeline");
    if (!name?.trim()) return;

    const { data, error } = await createPipeline({ name });
    if (error || !data) return;

    setSelectedPipelineId(data.id);
    toast.success("Agora crie as etapas deste pipeline.");
  };

  if (loading || pipelinesLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-[var(--color-accent)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Pipeline</h1>
        <p className="text-[var(--color-text-secondary)] mt-1 text-sm">
          Gerencie seus leads através do funil de vendas.
        </p>
      </div>

      <PipelineToolbar
        onAddLead={() => openModal("createLead")}
        selectedInstance={selectedInstance}
        onInstanceChange={setSelectedInstance}
        instanceOptions={instances.map((inst) => inst.instancia)}
        instancesLoading={instancesLoading}
        selectedPipelineId={effectivePipelineId}
        onPipelineChange={setSelectedPipelineId}
        onCreatePipeline={handleCreatePipeline}
        pipelineOptions={pipelines.map((pipeline) => ({ id: pipeline.id, name: pipeline.name }))}
        pipelinesLoading={pipelinesLoading}
      />

      <KanbanBoard
        leads={filteredLeads}
        pipelineId={effectivePipelineId}
        onLeadsChanged={() => refetch({ showLoading: false })}
      />
    </div>
  );
}
