import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Lead } from "@/hooks/useLeads";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
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
      <div className="h-full border-r border-border bg-card p-4 space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="h-full border-r border-border bg-card p-4">
        <p className="text-muted-foreground text-center">Nenhum lead encontrado</p>
      </div>
    );
  }

  return (
    <div className="h-full border-r border-border bg-card flex flex-col">
      <div className="p-4 border-b border-border flex-shrink-0">
        <h2 className="font-semibold text-lg">Conversas</h2>
        <p className="text-sm text-muted-foreground">
          {leads.length} lead{leads.length !== 1 ? 's' : ''}
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
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
                  "w-full p-3 rounded-lg flex items-center gap-3 transition-colors hover:bg-muted/50",
                  isSelected && "bg-muted"
                )}
              >
                <Avatar className="shrink-0">
                  <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                    {initial}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 text-left overflow-hidden min-w-0">
                  {/* Linha 1: Nome + Data */}
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="font-medium truncate max-w-[180px]">
                      {lead.lead_name}
                    </p>
                    <span className="text-xs text-muted-foreground shrink-0">
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
                          <span className="text-muted-foreground"> • {lead.source}</span>
                        </>
                      ) : lead.instance_name ? (
                        <span className={cn("font-medium", instanceColor)}>
                          {lead.instance_name}
                        </span>
                      ) : lead.source ? (
                        <span className="text-muted-foreground">{lead.source}</span>
                      ) : (
                        <span className="text-muted-foreground opacity-50">Sem origem</span>
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
