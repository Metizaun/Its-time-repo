import { useCallback, useEffect, useRef, useState } from 'react';
import type { PostgrestError } from '@supabase/supabase-js';

import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOrganizationContext } from '@/hooks/useOrganizationContext';

export type CalendarEventStatus = 'scheduled' | 'confirmed' | 'cancelled' | 'done' | 'no_show';
export type CalendarEventSource = 'crm' | 'n8n';
export type CalendarFollowupStatus = 'pending' | 'processing' | 'sent' | 'failed';

export interface CalendarEvent {
  id: string;
  organization_id: string;
  owner_user_id: string | null;
  created_by_user_id: string | null;
  source: CalendarEventSource;
  external_event_id: string | null;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  all_day: boolean;
  status: CalendarEventStatus;
  location: string | null;
  meeting_url: string | null;
  lead_id: string | null;
  contact_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  followup_1h_enabled: boolean;
  followup_1h_status: CalendarFollowupStatus;
  followup_1h_last_attempt_at: string | null;
  followup_1h_sent_at: string | null;
  followup_1h_error: string | null;
  metadata: Record<string, unknown>;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarEventInsert {
  title: string;
  description?: string | null;
  start_time: string;
  end_time: string;
  all_day?: boolean;
  status?: CalendarEventStatus;
  location?: string | null;
  meeting_url?: string | null;
  lead_id?: string | null;
  contact_id?: string | null;
  company_id?: string | null;
  deal_id?: string | null;
  owner_user_id?: string | null;
  source?: CalendarEventSource;
  external_event_id?: string | null;
  followup_1h_enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CalendarEventUpdate extends Partial<CalendarEventInsert> {
  followup_1h_status?: CalendarFollowupStatus;
  followup_1h_last_attempt_at?: string | null;
  followup_1h_sent_at?: string | null;
  followup_1h_error?: string | null;
  deleted_at?: string | null;
}

const sortByStartTime = (events: CalendarEvent[]) => {
  return [...events].sort((a, b) => {
    const aStart = new Date(a.start_time).getTime();
    const bStart = new Date(b.start_time).getTime();
    return aStart - bStart;
  });
};

const CALENDAR_TABLE_MISSING_MESSAGE =
  'A tabela public.calendar_events ainda não existe no projeto Supabase. Execute as migrations e recarregue a página.';

const isCalendarTableMissingError = (error: unknown): error is PostgrestError => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as Partial<PostgrestError>;

  return (
    maybeError.code === 'PGRST205' &&
    typeof maybeError.message === 'string' &&
    maybeError.message.includes("public.calendar_events")
  );
};

export function useCalendarEvents() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);

  const { user } = useAuth();
  const { currentOrganization } = useOrganizationContext();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchEvents = useCallback(async (rangeStart?: string, rangeEnd?: string): Promise<CalendarEvent[]> => {
    if (!currentOrganization?.id) {
      setEvents([]);
      setTableMissing(false);
      return [];
    }

    if (tableMissing) {
      return [];
    }

    setLoading(true);

    try {
      let query = supabase
        .from('calendar_events')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .is('deleted_at', null)
        .order('start_time', { ascending: true });

      if (rangeStart && rangeEnd) {
        query = query
          .lt('start_time', rangeEnd)
          .gt('end_time', rangeStart);
      } else if (rangeStart) {
        query = query.gte('start_time', rangeStart);
      } else if (rangeEnd) {
        query = query.lt('start_time', rangeEnd);
      }

      const { data, error } = await query;

      if (error) {
        if (isCalendarTableMissingError(error)) {
          setTableMissing(true);
          setEvents([]);
          throw new Error(CALENDAR_TABLE_MISSING_MESSAGE);
        }

        throw error;
      }

      if (tableMissing) {
        setTableMissing(false);
      }

      const nextEvents = (data || []) as CalendarEvent[];
      setEvents(nextEvents);
      return nextEvents;
    } finally {
      setLoading(false);
    }
  }, [currentOrganization?.id, tableMissing]);

  const createEvent = useCallback(async (payload: CalendarEventInsert): Promise<CalendarEvent> => {
    if (!user?.id || !currentOrganization?.id) {
      throw new Error('User not authenticated or no organization selected');
    }

    if (tableMissing) {
      throw new Error(CALENDAR_TABLE_MISSING_MESSAGE);
    }

    if (!payload.lead_id && !payload.contact_id) {
      throw new Error('Event must be linked to a lead or contact');
    }

    const insertPayload = {
      ...payload,
      organization_id: currentOrganization.id,
      owner_user_id: payload.owner_user_id ?? user.id,
      created_by_user_id: user.id,
      metadata: payload.metadata ?? {},
    };

    const { data, error } = await supabase
      .from('calendar_events')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error) {
      if (isCalendarTableMissingError(error)) {
        setTableMissing(true);
        throw new Error(CALENDAR_TABLE_MISSING_MESSAGE);
      }

      throw error;
    }

    const createdEvent = data as CalendarEvent;
    setEvents(prev => sortByStartTime([createdEvent, ...prev]));
    return createdEvent;
  }, [currentOrganization?.id, tableMissing, user?.id]);

  const updateEvent = useCallback(async (id: string, updates: CalendarEventUpdate): Promise<CalendarEvent> => {
    if (!currentOrganization?.id) {
      throw new Error('No organization selected');
    }

    if (tableMissing) {
      throw new Error(CALENDAR_TABLE_MISSING_MESSAGE);
    }

    const shouldResetFollowup = Object.prototype.hasOwnProperty.call(updates, 'start_time') ||
      Object.prototype.hasOwnProperty.call(updates, 'end_time');

    const payload: CalendarEventUpdate = shouldResetFollowup
      ? {
          ...updates,
          followup_1h_status: 'pending',
          followup_1h_sent_at: null,
          followup_1h_error: null,
        }
      : updates;

    if (
      (Object.prototype.hasOwnProperty.call(payload, 'lead_id') && payload.lead_id == null) &&
      (Object.prototype.hasOwnProperty.call(payload, 'contact_id') && payload.contact_id == null)
    ) {
      throw new Error('Event must be linked to a lead or contact');
    }

    const { data, error } = await supabase
      .from('calendar_events')
      .update(payload)
      .eq('id', id)
      .eq('organization_id', currentOrganization.id)
      .is('deleted_at', null)
      .select('*')
      .single();

    if (error) {
      if (isCalendarTableMissingError(error)) {
        setTableMissing(true);
        throw new Error(CALENDAR_TABLE_MISSING_MESSAGE);
      }

      throw error;
    }

    const updatedEvent = data as CalendarEvent;
    setEvents(prev => sortByStartTime(prev.map(event => (event.id === id ? updatedEvent : event))));
    return updatedEvent;
  }, [currentOrganization?.id, tableMissing]);

  const cancelEvent = useCallback(async (id: string, reason?: string): Promise<CalendarEvent> => {
    const metadata = reason ? { cancellation_reason: reason } : undefined;

    return updateEvent(id, {
      status: 'cancelled',
      followup_1h_enabled: false,
      followup_1h_status: 'pending',
      followup_1h_sent_at: null,
      followup_1h_error: reason ?? null,
      metadata,
    });
  }, [updateEvent]);

  const deleteEvent = useCallback(async (id: string): Promise<void> => {
    if (!currentOrganization?.id) {
      throw new Error('No organization selected');
    }

    if (tableMissing) {
      throw new Error(CALENDAR_TABLE_MISSING_MESSAGE);
    }

    const { error } = await supabase
      .from('calendar_events')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('organization_id', currentOrganization.id)
      .is('deleted_at', null);

    if (error) {
      if (isCalendarTableMissingError(error)) {
        setTableMissing(true);
        throw new Error(CALENDAR_TABLE_MISSING_MESSAGE);
      }

      throw error;
    }

    setEvents(prev => prev.filter(event => event.id !== id));
  }, [currentOrganization?.id, tableMissing]);

  const markEventDone = useCallback(async (id: string): Promise<CalendarEvent> => {
    return updateEvent(id, {
      status: 'done',
      followup_1h_enabled: false,
    });
  }, [updateEvent]);

  const subscribeRealtime = useCallback(() => {
    if (!currentOrganization?.id || tableMissing) {
      return () => undefined;
    }

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`calendar-events-${currentOrganization.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'calendar_events',
          filter: `organization_id=eq.${currentOrganization.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const inserted = payload.new as CalendarEvent;
            if (inserted.deleted_at) {
              return;
            }

            setEvents(prev => sortByStartTime([inserted, ...prev.filter(event => event.id !== inserted.id)]));
            return;
          }

          if (payload.eventType === 'UPDATE') {
            const updated = payload.new as CalendarEvent;
            if (updated.deleted_at) {
              setEvents(prev => prev.filter(event => event.id !== updated.id));
              return;
            }

            setEvents(prev => sortByStartTime(prev.map(event => (event.id === updated.id ? updated : event))));
            return;
          }

          if (payload.eventType === 'DELETE') {
            const deleted = payload.old as CalendarEvent;
            setEvents(prev => prev.filter(event => event.id !== deleted.id));
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [currentOrganization?.id, tableMissing]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    const unsubscribe = subscribeRealtime();

    return () => {
      unsubscribe();
    };
  }, [subscribeRealtime]);

  return {
    events,
    loading,
    tableMissing,
    fetchEvents,
    createEvent,
    updateEvent,
    cancelEvent,
    deleteEvent,
    markEventDone,
    subscribeRealtime,
  };
}
