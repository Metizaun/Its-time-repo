import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { useToast } from '@/hooks/use-toast';
import { useOrganizationContext } from '@/hooks/useOrganizationContext';
import { useCalendarEvents, type CalendarEventUpdate, type CalendarEventInsert } from '@/hooks/useCalendarEvents';
import { useLeads } from '@/hooks/useLeads';
import { useContacts } from '@/hooks/useContacts';
import { useCompanies } from '@/hooks/useCompanies';
import { supabase } from '@/integrations/supabase/client';

import { CalendarBoard } from '@/components/calendar/CalendarBoard';
import { AddCalendarEventDialog } from '@/components/calendar/AddCalendarEventDialog';
import { EditCalendarEventDialog } from '@/components/calendar/EditCalendarEventDialog';
import { CalendarEventDetailDialog } from '@/components/calendar/CalendarEventDetailDialog';

interface SelectedRange {
  start: string;
  end: string;
  allDay: boolean;
}

interface DealOption {
  id: string;
  title: string;
}

export default function Calendar() {
  const { toast } = useToast();
  const { currentOrganization } = useOrganizationContext();

  const {
    events,
    loading,
    tableMissing,
    fetchEvents,
    createEvent,
    updateEvent,
    cancelEvent,
    deleteEvent,
    markEventDone,
  } = useCalendarEvents();

  const { leads } = useLeads();
  const { contacts } = useContacts();
  const { companies } = useCompanies();

  const [deals, setDeals] = useState<DealOption[]>([]);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<SelectedRange | null>(null);

  const lastRangeRef = useRef<string | null>(null);
  const schemaToastShownRef = useRef(false);

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  useEffect(() => {
    if (!tableMissing || schemaToastShownRef.current) {
      return;
    }

    schemaToastShownRef.current = true;
    toast({
      title: 'Calendar indisponível no banco',
      description: 'A tabela public.calendar_events ainda não existe neste projeto. Aplique a migration e recarregue.',
      variant: 'destructive',
    });
  }, [tableMissing, toast]);

  useEffect(() => {
    let active = true;

    const loadDeals = async () => {
      try {
        if (!currentOrganization?.id) {
          setDeals([]);
          return;
        }

        const { data, error } = await supabase
          .from('deals')
          .select('id, title')
          .eq('organization_id', currentOrganization.id)
          .order('created_at', { ascending: false });

        if (error) {
          throw error;
        }

        const result = data || [];
        if (active) {
          setDeals(result);
        }
      } catch (error) {
        console.error('Failed to fetch deals for calendar:', error);
        if (active) {
          setDeals([]);
        }
      }
    };

    loadDeals();

    return () => {
      active = false;
    };
  }, [currentOrganization?.id]);

  useEffect(() => {
    if (selectedEventId && !selectedEvent) {
      setSelectedEventId(null);
      setDetailDialogOpen(false);
      setEditDialogOpen(false);
    }
  }, [selectedEventId, selectedEvent]);

  const handleFetchRange = useCallback(async (start: string, end: string) => {
    if (tableMissing) {
      return;
    }

    const nextRangeKey = `${start}|${end}`;
    if (lastRangeRef.current === nextRangeKey) {
      return;
    }

    lastRangeRef.current = nextRangeKey;

    try {
      await fetchEvents(start, end);
    } catch (error) {
      console.error('Failed to fetch events:', error);
      const message = error instanceof Error ? error.message : 'Não foi possível buscar os eventos desse período.';
      toast({
        title: 'Erro ao carregar eventos',
        description: message,
        variant: 'destructive',
      });
    }
  }, [fetchEvents, tableMissing, toast]);

  const handleCreateFromSelection = useCallback((selection: SelectedRange) => {
    setSelectedRange(selection);
    setAddDialogOpen(true);
  }, []);

  const handleCreateEvent = useCallback(async (payload: CalendarEventInsert) => {
    await createEvent(payload);
    toast({
      title: 'Evento criado',
      description: 'O evento foi salvo no calendário.',
    });
  }, [createEvent, toast]);

  const handleMoveOrResizeEvent = useCallback(async (payload: {
    id: string;
    start_time: string;
    end_time: string;
    all_day: boolean;
  }) => {
    await updateEvent(payload.id, {
      start_time: payload.start_time,
      end_time: payload.end_time,
      all_day: payload.all_day,
    });
  }, [updateEvent]);

  const handleUpdateEvent = useCallback(async (id: string, updates: CalendarEventUpdate) => {
    await updateEvent(id, updates);
    toast({
      title: 'Evento atualizado',
      description: 'As alterações foram aplicadas.',
    });
  }, [toast, updateEvent]);

  const handleOpenEvent = useCallback((eventId: string) => {
    setSelectedEventId(eventId);
    setDetailDialogOpen(true);
  }, []);

  const handleEditFromDetail = useCallback(() => {
    setDetailDialogOpen(false);
    setEditDialogOpen(true);
  }, []);

  const handleCancelEvent = useCallback(async (eventId: string) => {
    try {
      const reasonInput = window.prompt('Motivo do cancelamento (opcional):');
      const reason = reasonInput?.trim() || undefined;

      await cancelEvent(eventId, reason);
      toast({
        title: 'Evento cancelado',
        description: 'O evento foi marcado como cancelado.',
      });
      setDetailDialogOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao cancelar evento';
      toast({
        title: 'Erro ao cancelar',
        description: message,
        variant: 'destructive',
      });
    }
  }, [cancelEvent, toast]);

  const handleDeleteEvent = useCallback(async (eventId: string) => {
    const confirmed = window.confirm('Deseja realmente excluir este evento?');
    if (!confirmed) return;

    try {
      await deleteEvent(eventId);
      toast({
        title: 'Evento excluído',
        description: 'O evento foi removido (soft delete).',
      });
      setDetailDialogOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao excluir evento';
      toast({
        title: 'Erro ao excluir',
        description: message,
        variant: 'destructive',
      });
    }
  }, [deleteEvent, toast]);

  const handleMarkDone = useCallback(async (eventId: string) => {
    try {
      await markEventDone(eventId);
      toast({
        title: 'Evento concluído',
        description: 'Status atualizado para done.',
      });
      setDetailDialogOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao concluir evento';
      toast({
        title: 'Erro ao concluir',
        description: message,
        variant: 'destructive',
      });
    }
  }, [markEventDone, toast]);

  const openAddDialog = useCallback(() => {
    setSelectedRange(null);
    setAddDialogOpen(true);
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {tableMissing ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-2 m-4">
          <div className="flex items-center gap-2 font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Tabela `public.calendar_events` não encontrada
          </div>
          <p className="text-sm text-muted-foreground">
            A migration do calendário ainda não foi aplicada no projeto Supabase atual.
          </p>
          <pre className="text-xs bg-background border rounded p-2 overflow-auto">
            {`supabase db push --project-ref hkqrgomafbohittsdnea`}
          </pre>
          <p className="text-xs text-muted-foreground">
            Depois do `db push`, recarregue a página.
          </p>
        </div>
      ) : (
        <CalendarBoard
          events={events}
          loading={loading}
          onRangeChange={handleFetchRange}
          onCreateFromSelection={handleCreateFromSelection}
          onSelectEvent={handleOpenEvent}
          onMoveOrResizeEvent={handleMoveOrResizeEvent}
          onNewEvent={openAddDialog}
          tableMissing={tableMissing}
        />
      )}

      <AddCalendarEventDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onCreateEvent={handleCreateEvent}
        defaultStart={selectedRange?.start}
        defaultEnd={selectedRange?.end}
        leads={leads}
        contacts={contacts}
        companies={companies}
        deals={deals}
      />

      <EditCalendarEventDialog
        event={selectedEvent}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onUpdateEvent={handleUpdateEvent}
        leads={leads}
        contacts={contacts}
        companies={companies}
        deals={deals}
      />

      <CalendarEventDetailDialog
        event={selectedEvent}
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        onEditEvent={handleEditFromDetail}
        onMarkEventDone={handleMarkDone}
        onCancelEvent={handleCancelEvent}
        onDeleteEvent={handleDeleteEvent}
      />
    </div>
  );
}
