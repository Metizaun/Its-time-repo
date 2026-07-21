import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Lead } from "@/hooks/useLeads";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { getUrgencyStyle, getInstanceTextColor } from "@/lib/colors";
import { Building2, Check, ListFilter, Search } from "lucide-react";
import type { Instance } from "@/hooks/useInstances";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEffect, useState } from "react";

type LeadSidebarFilter = "all" | "unread" | "manual";

interface LeadSidebarProps {
  leads: Lead[];
  totalCount: number;
  selectedLeadId: string | null;
  onSelectLead: (leadId: string) => void;
  loading?: boolean;
  activeFilter: LeadSidebarFilter;
  onFilterChange: (filter: LeadSidebarFilter) => void;
  manualCount: number;
  unreadConversationCount: number;
  unreadByLead: Record<string, number>;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  instances: Instance[];
  instancesLoading: boolean;
  selectedInstance: string;
  onInstanceChange: (instanceName: string) => void;
}

function PendingDot({ state }: { state: Lead["manual_pending_state"] }) {
  if (!state || state === "clear") {
    return null;
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "h-2.5 w-2.5 rounded-full shadow-sm",
        state === "waiting_first_reply" ? "bg-[var(--color-warning-500)]" : "bg-[var(--color-success-500)]"
      )}
    />
  );
}

function FilterTab({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  const formattedCount = typeof count === "number" ? (count > 99 ? "99+" : count) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-semibold transition-all duration-200 focus-ring",
        active
          ? "border-[var(--color-primary-200)] bg-[var(--color-primary-50)] text-[var(--color-primary-700)] shadow-sm"
          : "border-[var(--border-default)] bg-[var(--color-surface-1)] text-[var(--color-text-secondary)] hover:border-[var(--color-gray-200)] hover:text-foreground hover:shadow-sm"
      )}
    >
      <span>{label}</span>
      {formattedCount !== null ? (
        <span className="font-mono text-[10px] font-semibold text-current">{formattedCount}</span>
      ) : null}
    </button>
  );
}

