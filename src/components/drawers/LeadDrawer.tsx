import { useMemo, useState } from "react";
import { useLeads, Lead, notifyLeadsUpdated } from "@/hooks/useLeads";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { useCalendarEvents } from "@/hooks/useCalendarEvents";
import { useApp } from "@/context/AppContext";
import { StageBadge } from "@/components/kanban/StageBadge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Building2,
  Mail,
  Phone,
  User,
  Calendar,
  FileText,
  MessageSquare,
  DollarSign,
  Signal,
  Edit,
  MessageCircle,
  CalendarPlus,
  Clock3,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { addDays, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import EditLeadModal from "@/components/modals/EditLeadModal";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

export function LeadDrawer() {
  const { ui, closeDrawer } = useApp();
  const { leads } = useLeads({
    enabled: !!ui.drawerLeadId,
    enableRealtime: false,
  });
  const { stages } = usePipelineStages();
  const navigate = useNavigate();
  const [editingLead, setEditingLead] = useState<Lead | null>(null);

  const lead = leads.find((l) => l.id === ui.drawerLeadId);
  const calendarRange = useMemo(() => {
    const start = new Date();
    return { start, end: addDays(start, 90) };
  }, []);
  const { events: calendarEvents } = useCalendarEvents(calendarRange, Boolean(lead?.id));
  const upcomingCalendarEvents = useMemo(() => {
    if (!lead) return [];

    const now = Date.now();
    return calendarEvents
      .filter((event) => event.lead_id === lead.id)
      .filter((event) => event.status !== "cancelled")
      .filter((event) => Date.parse(event.end_time) >= now)
      .sort((left, right) => left.start_time.localeCompare(right.start_time))
      .slice(0, 3);
  }, [calendarEvents, lead]);
  const normalize = (value?: string | null) =>
    (value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();

  const currentStage =
    stages.find((s) => s.id === lead?.stage_id) ||
    stages.find((s) => normalize(s.name) === normalize(lead?.status));

  const handleQuickUpdate = async (newStatus: "Ganho" | "Perdido") => {
    if (!lead) return;

    const targetStage = stages.find((stage) => stage.category === newStatus);

    await supabase
      .from("leads")
      .update({
        status: newStatus,
        stage_id: targetStage?.id || lead.stage_id || null,
      })
      .eq("id", lead.id);

    toast.success(`Lead marcado como ${newStatus}`);
    notifyLeadsUpdated();
    closeDrawer();
  };

  const handleOpenChat = () => {
    if (!lead?.id) return;
    closeDrawer();
    navigate(`/chat?leadId=${lead.id}`);
  };

  const handleOpenCalendar = (createNew = false) => {
    if (!lead?.id) return;
    closeDrawer();
    navigate(`/calendar?leadId=${lead.id}${createNew ? "&new=1" : ""}`);
  };

  if (!lead) return null;

  return (
    <Sheet open={!!ui.drawerLeadId} onOpenChange={(open) => !open && closeDrawer()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle className="text-xl">{lead.lead_name}</SheetTitle>
            <Button variant="outline" size="sm" onClick={() => setEditingLead(lead)}>
              <Edit className="w-4 h-4 mr-2" />
              Editar
            </Button>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="flex items-center gap-2">
            {currentStage ? <StageBadge stage={currentStage} className="text-xs px-3 py-1" /> : null}
          </div>

          <div className="space-y-4">
            {lead.last_city && (
              <div className="flex items-start gap-3">
                <Building2 className="w-5 h-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Cidade</p>
                  <p className="text-sm text-muted-foreground">{lead.last_city}</p>
                </div>
              </div>
            )}

            {lead.email && (
              <div className="flex items-start gap-3">
                <Mail className="w-5 h-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Email</p>
                  <a href={`mailto:${lead.email}`} className="text-sm text-primary hover:underline">
                    {lead.email}
                  </a>
                </div>
              </div>
            )}

            {lead.contact_phone && (
              <div className="flex items-start gap-3">
                <Phone className="w-5 h-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Telefone</p>
                  <p className="text-sm text-muted-foreground">{lead.contact_phone}</p>
                </div>
              </div>
            )}

            {lead.owner_name && (
              <div className="flex items-start gap-3">
                <User className="w-5 h-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Responsavel</p>
                  <p className="text-sm text-muted-foreground">{lead.owner_name}</p>
                </div>
              </div>
            )}

            {lead.source && (
              <div className="flex items-start gap-3">
                <MessageSquare className="w-5 h-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Origem</p>
                  <p className="text-sm text-muted-foreground">{lead.source}</p>
                </div>
              </div>
            )}

            {lead.value !== null && lead.value !== undefined && (
              <div className="flex items-start gap-3">
                <DollarSign className="w-5 h-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Valor da Oportunidade</p>
                  <p className="text-sm text-muted-foreground">
                    R$ {lead.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            )}

            {lead.connection_level && (
              <div className="flex items-start gap-3">
                <Signal className="w-5 h-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Nivel de Conexao</p>
                  <Badge
                    variant={
                      lead.connection_level === "Alta"
                        ? "default"
                        : lead.connection_level === "Media"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {lead.connection_level}
                  </Badge>
                </div>
              </div>
            )}

            <div className="flex items-start gap-3">
              <Calendar className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium">Data de Criacao</p>
                <p className="text-sm text-muted-foreground">
                  {format(parseISO(lead.created_at), "dd 'de' MMMM 'de' yyyy", {
                    locale: ptBR,
                  })}
                </p>
              </div>
            </div>

            {lead.notes && (
              <div className="flex items-start gap-3">
                <FileText className="w-5 h-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Observacoes</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{lead.notes}</p>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]/70 p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Agenda</p>
                <h3 className="text-sm font-semibold">Proximos compromissos</h3>
              </div>
              <Calendar className="h-5 w-5 text-muted-foreground" />
            </div>

            <div className="space-y-2">
              {upcomingCalendarEvents.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[var(--color-border-medium)] p-3 text-sm text-muted-foreground">
                  Nenhum compromisso futuro para este lead.
                </p>
              ) : (
                upcomingCalendarEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => {
                      closeDrawer();
                      navigate(`/calendar?leadId=${lead.id}&eventId=${event.id}`);
                    }}
                    className="w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-3 text-left transition-colors hover:border-[var(--color-primary-200)] hover:bg-[var(--color-primary-50)]"
                  >
                    <p className="line-clamp-1 text-sm font-medium">{event.title}</p>
                    <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock3 className="h-3.5 w-3.5" />
                      {event.all_day
                        ? format(parseISO(event.start_time), "dd/MM", { locale: ptBR })
                        : format(parseISO(event.start_time), "dd/MM 'as' HH:mm", { locale: ptBR })}
                    </span>
                  </button>
                ))
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => handleOpenCalendar(true)}>
                <CalendarPlus className="mr-2 h-4 w-4" />
                Criar evento
              </Button>
              <Button variant="ghost" size="sm" onClick={() => handleOpenCalendar(false)}>
                Ver agenda
              </Button>
            </div>
          </div>

          <div className="flex gap-2 pt-4 border-t">
            <Button variant="outline" size="sm" onClick={handleOpenChat}>
              <MessageCircle className="w-4 h-4 mr-2" />
              Abrir Chat
            </Button>

            <Button variant="default" size="sm" onClick={() => handleQuickUpdate("Ganho")}> 
              <CheckCircle className="w-4 h-4 mr-2" />
              Fechar Venda
            </Button>

            <Button variant="destructive" size="sm" onClick={() => handleQuickUpdate("Perdido")}> 
              <XCircle className="w-4 h-4 mr-2" />
              Perdido
            </Button>
          </div>
        </div>
      </SheetContent>

      <EditLeadModal
        lead={editingLead}
        open={!!editingLead}
        onClose={() => setEditingLead(null)}
        onSuccess={() => {
          setEditingLead(null);
        }}
      />
    </Sheet>
  );
}
