import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquare, Users } from "lucide-react";

import { InternalChatPanel } from "@/components/chat/InternalChatPanel";
import { InternalConversationDialog } from "@/components/chat/InternalConversationDialog";
import { InternalConversationList } from "@/components/chat/InternalConversationList";
import { useChatUnread } from "@/contexts/ChatUnreadContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { createRealtimeChannelName } from "@/lib/realtime";
import { listInternalConversations } from "@/services/internalChatService";
import type { InternalConversation } from "@/types/internalChat";

export function InternalChatWorkspace({
  selectedConversationId,
  onSelectConversation,
  onOpenLeadMode,
  onOpenLead,
}: {
  selectedConversationId: string | null;
  onSelectConversation: (id: string | null) => void;
  onOpenLeadMode: (filter: "all" | "unread" | "manual") => void;
  onOpenLead: (leadId: string) => void;
}) {
  const isMobile = useIsMobile();
  const { internalTotal, byInternalConversation, refetchInternal } = useChatUnread();
  const [conversations, setConversations] = useState<InternalConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newDialogOpen, setNewDialogOpen] = useState(false);

  const refetch = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const next = await listInternalConversations(true);
      setConversations(next);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Nao foi possivel carregar o Chat interno");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    const schedule = () => {
      void Promise.all([refetch(), refetchInternal()]);
    };
    const channel = supabase
      .channel(createRealtimeChannelName("internal-conversation-list"))
      .on("postgres_changes", { event: "*", schema: "crm", table: "internal_conversations" }, schedule)
      .on("postgres_changes", { event: "*", schema: "crm", table: "internal_conversation_members" }, schedule)
      .on("postgres_changes", { event: "INSERT", schema: "crm", table: "internal_messages" }, schedule)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refetch, refetchInternal]);

  const visibleConversations = useMemo(
    () => conversations.map((conversation) => ({
      ...conversation,
      unreadCount: byInternalConversation[conversation.id] ?? conversation.unreadCount,
    })),
    [byInternalConversation, conversations],
  );
  const selectedConversation = useMemo(
    () => visibleConversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [selectedConversationId, visibleConversations],
  );
  const showList = !isMobile || !selectedConversation;
  const showPanel = !isMobile || Boolean(selectedConversation);

  return (
    <div className="grid h-full min-h-0 flex-1 grid-cols-1 overflow-hidden bg-[var(--color-bg-base)] md:grid-cols-[360px_minmax(0,1fr)]">
      {showList ? (
        <InternalConversationList
          conversations={visibleConversations}
          selectedConversationId={selectedConversationId}
          loading={loading}
          error={error}
          internalUnreadCount={internalTotal}
          onSelect={(id) => onSelectConversation(id)}
          onNew={() => setNewDialogOpen(true)}
          onOpenLeadMode={onOpenLeadMode}
          onRetry={() => void refetch(true)}
        />
      ) : null}

      {showPanel ? (
        selectedConversation ? (
          <InternalChatPanel
            key={selectedConversation.id}
            conversation={selectedConversation}
            showBackButton={isMobile}
            onBack={() => onSelectConversation(null)}
            onOpenLead={onOpenLead}
            onConversationChanged={refetch}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-2xl)] bg-[var(--color-surface-1)] text-[var(--color-primary-500)] shadow-sm"><Users className="h-7 w-7" /></div>
            <div><h2 className="text-lg font-bold text-[var(--color-gray-900)]">Chat do Time</h2><p className="mt-1 max-w-sm text-sm text-[var(--color-gray-500)]">Selecione uma conversa ou inicie uma nova para falar com sua equipe.</p></div>
            {error ? <p role="alert" className="text-sm text-[var(--color-error-600)]">{error}</p> : null}
            <button type="button" onClick={() => setNewDialogOpen(true)} className="inline-flex items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-primary-500)] px-4 py-2 text-sm font-semibold text-[var(--color-surface-1)] shadow-primary transition-all hover:-translate-y-px hover:bg-[var(--color-primary-600)] hover:shadow-primary-hover focus-ring"><MessageSquare className="h-4 w-4" /> Nova conversa</button>
          </div>
        )
      ) : null}

      <InternalConversationDialog
        open={newDialogOpen}
        onOpenChange={setNewDialogOpen}
        onCreated={(id) => {
          void refetch();
          onSelectConversation(id);
        }}
      />
    </div>
  );
}
