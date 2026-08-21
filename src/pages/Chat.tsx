import { useEffect, useMemo, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatWindowNotice } from "@/components/chat/ChatWindowNotice";
import { MessageList } from "@/components/chat/MessageList";
import { RoutingQueueBanner } from "@/components/chat/RoutingQueueBanner";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/contexts/AuthContext";
import { useChat } from "@/hooks/useChat";
import { useCrmUsers } from "@/hooks/useCrmUsers";
import { useLeadAiControl } from "@/hooks/useLeadAiControl";
import { useInstances } from "@/hooks/useInstances";
import { type Lead, useLeads } from "@/hooks/useLeads";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { usePipelines } from "@/hooks/usePipelines";
import { useRoutingQueue } from "@/hooks/useRoutingQueue";
import { useChatUnread } from "@/contexts/ChatUnreadContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { finalizeHumanHandoff, forwardHumanHandoff } from "@/services/chatService";
import type { ChatComposerPayload } from "@/types/chat";

type HandoffDialogView = "choice" | "forward" | "finalize";

export default function Chat() {
  const { leads, loading: leadsLoading, refetch } = useLeads({ enableRealtime: true });
  const { pipelines, loading: pipelinesLoading } = usePipelines();
  const { instances, loading: instancesLoading } = useInstances();
  const { setSearchQuery, ui } = useApp();
  const { user, userRole } = useAuth();
  const isAdmin = userRole === "ADMIN";
  const { users: crmUsers, loading: crmUsersLoading } = useCrmUsers(isAdmin);
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [activeFilter, setActiveFilter] = useState<"all" | "unread" | "manual">("all");
  const [selectedInstance, setSelectedInstance] = useState("all");
  const [selectedCompany, setSelectedCompany] = useState("all");
  const [finalizeDialogOpen, setFinalizeDialogOpen] = useState(false);
  const [handoffDialogView, setHandoffDialogView] = useState<HandoffDialogView>("choice");
  const [finalizeStageId, setFinalizeStageId] = useState("");
  const [finalizePipelineId, setFinalizePipelineId] = useState("");
  const [forwardUserId, setForwardUserId] = useState("");
  const [forwardRequestId, setForwardRequestId] = useState("");
  const [preparingFinalize, setPreparingFinalize] = useState(false);
  const [forwardingHandoff, setForwardingHandoff] = useState(false);
  const [finalizingHandoff, setFinalizingHandoff] = useState(false);
  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) ?? null;

  const { messages, sendPolicy, loading: messagesLoading, sendMessage } = useChat(
    selectedLeadId,
    selectedLead?.instance_name ?? null,
  );
  const { byLead: unreadByLead, markRead } = useChatUnread();
  const { stages, loading: stagesLoading } = usePipelineStages(
    finalizePipelineId || null,
    finalizeDialogOpen && handoffDialogView === "finalize" && Boolean(finalizePipelineId)
  );
  const routingQueue = useRoutingQueue();

  const searchFilteredLeads = useMemo(() => {
    const query = ui.searchQuery.trim().toLocaleLowerCase("pt-BR");
    if (!query) return leads;

    return leads.filter((lead) =>
      lead.lead_name.toLocaleLowerCase("pt-BR").includes(query) ||
      lead.email?.toLocaleLowerCase("pt-BR").includes(query) ||
      lead.contact_phone?.toLocaleLowerCase("pt-BR").includes(query) ||
      lead.source?.toLocaleLowerCase("pt-BR").includes(query) ||
      lead.instance_name?.toLocaleLowerCase("pt-BR").includes(query)
    );
  }, [leads, ui.searchQuery]);

  const companyOptions = useMemo(() => {
    const unique = new Map<string, { id: string; name: string; cnpj: string }>();
    for (const lead of leads) {
      if (!lead.empresa_id || !lead.empresa_name || !lead.empresa_cnpj) continue;
      unique.set(lead.empresa_id, {
        id: lead.empresa_id,
        name: lead.empresa_name,
        cnpj: lead.empresa_cnpj,
      });
    }
    return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  }, [leads]);

  const companyFilteredLeads = useMemo(
    () => searchFilteredLeads.filter(
      (lead) => selectedCompany === "all" || lead.empresa_id === selectedCompany
    ),
    [searchFilteredLeads, selectedCompany]
  );

  const instanceFilteredLeads = useMemo(
    () => companyFilteredLeads.filter(
      (lead) => selectedInstance === "all" || lead.instance_name === selectedInstance
    ),
    [companyFilteredLeads, selectedInstance]
  );

  const manualCount = useMemo(
    () => instanceFilteredLeads.filter((lead) => lead.interaction_mode === "human").length,
    [instanceFilteredLeads]
  );

  const unreadConversationCount = useMemo(
    () => instanceFilteredLeads.filter((lead) => (unreadByLead[lead.id] ?? 0) > 0).length,
    [instanceFilteredLeads, unreadByLead]
  );

  const sidebarLeads = useMemo(() => {
    if (activeFilter === "unread") {
      return instanceFilteredLeads.filter((lead) => (unreadByLead[lead.id] ?? 0) > 0);
    }

    if (activeFilter === "manual") {
      return instanceFilteredLeads
        .filter((lead) => lead.interaction_mode === "human")
        .sort((left, right) => {
          const leftWaiting = routingQueue.byLead.get(left.id)?.status === "waiting" ? 1 : 0;
          const rightWaiting = routingQueue.byLead.get(right.id)?.status === "waiting" ? 1 : 0;
          return rightWaiting - leftWaiting;
        });
    }

    return instanceFilteredLeads;
  }, [activeFilter, instanceFilteredLeads, routingQueue.byLead, unreadByLead]);

  const handoffRecipients = useMemo(
    () => crmUsers
      .filter((crmUser) =>
        crmUser.auth_user_id !== user?.id &&
        (crmUser.role === "ADMIN" || crmUser.role === "VENDEDOR")
      )
      .sort((left, right) =>
        (left.name || left.email).localeCompare(right.name || right.email, "pt-BR")
      ),
    [crmUsers, user?.id],
  );

  useEffect(() => {
    if (selectedCompany === "all") return;
    if (companyOptions.some((company) => company.id === selectedCompany)) return;
    setSelectedCompany("all");
  }, [companyOptions, selectedCompany]);

  useEffect(() => {
    if (selectedInstance === "all") return;
    if (instances.some((instance) => instance.instancia === selectedInstance)) return;
    setSelectedInstance("all");
  }, [instances, selectedInstance]);

  useEffect(() => {
    const leadIdFromQuery = searchParams.get("leadId");
    if (!leadIdFromQuery) return;
    setSelectedLeadId(leadIdFromQuery);
  }, [searchParams]);

  useEffect(() => {
    const conversationTarget = (location.state as { conversationTarget?: unknown } | null)?.conversationTarget;
    if (typeof conversationTarget !== "string" || !conversationTarget) return;
    setSelectedLeadId(conversationTarget);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  const handleSelectLead = (leadId: string | null) => {
    setSelectedLeadId(leadId);
    if (leadId) {
      setSearchParams({ leadId });
      return;
    }
    setSearchParams({});
  };

  const selectedRouting = selectedLeadId ? routingQueue.byLead.get(selectedLeadId) ?? null : null;

  useEffect(() => {
    if (activeFilter === "manual" && selectedLead && selectedLead.interaction_mode !== "human") {
      setActiveFilter("all");
    }
  }, [activeFilter, selectedLead]);

  useEffect(() => {
    if (!finalizeDialogOpen || !finalizePipelineId) return;
    setFinalizeStageId((current) => stages.some((stage) => stage.id === current) ? current : stages[0]?.id ?? "");
  }, [finalizeDialogOpen, finalizePipelineId, stages]);

  useEffect(() => {
    if (!selectedLeadId || document.visibilityState !== "visible") return;
    void markRead(selectedLeadId);
  }, [markRead, messages.length, selectedLeadId]);

  useEffect(() => {
    if (!selectedLeadId) return;
    const onVisible = () => document.visibilityState === "visible" && void markRead(selectedLeadId);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markRead, selectedLeadId]);

  const gupshupWindowClosed =
    sendPolicy?.provider === "gupshup" && sendPolicy.mode === "template_required";
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

  const resetHandoffDialog = () => {
    setHandoffDialogView("choice");
    setFinalizeStageId("");
    setFinalizePipelineId("");
    setForwardUserId("");
    setForwardRequestId("");
    setPreparingFinalize(false);
  };

  const closeHandoffDialog = () => {
    setFinalizeDialogOpen(false);
    resetHandoffDialog();
  };

  const openHandoffDialog = () => {
    if (!selectedLead) return;
    resetHandoffDialog();
    setForwardRequestId(crypto.randomUUID());
    setFinalizeDialogOpen(true);
  };

  const prepareFinalizeForm = async () => {
    if (!selectedLead) {
      return;
    }

    setPreparingFinalize(true);
    try {
      let currentPipelineId = "";
      if (selectedLead.stage_id) {
        const { data } = await supabase.from("pipeline_stages").select("pipeline_id").eq("id", selectedLead.stage_id).maybeSingle();
        currentPipelineId = String(data?.pipeline_id ?? "");
      }
      const fallbackPipelineId = pipelines.find((pipeline) => pipeline.is_default)?.id ?? pipelines[0]?.id ?? "";
      setFinalizePipelineId(currentPipelineId || fallbackPipelineId);
      setFinalizeStageId(selectedLead.stage_id ?? "");
      setHandoffDialogView("finalize");
    } finally {
      setPreparingFinalize(false);
    }
  };

  const handleForwardHandoff = async () => {
    if (!selectedLead?.id || !forwardUserId || !forwardRequestId) return;

    const recipient = handoffRecipients.find((crmUser) => crmUser.id === forwardUserId);
    if (!recipient) {
      toast.error("Selecione um colega valido");
      return;
    }

    setForwardingHandoff(true);
    try {
      await forwardHumanHandoff(selectedLead.id, recipient.id, forwardRequestId);
      await Promise.all([
        refetch({ showLoading: false }),
        routingQueue.refetch(true),
        leadAiControl.refetch({ silent: true }),
      ]);
      closeHandoffDialog();
      toast.success(`Atendimento encaminhado para ${recipient.name || recipient.email}`);
    } catch (error) {
      console.error("Erro ao encaminhar atendimento humano:", error);
      toast.error("Erro ao encaminhar atendimento", {
        description: error instanceof Error ? error.message : "Tente novamente em instantes.",
      });
    } finally {
      setForwardingHandoff(false);
    }
  };

  const handleFinalizeHandoff = async () => {
    if (!selectedLead?.id) {
      return;
    }

    if (!finalizePipelineId || !finalizeStageId || !stages.some((stage) => stage.id === finalizeStageId)) {
      toast.error("Selecione um pipeline e uma etapa validos");
      return;
    }

    setFinalizingHandoff(true);

    try {
      await finalizeHumanHandoff(selectedLead.id, finalizeStageId, selectedLead.instance_name);
      if (selectedRouting?.status === "claimed") {
        await routingQueue.close(selectedRouting.routingEventId).catch((error) => {
          console.error("Atendimento finalizado, mas a fila nao foi fechada:", error);
          toast.warning("Atendimento finalizado; a fila sera atualizada em seguida");
        });
      }
      await Promise.all([
        refetch({ showLoading: false }),
        leadAiControl.refetch({ silent: true }),
      ]);

      closeHandoffDialog();
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

  const handleClaimRouting = async () => {
    if (!selectedRouting) return;
    try {
      const result = await routingQueue.claim(selectedRouting.routingEventId);
      await refetch({ showLoading: false });
      if (result.claimed === false) {
        toast.info("Este atendimento ja foi assumido por outra pessoa");
        return;
      }
      toast.success("Atendimento assumido por voce");
    } catch (error) {
      toast.error("Nao foi possivel assumir o atendimento", {
        description: error instanceof Error ? error.message : "Atualize a fila e tente novamente.",
      });
    }
  };

  return (
    <div className="flex h-[calc(100vh_-_var(--layout-topbar-height))] overflow-hidden">
      {showSidebar && (
        <div
          className={cn(
            "h-full shrink-0",
            isMobile
              ? "w-full min-w-0"
              : "w-[var(--chat-sidebar-width)] min-w-[var(--chat-sidebar-width)] basis-[var(--chat-sidebar-width)]"
          )}
        >
          <LeadSidebar
            leads={sidebarLeads}
            totalCount={instanceFilteredLeads.length}
            selectedLeadId={selectedLeadId}
            onSelectLead={handleSelectLead}
            loading={leadsLoading}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            manualCount={manualCount}
            unreadConversationCount={unreadConversationCount}
            unreadByLead={unreadByLead}
            searchQuery={ui.searchQuery}
            onSearchQueryChange={setSearchQuery}
            instances={instances}
            instancesLoading={instancesLoading}
            selectedInstance={selectedInstance}
            onInstanceChange={setSelectedInstance}
            companies={companyOptions}
            selectedCompany={selectedCompany}
            onCompanyChange={setSelectedCompany}
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
                showFinalizeButton={leadAiControl.reason === "human_handoff"}
                onFinalize={openHandoffDialog}
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

              {selectedRouting ? (
                <RoutingQueueBanner
                  item={selectedRouting}
                  busy={routingQueue.actionId === selectedRouting.routingEventId}
                  onClaim={() => void handleClaimRouting()}
                />
              ) : null}

              <MessageList messages={messages} loading={messagesLoading} />

              {messagesLoading && !sendPolicy ? (
                <div className="border-t border-[var(--border-default)] bg-[var(--color-surface-1)] px-3 py-3 sm:px-4">
                  <Skeleton className="h-[68px] w-full rounded-[var(--radius-xl)]" />
                </div>
              ) : gupshupWindowClosed ? (
                <ChatWindowNotice
                  canManageAutomations={isAdmin}
                  onOpenAutomations={() => navigate("/automacao")}
                />
              ) : (
                <ChatInput onSend={handleSendMessage} disabled={!sendPolicy} />
              )}
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
          if (finalizingHandoff || forwardingHandoff || preparingFinalize) {
            return;
          }

          setFinalizeDialogOpen(open);
          if (!open) {
            resetHandoffDialog();
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {handoffDialogView === "choice"
                ? "Concluir atendimento"
                : handoffDialogView === "forward"
                  ? "Encaminhar atendimento"
                  : "Finalizar atendimento humano"}
            </DialogTitle>
            <DialogDescription>
              {handoffDialogView === "choice"
                ? "Escolha o que deve acontecer com esta conversa."
                : handoffDialogView === "forward"
                  ? "Selecione o colega que continuara o atendimento humano."
                  : "Escolha a etapa em que o lead deve ficar ao devolver a conversa para a IA."}
            </DialogDescription>
          </DialogHeader>

          {handoffDialogView === "choice" ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setHandoffDialogView("forward")}
                  className="h-auto min-h-14 items-center justify-start rounded-[var(--radius-lg)] border-[var(--border-default)] bg-[var(--color-surface-1)] px-4 py-3 text-left shadow-sm hover:bg-[var(--color-surface-2)] hover:shadow-md"
                >
                  <span className="min-w-0 whitespace-normal">
                    <span className="block text-sm font-semibold text-foreground">Encaminhar</span>
                    <span className="mt-0.5 block text-xs font-normal leading-4 text-[var(--color-text-secondary)]">
                      Outro colega continua o atendimento.
                    </span>
                  </span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void prepareFinalizeForm()}
                  disabled={preparingFinalize}
                  className="h-auto min-h-14 items-center justify-start rounded-[var(--radius-lg)] border-[var(--border-default)] bg-[var(--color-surface-1)] px-4 py-3 text-left shadow-sm hover:bg-[var(--color-surface-2)] hover:shadow-md"
                >
                  <span className="min-w-0 whitespace-normal">
                    <span className="block text-sm font-semibold text-foreground">
                      {preparingFinalize ? "Carregando..." : "Finalizar"}
                    </span>
                    <span className="mt-0.5 block text-xs font-normal leading-4 text-[var(--color-text-secondary)]">
                      Define a etapa e reativa a IA.
                    </span>
                  </span>
                </Button>
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={closeHandoffDialog} disabled={preparingFinalize}>
                  Cancelar
                </Button>
              </DialogFooter>
            </>
          ) : handoffDialogView === "forward" ? (
            <>
              <div className="space-y-3">
                <div className="rounded-[var(--radius-xl)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-4 py-3">
                  <p className="text-sm font-semibold text-foreground">{selectedLead?.lead_name ?? "Lead selecionado"}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                    A conversa permanecera em atendimento humano.
                  </p>
                </div>

                <div className="space-y-2">
                  <label htmlFor="handoff-forward-user" className="text-sm font-medium text-foreground">
                    Encaminhar para
                  </label>
                  <Select value={forwardUserId} onValueChange={setForwardUserId} disabled={crmUsersLoading || forwardingHandoff}>
                    <SelectTrigger id="handoff-forward-user" className="rounded-[var(--radius-md)] border-[var(--color-border-medium)] bg-[var(--color-bg-surface)]">
                      <SelectValue placeholder={crmUsersLoading ? "Carregando colegas..." : "Selecione um colega"} />
                    </SelectTrigger>
                    <SelectContent className="rounded-[var(--radius-xl)] border-[var(--color-border-medium)] bg-[var(--color-bg-elevated)]">
                      {handoffRecipients.map((recipient) => (
                        <SelectItem key={recipient.id} value={recipient.id}>
                          {recipient.name || recipient.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!crmUsersLoading && handoffRecipients.length === 0 ? (
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      Nenhum outro colega ativo esta disponivel nesta conta.
                    </p>
                  ) : null}
                </div>
              </div>

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => { setHandoffDialogView("choice"); setForwardUserId(""); }} disabled={forwardingHandoff}>
                  Voltar
                </Button>
                <Button onClick={() => void handleForwardHandoff()} disabled={forwardingHandoff || crmUsersLoading || !forwardUserId}>
                  {forwardingHandoff ? "Encaminhando..." : "Encaminhar atendimento"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="space-y-3">
                <div className="rounded-[var(--radius-xl)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-4 py-3">
                  <p className="text-sm font-semibold text-foreground">{selectedLead?.lead_name ?? "Lead selecionado"}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                    A IA sera reativada assim que este handoff for finalizado.
                  </p>
                </div>

                <div className="space-y-2">
                  <label htmlFor="handoff-final-pipeline" className="text-sm font-medium text-foreground">Pipeline de destino</label>
                  <Select value={finalizePipelineId} onValueChange={(value) => { setFinalizePipelineId(value); setFinalizeStageId(""); }} disabled={pipelinesLoading || finalizingHandoff}>
                    <SelectTrigger id="handoff-final-pipeline" className="rounded-[var(--radius-md)] border-[var(--color-border-medium)] bg-[var(--color-bg-surface)]"><SelectValue placeholder={pipelinesLoading ? "Carregando pipelines..." : "Selecione o pipeline"} /></SelectTrigger>
                    <SelectContent className="rounded-[var(--radius-xl)] border-[var(--color-border-medium)] bg-[var(--color-bg-elevated)]">
                      {pipelines.map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label htmlFor="handoff-final-stage" className="text-sm font-medium text-foreground">
                    Etapa de destino
                  </label>
                  <Select value={finalizeStageId} onValueChange={setFinalizeStageId} disabled={stagesLoading || finalizingHandoff}>
                    <SelectTrigger
                      id="handoff-final-stage"
                      className="rounded-[var(--radius-md)] border-[var(--color-border-medium)] bg-[var(--color-bg-surface)]"
                    >
                      <SelectValue placeholder={stagesLoading ? "Carregando etapas..." : "Selecione a etapa"} />
                    </SelectTrigger>
                    <SelectContent className="rounded-[var(--radius-xl)] border-[var(--color-border-medium)] bg-[var(--color-bg-elevated)]">
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
                    setHandoffDialogView("choice");
                    setFinalizeStageId("");
                    setFinalizePipelineId("");
                  }}
                  disabled={finalizingHandoff}
                >
                  Voltar
                </Button>
                <Button onClick={() => void handleFinalizeHandoff()} disabled={finalizingHandoff || pipelinesLoading || stagesLoading || !finalizePipelineId || !finalizeStageId}>
                  {finalizingHandoff ? "Finalizando..." : "Finalizar atendimento"}
                </Button>
              </DialogFooter>
            </>
          )}
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
