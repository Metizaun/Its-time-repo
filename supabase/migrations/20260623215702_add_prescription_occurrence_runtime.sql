ALTER TABLE crm.receituarios
  ADD COLUMN IF NOT EXISTS occurrence_key text,
  ADD COLUMN IF NOT EXISTS matched_lens_price_rule_id uuid REFERENCES crm.lens_price_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quoted_price_cents bigint,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'BRL',
  ADD COLUMN IF NOT EXISTS extraction_confidence numeric(5,4);

DROP INDEX IF EXISTS crm.idx_receituarios_source_attachment_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_receituarios_occurrence_unique
  ON crm.receituarios(aces_id, occurrence_key)
  WHERE occurrence_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receituarios_source_attachment
  ON crm.receituarios(source_attachment_id)
  WHERE source_attachment_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receituarios_price_check') THEN
    ALTER TABLE crm.receituarios ADD CONSTRAINT receituarios_price_check
      CHECK (quoted_price_cents IS NULL OR quoted_price_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receituarios_currency_check') THEN
    ALTER TABLE crm.receituarios ADD CONSTRAINT receituarios_currency_check
      CHECK (currency = 'BRL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receituarios_confidence_check') THEN
    ALTER TABLE crm.receituarios ADD CONSTRAINT receituarios_confidence_check
      CHECK (extraction_confidence IS NULL OR extraction_confidence BETWEEN 0 AND 1);
  END IF;
END $$;