export function LeadSidebar({
  leads,
  totalCount,
  selectedLeadId,
  onSelectLead,
  loading,
  activeFilter,
  onFilterChange,
  manualCount,
  unreadConversationCount,
  unreadByLead,
  searchQuery,
  onSearchQueryChange,
  instances,
  instancesLoading,
  selectedInstance,
  onInstanceChange,
}: LeadSidebarProps) {
  const [instanceFilterOpen, setInstanceFilterOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isEditing =
        activeElement?.tagName === "INPUT" ||
        activeElement?.tagName === "TEXTAREA" ||
        activeElement?.getAttribute("contenteditable") === "true";
      const isSearchShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      const isSlashShortcut = event.key === "/" && !isEditing;

      if (!isSearchShortcut && !isSlashShortcut) return;

      event.preventDefault();
      document.getElementById("chat-conversation-search")?.focus();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden border-r border-[var(--color-border-subtle)] bg-transparent">
      <div className="shrink-0 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-foreground">Conversas</h2>
            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
              {totalCount} conversa{totalCount !== 1 ? "s" : ""}
            </p>
          </div>

          <Popover open={instanceFilterOpen} onOpenChange={setInstanceFilterOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Filtrar conversas por instancia"
                    aria-pressed={selectedInstance !== "all"}
                    className={cn(
                      "chat-tool-button h-9 w-9 focus-ring",
                      selectedInstance !== "all" && "chat-tool-button--active text-[var(--color-primary-600)]"
                    )}
                  >
                    <ListFilter className="h-[18px] w-[18px]" />
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">Filtrar por instancia</TooltipContent>
            </Tooltip>
            <PopoverContent
              align="end"
              className="w-64 overflow-hidden rounded-2xl border-[var(--color-border-medium)] bg-[var(--color-bg-elevated)] p-0 shadow-md"
            >
              <div className="border-b border-[var(--color-border-subtle)] px-4 py-3">
                <p className="text-sm font-semibold text-foreground">Instancia</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                  Filtre as conversas disponiveis
                </p>
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto p-2">
                <button
                  type="button"
                  onClick={() => {
                    onInstanceChange("all");
                    setInstanceFilterOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors focus-ring",
                    selectedInstance === "all"
                      ? "bg-[var(--color-primary-50)] text-[var(--color-primary-700)]"
                      : "text-foreground hover:bg-[var(--color-bg-subtle)]"
                  )}
                >
                  <Building2 className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-medium">Todas as instancias</span>
                  {selectedInstance === "all" ? <Check className="h-4 w-4 shrink-0" /> : null}
                </button>
                {instancesLoading ? (
                  <p className="px-3 py-2 text-xs text-[var(--color-text-secondary)]">Carregando instancias...</p>
                ) : (
                  instances.map((instance) => (
                    <button
                      key={instance.instancia}
                      type="button"
                      onClick={() => {
                        onInstanceChange(instance.instancia);
                        setInstanceFilterOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors focus-ring",
                        selectedInstance === instance.instancia
                          ? "bg-[var(--color-primary-50)] text-[var(--color-primary-700)]"
                          : "text-foreground hover:bg-[var(--color-bg-subtle)]"
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--color-primary-400)]"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">{instance.instancia}</span>
                      {selectedInstance === instance.instancia ? <Check className="h-4 w-4 shrink-0" /> : null}
                    </button>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div className="relative mt-3">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-[var(--color-gray-500)]"
          />
          <Input
            id="chat-conversation-search"
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            aria-label="Pesquisar conversas"
            placeholder="Pesquisar conversas (Ctrl+K)"
            className="h-10 rounded-[var(--radius-md)] border-[var(--border-input)] bg-[var(--color-surface-1)] pl-10 pr-3 text-sm shadow-inset focus-visible:border-[var(--border-focus)] focus-visible:shadow-focus"
          />
        </div>

        <div className="mt-3 flex min-w-0 items-center gap-2 overflow-x-auto pb-1">
          <FilterTab active={activeFilter === "all"} label="Todos" onClick={() => onFilterChange("all")} />
          <FilterTab
            active={activeFilter === "unread"}
            label="Não lidas"
            count={unreadConversationCount}
            onClick={() => onFilterChange("unread")}
          />
          <FilterTab
            active={activeFilter === "manual"}
            label="Manual"
            count={manualCount}
            onClick={() => onFilterChange("manual")}
          />
        </div>
      </div>

      {loading && leads.length === 0 ? (
        <div className="flex-1 space-y-3 p-4" aria-label="Carregando conversas">
          {[1, 2, 3, 4, 5].map((item) => (
            <div
              key={item}
              className="h-16 w-full animate-pulse rounded-[var(--radius-xl)] bg-[var(--color-bg-muted)]"
            />
          ))}
        </div>
      ) : leads.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-center text-sm text-[var(--color-text-secondary)]">
            {activeFilter === "manual"
              ? "Nenhum lead em atendimento humano"
              : activeFilter === "unread"
                ? "Nenhuma conversa não lida"
                : "Nenhum lead encontrado"}
          </p>
        </div>
      ) : (
        <ScrollArea className="min-w-0 flex-1">
          <div className="min-w-0 p-2 space-y-1">
            {leads.map((lead) => {
              const initial = lead.lead_name.charAt(0).toUpperCase();
              const isSelected = lead.id === selectedLeadId;
              const lastMessageDate = lead.last_message_at
                ? format(new Date(lead.last_message_at), "dd/MM/yyyy", { locale: ptBR })
                : format(new Date(lead.created_at), "dd/MM/yyyy", { locale: ptBR });

              const urgencyStyle = getUrgencyStyle(lead.last_tag_urgencia);
              const instanceColor = getInstanceTextColor(lead.instance_color);
              const unreadCount = unreadByLead[lead.id] ?? 0;

              return (
                <button
                  key={lead.id}
                  onClick={() => onSelectLead(lead.id)}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl p-3 transition-all duration-200",
                    isSelected
                      ? "bg-[var(--color-surface-1)] border border-[var(--color-primary-200)] shadow-sm"
                      : "border border-transparent hover:bg-[var(--color-border-subtle)]"
                  )}
                >
                  <div
                    className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold transition-all duration-200",
                      isSelected
                        ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/25"
                        : "bg-[var(--color-border-subtle)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]"
                    )}
                  >
                    {initial}
                  </div>

                  <div className="flex-1 min-w-0 text-left overflow-hidden">
                    <div className="mb-1 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <p
                          className={cn(
                            "min-w-0 truncate text-sm font-medium",
                            isSelected ? "text-foreground" : "text-[var(--color-text-primary)]"
                          )}
                        >
                          {lead.lead_name}
                        </p>
                        <PendingDot state={lead.manual_pending_state} />
                      </div>
                      <span className="shrink-0 text-right text-[10px] text-[var(--color-text-secondary)]">
                        {lastMessageDate}
                      </span>
                    </div>

                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <div className="min-w-0 flex-1 truncate text-xs">
                        {lead.instance_name && lead.source ? (
                          <>
                            <span className={cn("font-medium", instanceColor)}>{lead.instance_name}</span>
                            <span className="text-[var(--color-text-secondary)]"> • {lead.source}</span>
                          </>
                        ) : lead.instance_name ? (
                          <span className={cn("font-medium", instanceColor)}>{lead.instance_name}</span>
                        ) : lead.source ? (
                          <span className="text-[var(--color-text-secondary)]">{lead.source}</span>
                        ) : (
                          <span className="text-[var(--color-text-secondary)] opacity-50">Sem origem</span>
                        )}
                      </div>

                      {unreadCount > 0 ? (
                        <span className="inline-flex min-w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-50)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--color-primary-700)]">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      ) : lead.last_tag_name && urgencyStyle ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <div className={cn("w-2 h-2 rounded-full", urgencyStyle.dot)} />
                          <span className={cn("text-xs font-medium", urgencyStyle.text)}>
                            {lead.last_tag_name}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
