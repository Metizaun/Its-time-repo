import { useState } from 'react';
import { CalendarDays, ExternalLink, MapPin, Pencil, Trash2, CheckCircle2, XCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { CalendarEvent } from '@/hooks/useCalendarEvents';

interface CalendarEventDetailDialogProps {
  event: CalendarEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditEvent: () => void;
  onMarkEventDone: (eventId: string) => Promise<void>;
  onCancelEvent: (eventId: string) => Promise<void>;
  onDeleteEvent: (eventId: string) => Promise<void>;
}

const STATUS_VARIANT: Record<CalendarEvent['status'], string> = {
  scheduled: 'bg-blue-100 text-blue-700',
  confirmed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
  done: 'bg-slate-200 text-slate-700',
  no_show: 'bg-amber-100 text-amber-700',
};

const formatDateTime = (value: string) => {
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export function CalendarEventDetailDialog({
  event,
  open,
  onOpenChange,
  onEditEvent,
  onMarkEventDone,
  onCancelEvent,
  onDeleteEvent,
}: CalendarEventDetailDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  if (!event) {
    return null;
  }

  const runAction = async (action: () => Promise<void>) => {
    try {
      setSubmitting(true);
      await action();
    } finally {
      setSubmitting(false);
    }
  };

  const showDoneAction = event.status === 'scheduled' || event.status === 'confirmed';
  const showCancelAction = event.status === 'scheduled' || event.status === 'confirmed';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            {event.title}
          </DialogTitle>
          <DialogDescription>
            Origem: {event.source} • Evento ID: {event.id}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge className={STATUS_VARIANT[event.status]}>{event.status}</Badge>
            {event.all_day && <Badge variant="outline">all_day</Badge>}
          </div>

          {event.description && (
            <div>
              <p className="text-sm font-medium">Descrição</p>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{event.description}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <p className="font-medium">Início</p>
              <p className="text-muted-foreground">{formatDateTime(event.start_time)}</p>
            </div>
            <div>
              <p className="font-medium">Fim</p>
              <p className="text-muted-foreground">{formatDateTime(event.end_time)}</p>
            </div>
            <div>
              <p className="font-medium">Lead</p>
              <p className="text-muted-foreground">{event.lead_id ?? '-'}</p>
            </div>
            <div>
              <p className="font-medium">Contact</p>
              <p className="text-muted-foreground">{event.contact_id ?? '-'}</p>
            </div>
            <div>
              <p className="font-medium">Deal</p>
              <p className="text-muted-foreground">{event.deal_id ?? '-'}</p>
            </div>
            <div>
              <p className="font-medium">Follow-up 1h</p>
              <p className="text-muted-foreground">
                {event.followup_1h_enabled ? event.followup_1h_status : 'disabled'}
              </p>
            </div>
          </div>

          {(event.location || event.meeting_url) && <Separator />}

          {event.location && (
            <div className="flex items-start gap-2 text-sm">
              <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <span>{event.location}</span>
            </div>
          )}

          {event.meeting_url && (
            <a
              href={event.meeting_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              Abrir meeting link
            </a>
          )}
        </div>

        <DialogFooter className="justify-between gap-2">
          <div className="flex gap-2">
            <Button variant="outline" onClick={onEditEvent} disabled={submitting}>
              <Pencil className="h-4 w-4 mr-1" />
              Editar
            </Button>

            {showDoneAction && (
              <Button
                variant="outline"
                onClick={() => runAction(() => onMarkEventDone(event.id))}
                disabled={submitting}
              >
                <CheckCircle2 className="h-4 w-4 mr-1" />
                Marcar done
              </Button>
            )}

            {showCancelAction && (
              <Button
                variant="outline"
                onClick={() => runAction(() => onCancelEvent(event.id))}
                disabled={submitting}
              >
                <XCircle className="h-4 w-4 mr-1" />
                Cancelar
              </Button>
            )}
          </div>

          <Button
            variant="destructive"
            onClick={() => runAction(() => onDeleteEvent(event.id))}
            disabled={submitting}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Excluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

