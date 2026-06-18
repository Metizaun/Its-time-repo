import { useEffect, useMemo, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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

import type { CalendarEventInsert, CalendarEventStatus } from '@/hooks/useCalendarEvents';
import type { Lead } from '@/hooks/useLeads';
import type { Contact } from '@/hooks/useContacts';
import type { Company } from '@/hooks/useCompanies';
import type { Deal } from '@/hooks/useDeals';

interface AddCalendarEventDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCreateEvent: (payload: CalendarEventInsert) => Promise<void>;
  defaultStart?: string | null;
  defaultEnd?: string | null;
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

const DEFAULT_STATUS: CalendarEventStatus = 'scheduled';

const toDateTimeLocal = (isoValue?: string | null): string => {
  if (!isoValue) return '';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (value: number) => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const buildInitialState = (defaultStart?: string | null, defaultEnd?: string | null): EventFormState => {
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  return {
    title: '',
    description: '',
    startTime: toDateTimeLocal(defaultStart) || toDateTimeLocal(now.toISOString()),
    endTime: toDateTimeLocal(defaultEnd) || toDateTimeLocal(oneHourFromNow.toISOString()),
    allDay: false,
    status: DEFAULT_STATUS,
    location: '',
    meetingUrl: '',
    leadId: 'none',
    contactId: 'none',
    companyId: 'none',
    dealId: 'none',
    followupEnabled: true,
  };
};

export function AddCalendarEventDialog({
  open,
  onOpenChange,
  onCreateEvent,
  defaultStart,
  defaultEnd,
  leads,
  contacts,
  companies,
  deals,
}: AddCalendarEventDialogProps) {
  const controlled = typeof open === 'boolean' && typeof onOpenChange === 'function';

  const [internalOpen, setInternalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [form, setForm] = useState<EventFormState>(() => buildInitialState(defaultStart, defaultEnd));

  const dialogOpen = controlled ? open : internalOpen;
  const setDialogOpen = controlled ? onOpenChange : setInternalOpen;

  const defaultState = useMemo(
    () => buildInitialState(defaultStart, defaultEnd),
    [defaultStart, defaultEnd]
  );

  useEffect(() => {
    if (!dialogOpen) return;
    setForm(defaultState);
    setErrorMessage(null);
  }, [dialogOpen, defaultState]);

  const resetAndClose = () => {
    setForm(defaultState);
    setErrorMessage(null);
    setDialogOpen(false);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);

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

    const payload: CalendarEventInsert = {
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
      await onCreateEvent(payload);
      resetAndClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao criar evento';
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  const content = (
    <DialogContent className="sm:max-w-[720px] max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Novo Evento</DialogTitle>
        <DialogDescription>
          Crie um evento de calendário vinculado a um lead ou contato.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="calendar-event-title">Título</Label>
          <Input
            id="calendar-event-title"
            value={form.title}
            onChange={(e) => setForm(prev => ({ ...prev, title: e.target.value }))}
            placeholder="Ex.: Reunião de discovery"
            required
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="calendar-event-description">Descrição</Label>
          <Textarea
            id="calendar-event-description"
            value={form.description}
            onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
            rows={3}
            placeholder="Contexto, pauta e próximos passos"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="calendar-event-start">Início</Label>
            <Input
              id="calendar-event-start"
              type="datetime-local"
              value={form.startTime}
              onChange={(e) => setForm(prev => ({ ...prev, startTime: e.target.value }))}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="calendar-event-end">Fim</Label>
            <Input
              id="calendar-event-end"
              type="datetime-local"
              value={form.endTime}
              onChange={(e) => setForm(prev => ({ ...prev, endTime: e.target.value }))}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="calendar-event-status">Status</Label>
            <Select
              value={form.status}
              onValueChange={(value: CalendarEventStatus) => setForm(prev => ({ ...prev, status: value }))}
            >
              <SelectTrigger id="calendar-event-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="scheduled">scheduled</SelectItem>
                <SelectItem value="confirmed">confirmed</SelectItem>
                <SelectItem value="cancelled">cancelled</SelectItem>
                <SelectItem value="done">done</SelectItem>
                <SelectItem value="no_show">no_show</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2 md:col-span-1">
            <Label htmlFor="calendar-event-all-day">All day</Label>
            <Switch
              id="calendar-event-all-day"
              checked={form.allDay}
              onCheckedChange={(checked) => setForm(prev => ({ ...prev, allDay: checked }))}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2 md:col-span-1">
            <Label htmlFor="calendar-event-followup">Follow-up 1h</Label>
            <Switch
              id="calendar-event-followup"
              checked={form.followupEnabled}
              onCheckedChange={(checked) => setForm(prev => ({ ...prev, followupEnabled: checked }))}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="calendar-event-location">Local</Label>
            <Input
              id="calendar-event-location"
              value={form.location}
              onChange={(e) => setForm(prev => ({ ...prev, location: e.target.value }))}
              placeholder="Ex.: Sala 3 / Escritório cliente"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="calendar-event-meeting-url">Meeting URL</Label>
            <Input
              id="calendar-event-meeting-url"
              value={form.meetingUrl}
              onChange={(e) => setForm(prev => ({ ...prev, meetingUrl: e.target.value }))}
              placeholder="https://meet..."
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
          <Button type="button" variant="outline" onClick={resetAndClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Salvando...' : 'Criar evento'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );

  if (controlled) {
    return (
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        {content}
      </Dialog>
    );
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button>
          <CalendarPlus className="mr-2 h-4 w-4" />
          Novo evento
        </Button>
      </DialogTrigger>
      {content}
    </Dialog>
  );
}

