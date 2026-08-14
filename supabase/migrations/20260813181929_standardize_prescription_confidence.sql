ALTER TABLE crm.receituarios
  DROP CONSTRAINT IF EXISTS receituarios_confidence_check;

UPDATE crm.receituarios
SET extraction_confidence = CASE
  WHEN extraction_confidence IS NULL THEN NULL
  WHEN extraction_confidence <= 0 THEN 0
  WHEN extraction_confidence < 0.5 THEN 0
  WHEN extraction_confidence < 0.8 THEN 1
  ELSE 2
END
WHERE extraction_confidence IS NOT NULL;

ALTER TABLE crm.receituarios
  ADD CONSTRAINT receituarios_confidence_check
  CHECK (extraction_confidence IS NULL OR extraction_confidence IN (0, 1, 2));
