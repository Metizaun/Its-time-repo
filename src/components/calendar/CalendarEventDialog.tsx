import { useEffect, useMemo, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import { BellRing, CalendarClock, Link2, MapPin, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import type { Lead } from "@/hooks/useLeads";
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarFollowupStatus,
  CalendarEventStatus,
  CalendarOpportunity,
} from "@/types/calendar";

const STATUS_OPTIONS: Array<{ value: CalendarEventStatus; label: string }> = [
  { value: "scheduled", label: "Agendado" },
  { value: "confirmed", label: "Confirmado" },
  { value: "done", label: "Concluido" },
  { value: "cancelled", label: "Cancelado" },
  { value: "no_show", label: "Nao compareceu" },
];

const FOLLOWUP_STATUS_LABELS: Record<CalendarFollowupStatus, string> = {
  disabled: "Desligado",
  pending: "Pendente",
  sending: "Enviando",
  sent: "Enviado",
  failed: "Falhou",
  skipped: "Ignorado",
};

const FOLLOWUP_STATUS_STYLES: Record<CalendarFollowupStatus, string> = {
  disabled: "border-[var(--color-gray-200)] bg-[var(--color-gray-100)] text-[var(--color-gray-700)]",
  pending: "border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] text-[var(--color-warning-600)]",
  sending: "border-[var(--color-primary-200)] bg-[var(--color-primary-50)] text-[var(--color-primary-700)]",
  sent: "border-[var(--color-success-border)] bg-[var(--color-success-bg)] text-[var(--color-success-600)]",
  failed: "border-[var(--color-error-border)] bg-[var(--color-error-bg)] text-[var(--color-error-600)]",
  skipped: "border-[var(--color-border-medium)] bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]",
};

function toDateValue(value: Date | string) {
  const date = typeof value === "string" ? parseISO(value) : value;
  return format(date, "yyyy-MM-dd");
}

function toTimeValue(value: Date | string) {
  const date = typeof value === "string" ? parseISO(value) : value;
  return format(date, "HH:mm");
}

function buildLocalDate(date: string, time: string) {
  return new Date(`${date}T${time || "00:00"}`);
}

function formatOpportunity(opportunity: CalendarOpportunity) {
  const value = opportunity.value
    ? opportunity.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "sem valor";
  return `${opportunity.status ?? "Oportunidade"} - ${value}`;
}

interface CalendarEventDialogProps {
  open: boolean;
  event: CalendarEvent | null;
  defaultStart: Date;
  defaultEnd: Date;
  leads: Lead[];
  defaultLeadId?: string | null;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CalendarEventInput) => Promise<{ data: CalendarEvent | null; error: unknown | null }>;
  onUpdate: (
    eventId: string,
    input: CalendarEventInput
  ) => Promise<{ data: CalendarEvent | null; error: unknown | null }>;
  onDelete: (eventId: string) => Promise<{ error: unknown | null }>;
}

