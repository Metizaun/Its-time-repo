BEGIN;

DO $$
DECLARE
  r record;
  new_def text;
BEGIN
  FOR r IN
    SELECT
      c.oid,
      n.nspname AS table_schema,
      rel.relname AS table_name,
      c.conname AS constraint_name,
      pg_get_constraintdef(c.oid) AS constraint_def
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE c.contype = 'f'
      AND c.confrelid = 'crm."instance"'::regclass
      AND c.confkey = ARRAY[
        (
          SELECT a.attnum
          FROM pg_attribute a
          WHERE a.attrelid = 'crm."instance"'::regclass
            AND a.attname = 'instancia'
        )
      ]::smallint[]
  LOOP
    new_def := r.constraint_def;

    IF new_def ~* 'ON UPDATE' THEN
      new_def := regexp_replace(
        new_def,
        'ON UPDATE (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)',
        'ON UPDATE CASCADE',
        'i'
      );
    ELSE
      IF new_def ~* '\sON DELETE' THEN
        new_def := regexp_replace(
          new_def,
          '\sON DELETE',
          ' ON UPDATE CASCADE ON DELETE',
          'i'
        );
      ELSE
        new_def := new_def || ' ON UPDATE CASCADE';
      END IF;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT %I',
      r.table_schema,
      r.table_name,
      r.constraint_name
    );

    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I %s',
      r.table_schema,
      r.table_name,
      r.constraint_name,
      new_def
    );
  END LOOP;
END $$;

UPDATE crm."instance"
SET instancia = 'cobranca'
WHERE instancia = 'mamis';

COMMIT;