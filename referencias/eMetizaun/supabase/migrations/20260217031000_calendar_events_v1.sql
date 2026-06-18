ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

CREATE TABLE IF NOT EXISTS public.calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  owner_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'crm' CHECK (source IN ('crm', 'n8n')),
  external_event_id TEXT NULL,
  title TEXT NOT NULL,
  description TEXT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  all_day BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'cancelled', 'done', 'no_show')),
  location TEXT NULL,
  meeting_url TEXT NULL,
  lead_id UUID NULL REFERENCES public.leads(id) ON DELETE SET NULL,
  contact_id UUID NULL REFERENCES public.contacts(id) ON DELETE SET NULL,
  company_id UUID NULL REFERENCES public.companies(id) ON DELETE SET NULL,
  deal_id UUID NULL REFERENCES public.deals(id) ON DELETE SET NULL,
  followup_1h_enabled BOOLEAN NOT NULL DEFAULT true,
  followup_1h_status TEXT NOT NULL DEFAULT 'pending' CHECK (followup_1h_status IN ('pending', 'processing', 'sent', 'failed')),
  followup_1h_last_attempt_at TIMESTAMPTZ NULL,
  followup_1h_sent_at TIMESTAMPTZ NULL,
  followup_1h_error TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT calendar_events_end_after_start CHECK (end_time > start_time),
  CONSTRAINT calendar_events_requires_lead_or_contact CHECK (lead_id IS NOT NULL OR contact_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_org_external_event_unique
ON public.calendar_events (organization_id, external_event_id)
WHERE external_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calendar_events_org_start_time
ON public.calendar_events (organization_id, start_time);

CREATE INDEX IF NOT EXISTS idx_calendar_events_org_status_start_time
ON public.calendar_events (organization_id, status, start_time);

CREATE INDEX IF NOT EXISTS idx_calendar_events_followup_pending
ON public.calendar_events (organization_id, start_time)
WHERE followup_1h_enabled = true
  AND followup_1h_sent_at IS NULL
  AND deleted_at IS NULL
  AND status IN ('scheduled', 'confirmed');

CREATE INDEX IF NOT EXISTS idx_calendar_events_lead_id
ON public.calendar_events (lead_id);

CREATE INDEX IF NOT EXISTS idx_calendar_events_contact_id
ON public.calendar_events (contact_id);

CREATE INDEX IF NOT EXISTS idx_calendar_events_deal_id
ON public.calendar_events (deal_id);

CREATE OR REPLACE FUNCTION public.validate_calendar_event_org_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  related_org_id UUID;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    SELECT l.organization_id INTO related_org_id
    FROM public.leads l
    WHERE l.id = NEW.lead_id;

    IF related_org_id IS NULL OR related_org_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'Lead % must belong to organization %', NEW.lead_id, NEW.organization_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.contact_id IS NOT NULL THEN
    SELECT c.organization_id INTO related_org_id
    FROM public.contacts c
    WHERE c.id = NEW.contact_id;

    IF related_org_id IS NULL OR related_org_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'Contact % must belong to organization %', NEW.contact_id, NEW.organization_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.company_id IS NOT NULL THEN
    SELECT c.organization_id INTO related_org_id
    FROM public.companies c
    WHERE c.id = NEW.company_id;

    IF related_org_id IS NULL OR related_org_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'Company % must belong to organization %', NEW.company_id, NEW.organization_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.deal_id IS NOT NULL THEN
    SELECT d.organization_id INTO related_org_id
    FROM public.deals d
    WHERE d.id = NEW.deal_id;

    IF related_org_id IS NULL OR related_org_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'Deal % must belong to organization %', NEW.deal_id, NEW.organization_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_calendar_event_org_consistency_trigger ON public.calendar_events;
CREATE TRIGGER validate_calendar_event_org_consistency_trigger
BEFORE INSERT OR UPDATE ON public.calendar_events
FOR EACH ROW
EXECUTE FUNCTION public.validate_calendar_event_org_consistency();

DROP TRIGGER IF EXISTS update_calendar_events_updated_at ON public.calendar_events;
CREATE TRIGGER update_calendar_events_updated_at
BEFORE UPDATE ON public.calendar_events
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view calendar events in their organizations" ON public.calendar_events;
CREATE POLICY "Users can view calendar events in their organizations"
ON public.calendar_events
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.organization_id = calendar_events.organization_id
  )
);

DROP POLICY IF EXISTS "Members and above can create calendar events" ON public.calendar_events;
CREATE POLICY "Members and above can create calendar events"
ON public.calendar_events
FOR INSERT
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role));

DROP POLICY IF EXISTS "Members and above can update calendar events" ON public.calendar_events;
CREATE POLICY "Members and above can update calendar events"
ON public.calendar_events
FOR UPDATE
USING (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role))
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role));

DROP POLICY IF EXISTS "Admins and owners can hard delete calendar events" ON public.calendar_events;
CREATE POLICY "Admins and owners can hard delete calendar events"
ON public.calendar_events
FOR DELETE
USING (public.has_minimum_role(auth.uid(), organization_id, 'admin'::public.user_role));

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.calendar_events;
  EXCEPTION
    WHEN others THEN NULL;
  END;
END $$;

