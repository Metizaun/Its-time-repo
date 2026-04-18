import { ScrollArea } from "@/components/ui/scroll-area";
import { Lead } from "@/hooks/useLeads";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { getUrgencyStyle, getInstanceTextColor } from "@/lib/colors";

interface LeadSidebarProps {
  leads: Lead[];
  selectedLeadId: string | null;
  onSelectLead: (leadId: string) => void;
  loading?: boolean;
}

export function LeadSidebar({ leads, selectedLeadId, onSelectLead, loading }: LeadSidebarProps) {
  if (loading && leads.length === 0) {
    return (
      <div className="h-full border-r border-[var(--color-border-subtle)] bg-transparent p-4 space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-16 w-full rounded-xl bg-[var(--color-border-subtle)] animate-pulse" />
        ))}
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="h-full border-r border-[var(--color-border-subtle)] bg-transparent p-4">
        <p className="text-[var(--color-text-secondary)] text-center text-sm">Nenhum lead encontrado</p>
      </div>
    );
  }

  return (
    <div className="h-full border-r border-[var(--color-border-subtle)] bg-transparent flex flex-col">
      <div className="p-4 border-b border-[var(--color-border-subtle)] flex-shrink-0">
        <h2 className="font-bold text-foreground text-lg">Conversas</h2>
        <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
          {leads.length} lead{leads.length !== 1 ? 's' : ''}
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {leads.map((lead) => {
            const initial = lead.lead_name.charAt(0).toUpperCase();
            const isSelected = lead.id === selectedLeadId;
            
            const lastMessageDate = lead.last_message_at 
              ? format(new Date(lead.last_message_at), "dd/MM/yyyy", { locale: ptBR })
              : format(new Date(lead.created_at), "dd/MM/yyyy", { locale: ptBR });

            const urgencyStyle = getUrgencyStyle(lead.last_tag_urgencia);
            const instanceColor = getInstanceTextColor(lead.instance_color);

            return (
              <button
                key={lead.id}
                onClick={() => onSelectLead(lead.id)}
                className={cn(
                  "w-full p-3 rounded-xl flex items-center gap-3 transition-all duration-200",
                  isSelected
                    ? "bg-[var(--color-border-subtle)] border border-[var(--color-border-medium)] border-t-2 border-t-[var(--color-accent)] shadow-[0_4px_16px_rgba(229,57,58,0.06)]"
                    : "border border-transparent hover:bg-[var(--color-border-subtle)]"
                )}
              >
                {/* Avatar */}
                <div className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold transition-all duration-200",
                  isSelected
                    ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/25"
                    : "bg-[var(--color-border-subtle)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]"
                )}>
                  {initial}
                </div>

                <div className="flex-1 text-left overflow-hidden min-w-0">
                  {/* Linha 1: Nome + Data */}
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className={cn(
                      "font-medium truncate max-w-[180px] text-sm",
                      isSelected ? "text-foreground" : "text-[var(--color-text-primary)]"
                    )}>
                      {lead.lead_name}
                    </p>
                    <span className="text-[10px] text-[var(--color-text-secondary)] shrink-0">
                      {lastMessageDate}
                    </span>
                  </div>
                  
                  {/* Linha 2: Instância • Source (texto simples) */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs truncate">
                      {lead.instance_name && lead.source ? (
                        <>
                          <span className={cn("font-medium", instanceColor)}>
                            {lead.instance_name}
                          </span>
                          <span className="text-[var(--color-text-secondary)]"> • {lead.source}</span>
                        </>
                      ) : lead.instance_name ? (
                        <span className={cn("font-medium", instanceColor)}>
                          {lead.instance_name}
                        </span>
                      ) : lead.source ? (
                        <span className="text-[var(--color-text-secondary)]">{lead.source}</span>
                      ) : (
                        <span className="text-[var(--color-text-secondary)] opacity-50">Sem origem</span>
                      )}
                    </div>

                    {/* Círculo de Urgência + Tag (à direita) */}
                    {lead.last_tag_name && urgencyStyle && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div 
                          className={cn(
                            "w-2 h-2 rounded-full",
                            urgencyStyle.dot
                          )}
                        />
                        <span className={cn("text-xs font-medium", urgencyStyle.text)}>
                          {lead.last_tag_name}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
