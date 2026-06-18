-- Extend composer content types to support instagram
ALTER TABLE public.composer_templates
  DROP CONSTRAINT IF EXISTS composer_templates_content_type_check;
ALTER TABLE public.composer_templates
  ADD CONSTRAINT composer_templates_content_type_check
  CHECK (content_type IN ('instagram', 'linkedin', 'email', 'sms', 'custom'));

ALTER TABLE public.composer_sequences
  DROP CONSTRAINT IF EXISTS composer_sequences_content_type_check;
ALTER TABLE public.composer_sequences
  ADD CONSTRAINT composer_sequences_content_type_check
  CHECK (content_type IN ('instagram', 'linkedin', 'email', 'sms', 'custom'));
