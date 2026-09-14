-- Agenda Universal requires every availability exception to identify exactly one
-- company or professional location. Legacy rows with both fields null represented
-- an account-wide exception, so preserve that behavior by expanding the row to
-- every company in the account before the stricter constraint is installed.

DO $$
DECLARE
  v_exception calendar.availability_exceptions%ROWTYPE;
  v_empresa record;
  v_first_company boolean;
BEGIN
  FOR v_exception IN
    SELECT exception_row.*
    FROM calendar.availability_exceptions AS exception_row
    WHERE exception_row.empresa_id IS NULL
      AND exception_row.professional_location_id IS NULL
    ORDER BY exception_row.id
    FOR UPDATE
  LOOP
    v_first_company := true;

    FOR v_empresa IN
      SELECT empresa.id
      FROM crm.empresas AS empresa
      WHERE empresa.aces_id = v_exception.aces_id
      ORDER BY empresa.id
    LOOP
      IF v_first_company THEN
        UPDATE calendar.availability_exceptions
        SET empresa_id = v_empresa.id,
            updated_at = now()
        WHERE id = v_exception.id;

        v_first_company := false;
      ELSE
        INSERT INTO calendar.availability_exceptions (
          aces_id,
          empresa_id,
          professional_location_id,
          exception_type,
          starts_at,
          ends_at,
          reason,
          is_active,
          created_at,
          updated_at
        ) VALUES (
          v_exception.aces_id,
          v_empresa.id,
          NULL,
          v_exception.exception_type,
          v_exception.starts_at,
          v_exception.ends_at,
          v_exception.reason,
          v_exception.is_active,
          v_exception.created_at,
          now()
        );
      END IF;
    END LOOP;

    IF v_first_company THEN
      RAISE EXCEPTION
        'Agenda Universal backfill failed: account % has a global availability exception but no company',
        v_exception.aces_id;
    END IF;
  END LOOP;
END;
$$;
