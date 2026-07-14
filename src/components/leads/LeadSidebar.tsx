import { ScrollArea } from "@/components/ui/scroll-area";
import { Lead } from "@/hooks/useLeads";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { getUrgencyStyle, getInstanceTextColor } from "@/lib/colors";

type LeadSidebarFilter = "all" | "manual";

interface LeadSidebarProps {
  leads: Lead[];
  selectedLeadId: string | null;
  onSelectLead: (leadId: string) => void;
  loading?: boolean;
  activeFilter: LeadSidebarFilter;
  onFilterChange: (filter: LeadSidebarFilter) => void;
  manualCount: number;
  unreadByLead: Record<string, number>;
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
  badge,
  onClick,
}: {
  active: boolean;
  label: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200 focus-ring",
        active
          ? "bg-[var(--color-surface-1)] text-foreground shadow-sm"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-1)] hover:text-foreground"
      )}
    >
      <span>{label}</span>
      {typeof badge === "number" ? (
        <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-[var(--color-bg-inverse)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-surface-1)]">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

export function LeadSidebar({
  leads,
  selectedLeadId,
  onSelectLead,
  loading,
  activeFilter,
  onFilterChange,
  manualCount,
  unreadByLead,
}: LeadSidebarProps) {
  if (loading && leads.length === 0) {
    return (
      <div className="h-full min-w-0 overflow-hidden border-r border-[var(--color-border-subtle)] bg-transparent p-4 space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-16 w-full rounded-xl bg-[var(--color-border-subtle)] animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden border-r border-[var(--color-border-subtle)] bg-transparent">
      <div className="flex h-[var(--chat-header-height)] flex-shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-4">
        <div>
          <h2 className="text-lg font-bold text-foreground">Conversas</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
            {activeFilter === "manual" ? `${manualCount} em atendimento humano` : `${leads.length} lead${leads.length !== 1 ? "s" : ""}`}
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-full bg-[var(--color-bg-subtle)] p-1">
          <FilterTab active={activeFilter === "all"} label="Todos" onClick={() => onFilterChange("all")} />
          <FilterTab
            active={activeFilter === "manual"}
            label="Chat Manual"
            badge={manualCount}
            onClick={() => onFilterChange("manual")}
          />
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-center text-sm text-[var(--color-text-secondary)]">
            {activeFilter === "manual"
              ? "Nenhum lead em atendimento humano"
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
