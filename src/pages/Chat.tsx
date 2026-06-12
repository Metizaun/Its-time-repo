import { useEffect, useMemo, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import { LeadSidebar } from "@/components/leads/LeadSidebar";
import EditLeadModal from "@/components/modals/EditLeadModal";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/contexts/AuthContext";
import { useChat } from "@/hooks/useChat";
import { useLeadAiControl } from "@/hooks/useLeadAiControl";
import { type Lead, useLeads } from "@/hooks/useLeads";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import type { ChatComposerPayload } from "@/types/chat";

export default function Chat() {
  const { leads, loading: leadsLoading, refetch } = useLeads({ enableRealtime: true });
  const { ui } = useApp();
  const { userRole } = useAuth();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);

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

  return (
    <div className="flex h-[calc(100vh_-_var(--layout-topbar-height))] overflow-hidden">
      {showSidebar && (
        <div className={cn("h-full min-w-0 shrink-0", isMobile ? "w-full" : "w-[var(--chat-sidebar-width)]")}>
          <LeadSidebar
            leads={filteredLeads}
            selectedLeadId={selectedLeadId}
            onSelectLead={handleSelectLead}
            loading={leadsLoading}
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
