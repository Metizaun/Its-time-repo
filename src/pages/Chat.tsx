import { useEffect, useMemo, useState } from "react";
import { useLeads, Lead } from "@/hooks/useLeads";
import { useChat } from "@/hooks/useChat";
import { LeadSidebar } from "@/components/leads/LeadSidebar";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { MessageList } from "@/components/chat/MessageList";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageSquare } from "lucide-react";
import EditLeadModal from "@/components/modals/EditLeadModal";
import { useApp } from "@/context/AppContext";
import { useSearchParams } from "react-router-dom";

export default function Chat() {
  const { leads, loading: leadsLoading, refetch } = useLeads({ enableRealtime: true });
  const { ui } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  
  // Hook de chat conectado ao lead selecionado
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

  // Encontra o objeto Lead baseado no ID selecionado dentro da lista filtrada
  const selectedLead = filteredLeads.find((l) => l.id === selectedLeadId);

  return (
    <div className="h-[calc(100vh-4rem)] flex">
      {/* Barra lateral com a lista de Leads */}
      <LeadSidebar
        leads={filteredLeads}
        selectedLeadId={selectedLeadId}
        onSelectLead={handleSelectLead}
        loading={leadsLoading}
      />

      {/* Área Principal do Chat */}
      <div className="flex-1 flex flex-col">
        {selectedLead ? (
          <>
            {/* Header simples: apenas Avatar + Nome */}
            <ChatHeader 
              leadName={selectedLead.lead_name}
              instanceName={selectedLead.instance_name}
              onOpenDetails={() => setEditingLead(selectedLead)}
            />
            
            <MessageList messages={messages} loading={messagesLoading} />
            
            <ChatInput 
              onSend={(msg) => sendMessage(
                msg, 
                selectedLead.contact_phone || undefined,
                selectedLead.instance_name
              )} 
            />
          </>
        ) : (
          // Estado vazio (nenhum chat selecionado)
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-5">
              <div className="w-20 h-20 rounded-full bg-transparent border border-t-2 border-t-[var(--color-accent)] border-white/5 flex items-center justify-center shadow-[0_8px_32px_rgba(229,57,58,0.08)]">
                <MessageSquare className="w-9 h-9 text-[var(--color-text-secondary)]" />
              </div>
              <div className="text-center space-y-1">
                <h2 className="text-xl font-bold text-white">Selecione uma conversa</h2>
                <p className="text-sm text-[var(--color-text-secondary)] max-w-xs">Escolha um lead na barra lateral para começar</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal de Edição do Lead */}
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
