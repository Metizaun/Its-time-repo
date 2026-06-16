export type CalendarViewMode = "month" | "week" | "day";

export type CalendarEventStatus = "scheduled" | "confirmed" | "cancelled" | "done" | "no_show";

export type CalendarEventSource = "crm" | "n8n" | "import" | "external";

export type CalendarFollowupStatus =
  | "disabled"
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "skipped";

export interface CalendarEvent {
  id: string;
  aces_id: number;
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
  cancel_reason: string | null;
  location: string | null;
  meeting_url: string | null;
  lead_id: string;
  opportunity_id: string | null;
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

export interface CalendarEventInput {
  title: string;
  description?: string | null;
  start_time: string;
  end_time: string;
  all_day?: boolean;
  status?: CalendarEventStatus;
  cancel_reason?: string | null;
  location?: string | null;
  meeting_url?: string | null;
  lead_id: string;
  opportunity_id?: string | null;
  followup_1h_enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CalendarEventRange {
  start: Date;
  end: Date;
}

export interface CalendarOpportunity {
  id: string;
  lead_id: string;
  status: string | null;
  value: number | null;
  connection_level: string | null;
  created_at: string | null;
}
