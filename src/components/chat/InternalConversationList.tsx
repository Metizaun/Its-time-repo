import { useMemo, useState } from "react";
import { AlertCircle, Archive, Plus, Search, Users } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";

import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getInternalConversationName } from "@/lib/internalChat";
import { cn } from "@/lib/utils";
import type { InternalConversation } from "@/types/internalChat";

function formatConversationTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (isToday(date)) return format(date, "HH:mm");
  if (isYesterday(date)) return "Ontem";
  return format(date, "dd/MM/yy", { locale: ptBR });
}

function ModeTab({ label, active, count, onClick }: { label: string; active?: boolean; count?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-semibold transition-all duration-200 focus-ring",
        active
          ? "border-[var(--color-primary-200)] bg-[var(--color-primary-50)] text-[var(--color-primary-700)] shadow-sm"
          : "border-[var(--border-default)] bg-[var(--color-surface-1)] text-[var(--color-gray-600)] hover:shadow-sm",
      )}
    >
      {label}
      {typeof count === "number" && count > 0 ? <span className="font-mono text-[10px]">{count > 99 ? "99+" : count}</span> : null}
    </button>
  );
}

export function InternalConversationList({
  conversations,
  selectedConversationId,
  loading,
  error,
  internalUnreadCount,
  onSelect,
  onNew,
  onOpenLeadMode,
  onRetry,
}: {
  conversations: InternalConversation[];
  selectedConversationId: string | null;
  loading: boolean;
  error?: string | null;
  internalUnreadCount: number;
  onSelect: (id: string) => void;
  onNew: () => void;
  onOpenLeadMode: (filter: "all" | "unread" | "manual") => void;
  onRetry: () => void;
}) {
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return conversations.filter((conversation) => {
      if (Boolean(conversation.archivedAt) !== showArchived) return false;
      if (!query) return true;
      return `${getInternalConversationName(conversation)} ${conversation.members.map((member) => member.name).join(" ")}`
        .toLocaleLowerCase("pt-BR")
        .includes(query);
    });
  }, [conversations, search, showArchived]);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden border-r border-[var(--border-default)]">
      <div className="shrink-0 border-b border-[var(--border-default)] bg-[var(--color-surface-1)] px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="text-lg font-bold text-[var(--color-gray-900)]">Time</h2><p className="mt-0.5 text-xs text-[var(--color-gray-500)]">{filtered.length} conversa{filtered.length === 1 ? "" : "s"}</p></div>
          <div className="flex gap-1">
            <button type="button" aria-label={showArchived ? "Ver conversas ativas" : "Ver conversas arquivadas"} aria-pressed={showArchived} onClick={() => setShowArchived((value) => !value)} className={cn("chat-tool-button h-9 w-9 focus-ring", showArchived && "chat-tool-button--active text-[var(--color-primary-600)]")}><Archive className="h-[18px] w-[18px]" /></button>
            <button type="button" aria-label="Nova conversa" onClick={onNew} className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-primary-500)] text-[var(--color-surface-1)] shadow-primary transition-all hover:-translate-y-px hover:bg-[var(--color-primary-600)] hover:shadow-primary-hover focus-ring"><Plus className="h-[18px] w-[18px]" /></button>
          </div>
        </div>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-gray-500)]" />
          <Input id="team-conversation-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar no Time" aria-label="Pesquisar conversas do Time" className="pl-10" />
        </div>
        <div className="mt-3 flex min-w-0 items-center gap-2 overflow-x-auto pb-1">
          <ModeTab label="Todos" onClick={() => onOpenLeadMode("all")} />
          <ModeTab label="Não lidas" onClick={() => onOpenLeadMode("unread")} />
          <ModeTab label="Manual" onClick={() => onOpenLeadMode("manual")} />
          <ModeTab label="Time" active count={internalUnreadCount} onClick={() => undefined} />
        </div>
      </div>

      {loading ? (
        <div className="flex-1 space-y-3 p-4" aria-label="Carregando conversas do Time">{[1, 2, 3, 4, 5].map((item) => <div key={item} className="h-16 animate-pulse rounded-[var(--radius-xl)] bg-[var(--color-bg-muted)]" />)}</div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
          <AlertCircle className="h-7 w-7 text-[var(--color-error-500)]" />
          <p className="max-w-xs text-sm text-[var(--color-gray-600)]">{error}</p>
          <button type="button" onClick={onRetry} className="text-sm font-semibold text-[var(--color-primary-600)] focus-ring">Tentar novamente</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"><Users className="h-7 w-7 text-[var(--color-gray-400)]" /><p className="text-sm text-[var(--color-gray-600)]">{showArchived ? "Nenhuma conversa arquivada" : "Nenhuma conversa do Time"}</p>{!showArchived ? <button type="button" onClick={onNew} className="text-sm font-semibold text-[var(--color-primary-600)] focus-ring">Iniciar conversa</button> : null}</div>
      ) : (
        <ScrollArea className="min-w-0 flex-1">
          <div className="space-y-1 p-2">
            {filtered.map((conversation) => {
              const name = getInternalConversationName(conversation);
              const selected = conversation.id === selectedConversationId;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-3 rounded-[var(--radius-xl)] border p-3 text-left transition-all duration-200 focus-ring",
                    selected ? "border-[var(--color-primary-200)] bg-[var(--color-surface-1)] shadow-sm" : "border-transparent hover:-translate-y-0.5 hover:bg-[var(--color-surface-2)] hover:shadow-sm",
                  )}
                >
                  <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold", conversation.kind === "group" ? "bg-[var(--color-primary-50)] text-[var(--color-primary-700)]" : "bg-[var(--color-surface-3)] text-[var(--color-gray-700)]")}>{conversation.kind === "group" ? <Users className="h-4 w-4" /> : name.charAt(0).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-[var(--color-gray-800)]">{name}</span><span className="shrink-0 font-mono text-[10px] text-[var(--color-gray-500)]">{formatConversationTime(conversation.lastMessageAt || conversation.createdAt)}</span></span>
                    <span className="mt-1 flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs text-[var(--color-gray-500)]">{conversation.lastMessage ? `${conversation.lastMessage.authorName}: ${conversation.lastMessage.preview}` : "Conversa iniciada"}</span>{conversation.unreadCount > 0 ? <span className="inline-flex min-w-6 justify-center rounded-full bg-[var(--color-primary-50)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--color-primary-700)]">{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}</span> : null}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
