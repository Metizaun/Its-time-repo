import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

import type {
  CalendarEvent,
  CalendarEventStatus,
  CalendarEventUpdate,
} from '@/hooks/useCalendarEvents';
import type { Lead } from '@/hooks/useLeads';
import type { Contact } from '@/hooks/useContacts';
import type { Company } from '@/hooks/useCompanies';
import type { Deal } from '@/hooks/useDeals';

interface EditCalendarEventDialogProps {
  event: CalendarEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateEvent: (id: string, payload: CalendarEventUpdate) => Promise<void>;
  leads: Lead[];
  contacts: Contact[];
  companies: Company[];
  deals: Deal[];
}

interface EventFormState {
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  status: CalendarEventStatus;
  location: string;
  meetingUrl: string;
  leadId: string;
  contactId: string;
  companyId: string;
  dealId: string;
  followupEnabled: boolean;
}

const STATUS_TRANSITIONS: Record<CalendarEventStatus, CalendarEventStatus[]> = {
  scheduled: ['confirmed', 'cancelled', 'done', 'no_show'],
  confirmed: ['cancelled', 'done', 'no_show'],
  cancelled: [],
  done: [],
  no_show: [],
};

const toDateTimeLocal = (isoValue?: string | null): string => {
  if (!isoValue) return '';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (value: number) => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const buildFormState = (event: CalendarEvent | null): EventFormState => {
  if (!event) {
    return {
      title: '',
      description: '',
      startTime: '',
      endTime: '',
      allDay: false,
      status: 'scheduled',
      location: '',
      meetingUrl: '',
      leadId: 'none',
      contactId: 'none',
      companyId: 'none',
      dealId: 'none',
      followupEnabled: true,
    };
  }

  return {
    title: event.title,
    description: event.description ?? '',
    startTime: toDateTimeLocal(event.start_time),
    endTime: toDateTimeLocal(event.end_time),
    allDay: event.all_day,
    status: event.status,
    location: event.location ?? '',
    meetingUrl: event.meeting_url ?? '',
    leadId: event.lead_id ?? 'none',
    contactId: event.contact_id ?? 'none',
    companyId: event.company_id ?? 'none',
    dealId: event.deal_id ?? 'none',
    followupEnabled: event.followup_1h_enabled,
  };
};

export function EditCalendarEventDialog({
  event,
  open,
  onOpenChange,
  onUpdateEvent,
  leads,
  contacts,
  companies,
  deals,
}: EditCalendarEventDialogProps) {
  const [form, setForm] = useState<EventFormState>(() => buildFormState(event));
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(buildFormState(event));
    setErrorMessage(null);
  }, [open, event]);

  const allowedStatuses = useMemo(() => {
    if (!event) return ['scheduled'] as CalendarEventStatus[];
    return [event.status, ...STATUS_TRANSITIONS[event.status]];
  }, [event]);

  const handleSubmit = async (formEvent: React.FormEvent) => {
    formEvent.preventDefault();

    if (!event) return;

    if (!form.title.trim()) {
      setErrorMessage('Informe um título para o evento.');
      return;
    }

    if (form.leadId === 'none' && form.contactId === 'none') {
      setErrorMessage('Selecione pelo menos um Lead ou Contact.');
      return;
    }

    const start = new Date(form.startTime);
    const end = new Date(form.endTime);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setErrorMessage('Informe datas válidas para início e fim.');
      return;
    }

    if (end <= start) {
      setErrorMessage('A data final precisa ser maior que a inicial.');
      return;
    }

    const payload: CalendarEventUpdate = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      all_day: form.allDay,
      status: form.status,
      location: form.location.trim() || null,
      meeting_url: form.meetingUrl.trim() || null,
      lead_id: form.leadId === 'none' ? null : form.leadId,
      contact_id: form.contactId === 'none' ? null : form.contactId,
      company_id: form.companyId === 'none' ? null : form.companyId,
      deal_id: form.dealId === 'none' ? null : form.dealId,
      followup_1h_enabled: form.followupEnabled,
    };

    try {
      setSubmitting(true);
      setErrorMessage(null);
      await onUpdateEvent(event.id, payload);
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao atualizar evento';
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!event) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Evento</DialogTitle>
          <DialogDescription>
            Atualize os dados do evento e o vínculo com o CRM.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="edit-calendar-event-title">Título</Label>
            <Input
              id="edit-calendar-event-title"
              value={form.title}
              onChange={(e) => setForm(prev => ({ ...prev, title: e.target.value }))}
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="edit-calendar-event-description">Descrição</Label>
            <Textarea
              id="edit-calendar-event-description"
              value={form.description}
              onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-calendar-event-start">Início</Label>
              <Input
                id="edit-calendar-event-start"
                type="datetime-local"
                value={form.startTime}
                onChange={(e) => setForm(prev => ({ ...prev, startTime: e.target.value }))}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-calendar-event-end">Fim</Label>
              <Input
                id="edit-calendar-event-end"
                type="datetime-local"
                value={form.endTime}
                onChange={(e) => setForm(prev => ({ ...prev, endTime: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(value: CalendarEventStatus) => setForm(prev => ({ ...prev, status: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allowedStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <Label htmlFor="edit-calendar-event-all-day">All day</Label>
              <Switch
                id="edit-calendar-event-all-day"
                checked={form.allDay}
                onCheckedChange={(checked) => setForm(prev => ({ ...prev, allDay: checked }))}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <Label htmlFor="edit-calendar-event-followup">Follow-up 1h</Label>
              <Switch
                id="edit-calendar-event-followup"
                checked={form.followupEnabled}
                onCheckedChange={(checked) => setForm(prev => ({ ...prev, followupEnabled: checked }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-calendar-event-location">Local</Label>
              <Input
                id="edit-calendar-event-location"
                value={form.location}
                onChange={(e) => setForm(prev => ({ ...prev, location: e.target.value }))}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-calendar-event-url">Meeting URL</Label>
              <Input
                id="edit-calendar-event-url"
                value={form.meetingUrl}
                onChange={(e) => setForm(prev => ({ ...prev, meetingUrl: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Lead</Label>
              <Select value={form.leadId} onValueChange={(value) => setForm(prev => ({ ...prev, leadId: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um lead" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {leads.map((lead) => (
                    <SelectItem key={lead.id} value={lead.id}>
                      {lead.first_name} {lead.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Contact</Label>
              <Select value={form.contactId} onValueChange={(value) => setForm(prev => ({ ...prev, contactId: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um contato" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {contacts.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.first_name} {contact.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Company</Label>
              <Select value={form.companyId} onValueChange={(value) => setForm(prev => ({ ...prev, companyId: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma empresa" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhuma</SelectItem>
                  {companies.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Deal</Label>
              <Select value={form.dealId} onValueChange={(value) => setForm(prev => ({ ...prev, dealId: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um deal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {deals.map((deal) => (
                    <SelectItem key={deal.id} value={deal.id}>
                      {deal.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {errorMessage && (
            <div className="text-sm text-destructive border border-destructive/40 rounded-md px-3 py-2">
              {errorMessage}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Salvando...' : 'Salvar alterações'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

