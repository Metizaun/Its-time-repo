-- A soft delete is an UPDATE, and PostgreSQL also applies the SELECT policy
-- to the row produced by that UPDATE. Keep deleted events available only to
-- the same account member who is allowed to mutate them so the update can
-- complete without exposing them across tenants or owners.

DROP POLICY IF EXISTS calendar_events_select ON calendar.events;

CREATE POLICY calendar_events_select
ON calendar.events
FOR SELECT
TO authenticated
USING (
  aces_id = (SELECT public.current_aces_id())
  AND (
    (
      deleted_at IS NULL
      AND (
        (SELECT crm.current_user_is_account_admin())
        OR owner_user_id = (SELECT public.current_crm_user_id())
        OR (lead_id IS NOT NULL AND crm.current_user_can_access_lead(lead_id))
      )
    )
    OR (
      deleted_at IS NOT NULL
      AND (
        (SELECT crm.current_user_is_account_admin())
        OR owner_user_id = (SELECT public.current_crm_user_id())
      )
      AND (lead_id IS NULL OR crm.current_user_can_edit_lead(lead_id))
    )
  )
);

COMMENT ON POLICY calendar_events_select ON calendar.events IS
  'Shows active events in the normal agenda scope and deleted events only to authorized editors so RLS permits soft delete updates.';
