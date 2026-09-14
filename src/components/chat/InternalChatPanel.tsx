import { useCallback, useState } from "react";
import { ArrowLeft, Info, Users } from "lucide-react";

import { ChatInput } from "@/components/chat/ChatInput";
import { InternalConversationDetailsDialog } from "@/components/chat/InternalConversationDetailsDialog";
import { getInternalConversationName } from "@/lib/internalChat";
import { InternalMessageList } from "@/components/chat/InternalMessageList";
import { useAuth } from "@/contexts/AuthContext";
import { useInternalChat } from "@/hooks/useInternalChat";
import { searchInternalMentionableLeads } from "@/services/internalChatService";
import type { ChatMentionSuggestion } from "@/types/chat";
import type { InternalConversation, InternalMessage } from "@/types/internalChat";

export function InternalChatPanel({
  conversation,
  showBackButton,
  onBack,
  onOpenLead,
  onConversationChanged,
}: {
  conversation: InternalConversation;
  showBackButton: boolean;
  onBack: () => void;
  onOpenLead: (leadId: string) => void;
  onConversationChanged: () => Promise<void>;
}) {
  const { userRole } = useAuth();
  const { messages, loading, loadingOlder, hasMore, loadOlder, sendMessage } = useInternalChat(
    conversation.canRead ? conversation.id : null,
  );
  const [replyingTo, setReplyingTo] = useState<InternalMessage | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const name = getInternalConversationName(conversation);
  const canManage = userRole === "ADMIN" || conversation.currentUserIsAdmin;

  const mentionSearch = useCallback(async (trigger: "@" | "#", query: string): Promise<ChatMentionSuggestion[]> => {
    const normalized = query.toLocaleLowerCase("pt-BR");
    if (trigger === "#") {
      if (!query.trim()) return [];
      const leads = await searchInternalMentionableLeads(query);
      return leads.map((lead) => ({ id: `lead-${lead.id}`, type: "lead", label: `#${lead.name}`, description: "Abrir conversa do lead", leadId: lead.id }));
    }
    const members = conversation.members
      .filter((member) => !normalized || `${member.name} ${member.email}`.toLocaleLowerCase("pt-BR").includes(normalized))
      .map((member) => ({ id: `user-${member.userId}`, type: "user" as const, label: `@${member.name}`, description: member.email, userId: member.userId }));
    const all: ChatMentionSuggestion[] = !normalized || "all".startsWith(normalized)
      ? [{ id: "all", type: "all", label: "@all", description: "Mencionar toda a conversa" }]
      : [];
    return [...all, ...members];
  }, [conversation.members]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-surface-1)]">
      <header className="flex h-[var(--chat-header-height)] shrink-0 items-center justify-between gap-3 border-b border-[var(--border-default)] bg-[var(--color-surface-1)] px-4 md:px-5">
        <div className="flex min-w-0 items-center gap-3">
          {showBackButton ? <button type="button" aria-label="Voltar para conversas" onClick={onBack} className="chat-tool-button focus-ring md:hidden"><ArrowLeft className="h-4 w-4" /></button> : null}
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-50)] font-bold text-[var(--color-primary-700)]">{conversation.kind === "group" ? <Users className="h-4 w-4" /> : name.charAt(0).toUpperCase()}</span>
          <div className="min-w-0"><h2 className="truncate text-base font-bold text-[var(--color-gray-900)]">{name}</h2><p className="truncate text-xs text-[var(--color-gray-500)]">{conversation.kind === "group" ? `${conversation.members.length} participantes` : "Conversa interna"}</p></div>
        </div>
        <button type="button" aria-label="Abrir detalhes da conversa" onClick={() => setDetailsOpen(true)} className="chat-tool-button h-9 w-9 focus-ring"><Info className="h-[18px] w-[18px]" /></button>
      </header>

      {conversation.canRead ? (
        <InternalMessageList
          messages={messages}
          loading={loading}
          loadingOlder={loadingOlder}
          hasMore={hasMore}
          isGroup={conversation.kind === "group"}
          onLoadOlder={() => void loadOlder()}
          onReply={setReplyingTo}
          onOpenLead={onOpenLead}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-[var(--color-bg-base)] p-8 text-center">
          <Users className="h-7 w-7 text-[var(--color-gray-400)]" />
          <div><h3 className="text-base font-bold text-[var(--color-gray-800)]">Somente gestão</h3><p className="mt-1 max-w-sm text-sm text-[var(--color-gray-500)]">Como administrador da conta, voce pode gerenciar este grupo, mas as mensagens permanecem visiveis apenas para participantes.</p></div>
        </div>
      )}

      {!conversation.canRead ? null : conversation.archivedAt ? (
        <div className="border-t border-[var(--border-default)] bg-[var(--color-surface-2)] px-4 py-4 text-center text-sm text-[var(--color-gray-600)]">Esta conversa esta arquivada. Restaure-a nos detalhes para enviar mensagens.</div>
      ) : (
        <ChatInput
          onSend={async (payload) => {
            await sendMessage(payload, replyingTo?.id ?? null);
            setReplyingTo(null);
          }}
          mentionSearch={mentionSearch}
          replyPreview={replyingTo ? { authorName: replyingTo.authorName, preview: replyingTo.segments.map((segment) => segment.text).join("") } : null}
          onCancelReply={() => setReplyingTo(null)}
        />
      )}

      <InternalConversationDetailsDialog
        conversation={conversation}
        open={detailsOpen}
        canManage={canManage}
        onOpenChange={setDetailsOpen}
        onChanged={async () => {
          await onConversationChanged();
        }}
      />
    </div>
  );
}
