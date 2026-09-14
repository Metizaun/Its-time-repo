-- An all-resources connection covers a professional even when the last location
-- is being removed or the professional never had a location.
CREATE OR REPLACE FUNCTION agenda_sync.connection_covers_professional(
  p_connection_id uuid,
  p_aces_id integer,
  p_professional_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM agenda_sync.connections c
    WHERE c.id = p_connection_id
      AND c.aces_id = p_aces_id
      AND (
        c.scope_mode = 'all_resources'
        OR EXISTS (
          SELECT 1
          FROM calendar.professional_locations pl
          WHERE pl.aces_id = p_aces_id
            AND pl.professional_id = p_professional_id
            AND agenda_sync.connection_covers_assignment(c.id, p_aces_id, pl.id)
        )
      )
  )
$$;
