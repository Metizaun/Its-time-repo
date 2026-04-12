import { useState } from "react";
import { useLeads } from "@/hooks/useLeads";
import { useInstances } from "@/hooks/useInstances";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { PipelineToolbar } from "@/components/kanban/PipelineToolbar";
import { useApp } from "@/context/AppContext";

export default function Pipeline() {
  const { leads, loading, refetch } = useLeads({ enableRealtime: false });
  const { instances, loading: instancesLoading } = useInstances();
  const { ui, openModal } = useApp();
  const [selectedInstance, setSelectedInstance] = useState<string>("all");

  const filteredLeads = leads.filter((lead) => {
    const matchesSearch =
      !ui.searchQuery ||
      lead.lead_name.toLowerCase().includes(ui.searchQuery.toLowerCase()) ||
      lead.email?.toLowerCase().includes(ui.searchQuery.toLowerCase()) ||
      lead.contact_phone?.toLowerCase().includes(ui.searchQuery.toLowerCase());

    const matchesInstance = selectedInstance === "all" || lead.instance_name === selectedInstance;

    return matchesSearch && matchesInstance;
  });

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold">Pipeline</h1>
        <p className="text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Pipeline</h1>
        <p className="text-muted-foreground mt-1">Gerencie seus leads atraves do funil de vendas</p>
      </div>

      <PipelineToolbar
        onAddLead={() => openModal("createLead")}
        selectedInstance={selectedInstance}
        onInstanceChange={setSelectedInstance}
        instanceOptions={instances.map((inst) => inst.instancia)}
        instancesLoading={instancesLoading}
      />

      <KanbanBoard leads={filteredLeads} onLeadsChanged={() => refetch({ showLoading: false })} />
    </div>
  );
}
