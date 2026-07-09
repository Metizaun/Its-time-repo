import { useEffect, useMemo, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import { LeadSidebar } from "@/components/leads/LeadSidebar";
import EditLeadModal from "@/components/modals/EditLeadModal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/contexts/AuthContext";
import { useChat } from "@/hooks/useChat";
import { useLeadAiControl } from "@/hooks/useLeadAiControl";
import { type Lead, useLeads } from "@/hooks/useLeads";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { cn } from "@/lib/utils";
import { finalizeHumanHandoff } from "@/services/chatService";
import type { ChatComposerPayload } from "@/types/chat";

export default function Chat() {
  const { leads, loading: leadsLoading, refetch } = useLeads({ enableRealtime: true });
  const { stages, loading: stagesLoading } = usePipelineStages();
  const { ui } = useApp();
  const { userRole } = useAuth();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [activeFilter, setActiveFilter] = useState<"all" | "manual">("all");
  const [finalizeDialogOpen, setFinalizeDialogOpen] = useState(false);
  const [finalizeStageId, setFinalizeStageId] = useState("");
  const [finalizingHandoff, setFinalizingHandoff] = useState(false);

  const { messages, loading: messagesLoading, sendMessage } = useChat(selectedLeadId);

  const filteredLeads = useMemo(() => {
    if (!ui.searchQuery) return leads;

    const query = ui.searchQuery.toLowerCase();
    return leads.filter((lead) =>
      lead.lead_name.toLowerCase().includes(query) ||
      lead.email?.toLowerCase().includes(query) ||
      lead.contact_phone?.toLowerCase().includes(query) ||
      lead.source?.toLowerCase().includes(query) ||
      lead.instance_name?.toLowerCase().includes(query)
    );
  }, [leads, ui.searchQuery]);

  const manualCount = useMemo(
    () => filteredLeads.filter((lead) => lead.interaction_mode === "human").length,
    [filteredLeads]
  );

  const sidebarLeads = useMemo(() => {
    if (activeFilter === "manual") {
      return filteredLeads.filter((lead) => lead.interaction_mode === "human");
    }

    return filteredLeads;
  }, [activeFilter, filteredLeads]);

  useEffect(() => {
    const leadIdFromQuery = searchParams.get("leadId");
    if (!leadIdFromQuery) return;
    setSelectedLeadId(leadIdFromQuery);
  }, [searchParams]);

  const handleSelectLead = (leadId: string | null) => {
    setSelectedLeadId(leadId);
    if (leadId) {
      setSearchParams({ leadId });
      return;
    }
    setSearchParams({});
  };

  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) ?? null;

  useEffect(() => {
    if (activeFilter === "manual" && selectedLead && selectedLead.interaction_mode !== "human") {
      setActiveFilter("all");
    }
  }, [activeFilter, selectedLead]);

  useEffect(() => {
    if (!finalizeDialogOpen || !selectedLead) {
      return;
    }

    setFinalizeStageId((currentValue) => {
      if (currentValue) {
        return currentValue;
      }

      return selectedLead.stage_id ?? stages[0]?.id ?? "";
    });
  }, [finalizeDialogOpen, selectedLead, stages]);

  const isAdmin = userRole === "ADMIN";
  const leadAiControl = useLeadAiControl(
    selectedLead?.id ?? null,
    selectedLead?.instance_name ?? null,
    { enabled: isAdmin }
  );
  const showSidebar = !isMobile || !selectedLead;
  const showChatPanel = !isMobile || Boolean(selectedLead);

  const handleSendMessage = (payload: ChatComposerPayload) => {
    if (!selectedLead) {
      return Promise.resolve();
    }

    return sendMessage(payload, selectedLead.contact_phone || undefined, selectedLead.instance_name);
  };

  const handleSchedule = () => {
    if (!selectedLead?.id) return;
    navigate(`/calendar?leadId=${selectedLead.id}&new=1`);
  };

  const openFinalizeDialog = () => {
    if (!selectedLead) {
      return;
    }

    setFinalizeStageId(selectedLead.stage_id ?? stages[0]?.id ?? "");
    setFinalizeDialogOpen(true);
  };

  const handleFinalizeHandoff = async () => {
    if (!selectedLead?.id) {
      return;
    }

    if (!finalizeStageId) {
      toast.error("Selecione a etapa final do lead");
      return;
    }

    setFinalizingHandoff(true);

    try {
      await finalizeHumanHandoff(selectedLead.id, finalizeStageId);
      await Promise.all([
        refetch({ showLoading: false }),
        leadAiControl.refetch({ silent: true }),
      ]);

      setFinalizeDialogOpen(false);
      setFinalizeStageId("");
      toast.success("Atendimento humano finalizado e IA reativada");
    } catch (error) {
      console.error("Erro ao finalizar handoff humano:", error);
      toast.error("Erro ao finalizar atendimento humano", {
        description: error instanceof Error ? error.message : "Tente novamente em instantes.",
      });
    } finally {
      setFinalizingHandoff(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh_-_var(--layout-topbar-height))] overflow-hidden">
      {showSidebar && (
        <div className={cn("h-full min-w-0 shrink-0", isMobile ? "w-full" : "w-[var(--chat-sidebar-width)]")}>
          <LeadSidebar
            leads={sidebarLeads}
            selectedLeadId={selectedLeadId}
            onSelectLead={handleSelectLead}
            loading={leadsLoading}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            manualCount={manualCount}
          />
        </div>
      )}

      {showChatPanel && (
        <div className="flex min-w-0 flex-1 flex-col">
          {selectedLead ? (
            <>
              <ChatHeader
                key={selectedLead.id}
                leadName={selectedLead.lead_name}
                instanceName={selectedLead.instance_name}
                showBackButton={isMobile}
                onBack={() => handleSelectLead(null)}
                onOpenDetails={() => setEditingLead(selectedLead)}
                onSchedule={handleSchedule}
                showFinalizeButton={selectedLead.interaction_mode === "human"}
                onFinalize={openFinalizeDialog}
                aiControl={
                  isAdmin
                    ? {
                        enabled: leadAiControl.enabled,
                        available: leadAiControl.available,
                        reason: leadAiControl.reason,
                        bypassingGlobalInactive: leadAiControl.bypassingGlobalInactive,
                        loading: leadAiControl.loading,
                        saving: leadAiControl.saving,
                        onToggle: leadAiControl.toggle,
                      }
                    : null
                }
              />

              <MessageList messages={messages} loading={messagesLoading} />

              <ChatInput onSend={handleSendMessage} />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex flex-col items-center gap-5">
                <div className="flex h-20 w-20 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--color-surface-1)] shadow-sm">
                  <MessageSquare className="h-9 w-9 text-[var(--color-text-secondary)]" />
                </div>
                <div className="space-y-1 text-center">
                  <h2 className="text-xl font-bold text-foreground">Selecione uma conversa</h2>
                  <p className="max-w-xs text-sm text-[var(--color-text-secondary)]">
                    Escolha um lead na barra lateral para comecar
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog
        open={finalizeDialogOpen}
        onOpenChange={(open) => {
          if (finalizingHandoff) {
            return;
          }

          setFinalizeDialogOpen(open);
          if (!open) {
            setFinalizeStageId("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Finalizar atendimento humano</DialogTitle>
            <DialogDescription>
              Escolha a etapa em que o lead deve ficar ao devolver a conversa para a IA.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-4 py-3">
              <p className="text-sm font-semibold text-foreground">{selectedLead?.lead_name ?? "Lead selecionado"}</p>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                A IA sera reativada assim que este handoff for finalizado.
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="handoff-final-stage" className="text-sm font-medium text-foreground">
                Etapa de destino
              </label>
              <Select value={finalizeStageId} onValueChange={setFinalizeStageId} disabled={stagesLoading || finalizingHandoff}>
                <SelectTrigger
                  id="handoff-final-stage"
                  className="rounded-2xl border-[var(--color-border-medium)] bg-[var(--color-bg-surface)]"
                >
                  <SelectValue placeholder={stagesLoading ? "Carregando etapas..." : "Selecione a etapa"} />
                </SelectTrigger>
                <SelectContent className="rounded-2xl border-[var(--color-border-medium)] bg-[var(--color-bg-elevated)]">
                  {stages.map((stage) => (
                    <SelectItem
                      key={stage.id}
                      value={stage.id}
                      className="text-foreground focus:bg-[var(--color-border-subtle)] focus:text-foreground"
                    >
                      {stage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setFinalizeDialogOpen(false);
                setFinalizeStageId("");
              }}
              disabled={finalizingHandoff}
            >
              Cancelar
            </Button>
            <Button onClick={() => void handleFinalizeHandoff()} disabled={finalizingHandoff || stagesLoading || !finalizeStageId}>
              {finalizingHandoff ? "Finalizando..." : "Finalizar atendimento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EditLeadModal
        lead={editingLead}
        open={!!editingLead}
        onClose={() => setEditingLead(null)}
        onSuccess={() => {
          refetch();
          setEditingLead(null);
        }}
      />
    </div>
  );
}