export function CalendarEventDialog({
  open,
  event,
  defaultStart,
  defaultEnd,
  leads,
  defaultLeadId,
  onOpenChange,
  onCreate,
  onUpdate,
  onDelete,
}: CalendarEventDialogProps) {
  const [title, setTitle] = useState("");
  const [leadId, setLeadId] = useState("");
  const [opportunityId, setOpportunityId] = useState("none");
  const [status, setStatus] = useState<CalendarEventStatus>("scheduled");
  const [date, setDate] = useState(toDateValue(defaultStart));
  const [startTime, setStartTime] = useState(toTimeValue(defaultStart));
  const [endTime, setEndTime] = useState(toTimeValue(defaultEnd));
  const [allDay, setAllDay] = useState(false);
  const [followupEnabled, setFollowupEnabled] = useState(false);
  const [location, setLocation] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [opportunities, setOpportunities] = useState<CalendarOpportunity[]>([]);
  const [loadingOpportunities, setLoadingOpportunities] = useState(false);

  const selectedLead = useMemo(() => leads.find((lead) => lead.id === leadId) ?? null, [leadId, leads]);

  useEffect(() => {
    if (!open) return;

    if (event) {
      setTitle(event.title);
      setLeadId(event.lead_id);
      setOpportunityId(event.opportunity_id ?? "none");
      setStatus(event.status);
      setDate(toDateValue(event.start_time));
      setStartTime(toTimeValue(event.start_time));
      setEndTime(toTimeValue(event.end_time));
      setAllDay(event.all_day);
      setFollowupEnabled(event.followup_1h_enabled);
      setLocation(event.location ?? "");
      setMeetingUrl(event.meeting_url ?? "");
      setDescription(event.description ?? "");
      return;
    }

    setTitle("");
    setLeadId(defaultLeadId && leads.some((lead) => lead.id === defaultLeadId) ? defaultLeadId : leads[0]?.id ?? "");
    setOpportunityId("none");
    setStatus("scheduled");
    setDate(toDateValue(defaultStart));
    setStartTime(toTimeValue(defaultStart));
    setEndTime(toTimeValue(defaultEnd));
    setAllDay(false);
    setFollowupEnabled(false);
    setLocation("");
    setMeetingUrl("");
    setDescription("");
  }, [defaultEnd, defaultLeadId, defaultStart, event, leads, open]);

  useEffect(() => {
    if (!open || !leadId) {
      setOpportunities([]);
      return;
    }

    let cancelled = false;

    const fetchOpportunities = async () => {
      try {
        setLoadingOpportunities(true);

        const { data, error } = await supabase
          .from("opportunities")
          .select("id, lead_id, status, value, connection_level, created_at")
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false });

        if (error) throw error;
        if (!cancelled) setOpportunities((data ?? []) as CalendarOpportunity[]);
      } catch (error) {
        console.error("Erro ao carregar oportunidades do lead:", error);
        if (!cancelled) setOpportunities([]);
      } finally {
        if (!cancelled) setLoadingOpportunities(false);
      }
    };

    void fetchOpportunities();

    return () => {
      cancelled = true;
    };
  }, [leadId, open]);

  useEffect(() => {
    if (opportunityId === "none") return;
    if (!opportunities.some((opportunity) => opportunity.id === opportunityId)) {
      setOpportunityId("none");
    }
  }, [opportunities, opportunityId]);

  async function handleSubmit(eventSubmit: React.FormEvent<HTMLFormElement>) {
    eventSubmit.preventDefault();
    setSubmitting(true);

    const startDate = allDay ? buildLocalDate(date, "00:00") : buildLocalDate(date, startTime);
    const endDate = allDay ? addDays(startDate, 1) : buildLocalDate(date, endTime);

    const input: CalendarEventInput = {
      title,
      lead_id: leadId,
      opportunity_id: opportunityId === "none" ? null : opportunityId,
      status,
      start_time: startDate.toISOString(),
      end_time: endDate.toISOString(),
      all_day: allDay,
      followup_1h_enabled: followupEnabled,
      location,
      meeting_url: meetingUrl,
      description,
    };

    const result = event ? await onUpdate(event.id, input) : await onCreate(input);
    setSubmitting(false);

    if (!result.error) {
      onOpenChange(false);
    }
  }

  async function handleDelete() {
    if (!event) return;
    setSubmitting(true);
    const result = await onDelete(event.id);
    setSubmitting(false);
    if (!result.error) {
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-[var(--color-border-subtle)] bg-white/95 p-0 shadow-[0_24px_70px_rgba(26,24,20,0.18)] backdrop-blur sm:max-w-xl">
        <DialogHeader className="border-b border-[var(--color-border-subtle)] px-5 pb-4 pt-5">
          <DialogTitle>{event ? "Editar evento" : "Novo evento"}</DialogTitle>
          <DialogDescription>
            Registre o compromisso, vincule ao lead e ative lembrete quando fizer sentido.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4 px-5 pb-5 pt-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-[1.3fr_0.7fr]">
            <div className="space-y-2">
              <Label htmlFor="calendar-title">Titulo</Label>
              <Input
                id="calendar-title"
                value={title}
                onChange={(inputEvent) => setTitle(inputEvent.target.value)}
                placeholder="Ex.: Consulta de avaliacao"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as CalendarEventStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Lead</Label>
              <Select value={leadId} onValueChange={setLeadId} disabled={leads.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um lead" />
                </SelectTrigger>
                <SelectContent>
                  {leads.map((lead) => (
                    <SelectItem key={lead.id} value={lead.id}>
                      {lead.lead_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedLead ? (
                <p className="text-xs text-[var(--color-text-secondary)]">
                  {selectedLead.contact_phone || selectedLead.email || "Lead sem contato cadastrado"}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label>Oportunidade</Label>
              <Select value={opportunityId} onValueChange={setOpportunityId} disabled={!leadId || loadingOpportunities}>
                <SelectTrigger>
                  <SelectValue placeholder="Opcional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem oportunidade</SelectItem>
                  {opportunities.map((opportunity) => (
                    <SelectItem key={opportunity.id} value={opportunity.id}>
                      {formatOpportunity(opportunity)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3 border-t border-[var(--color-border-subtle)] pt-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
              <CalendarClock className="h-4 w-4 text-[var(--color-accent)]" />
              Data e horario
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="calendar-date">Data</Label>
                <Input id="calendar-date" type="date" value={date} onChange={(inputEvent) => setDate(inputEvent.target.value)} required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="calendar-start">Inicio</Label>
                <Input
                  id="calendar-start"
                  type="time"
                  value={startTime}
                  onChange={(inputEvent) => setStartTime(inputEvent.target.value)}
                  disabled={allDay}
                  required={!allDay}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="calendar-end">Fim</Label>
                <Input
                  id="calendar-end"
                  type="time"
                  value={endTime}
                  onChange={(inputEvent) => setEndTime(inputEvent.target.value)}
                  disabled={allDay}
                  required={!allDay}
                />
              </div>
            </div>

            <label className="mt-4 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(inputEvent) => setAllDay(inputEvent.target.checked)}
                className="h-4 w-4 rounded border-[var(--color-border-medium)] accent-[var(--color-accent)]"
              />
              Evento de dia inteiro
            </label>
          </div>

          <div className="border-t border-[var(--color-border-subtle)] pt-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                  <BellRing className="h-4 w-4 text-[var(--color-accent)]" />
                  Lembrete 1h antes
                </div>
                <p className="max-w-md text-xs text-[var(--color-text-secondary)]">
                  Envia WhatsApp automatico para o lead usando a instancia vinculada.
                </p>
                {event ? (
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <Badge
                      variant="outline"
                      className={FOLLOWUP_STATUS_STYLES[event.followup_1h_status]}
                    >
                      {FOLLOWUP_STATUS_LABELS[event.followup_1h_status]}
                    </Badge>
                    {event.followup_1h_error ? (
                      <span className="text-xs text-[var(--color-error-600)]">
                        {event.followup_1h_error}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="flex items-center gap-3">
                <Switch
                  id="calendar-followup"
                  checked={followupEnabled}
                  onCheckedChange={setFollowupEnabled}
                />
                <Label htmlFor="calendar-followup" className="text-sm">
                  {followupEnabled ? "Ativado" : "Desativado"}
                </Label>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="calendar-location" className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5" />
                Local
              </Label>
              <Input
                id="calendar-location"
                value={location}
                onChange={(inputEvent) => setLocation(inputEvent.target.value)}
                placeholder="Clinica, unidade ou cidade"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="calendar-meeting-url" className="flex items-center gap-2">
                <Link2 className="h-3.5 w-3.5" />
                Link de reuniao
              </Label>
              <Input
                id="calendar-meeting-url"
                value={meetingUrl}
                onChange={(inputEvent) => setMeetingUrl(inputEvent.target.value)}
                placeholder="https://..."
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="calendar-description">Descricao</Label>
            <Textarea
              id="calendar-description"
              value={description}
              onChange={(inputEvent) => setDescription(inputEvent.target.value)}
              placeholder="Contexto, combinados e proximos passos"
              className="min-h-[110px] rounded-2xl bg-[var(--color-surface-1)]"
            />
          </div>

          <DialogFooter className="gap-2 border-t border-[var(--color-border-subtle)] pt-4">
            {event ? (
              <Button type="button" variant="outline" onClick={handleDelete} disabled={submitting} className="mr-auto">
                <Trash2 className="mr-2 h-4 w-4" />
                Excluir
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting || leads.length === 0}>
              {submitting ? "Salvando..." : event ? "Salvar alteracoes" : "Criar evento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
