-- Agenda da Dr. Oculos Centro: horario de referencia e fila por ordem de chegada.
-- Seed especifico de producao; uma base vazia nao possui a conta/empresa.
DO $seed$
BEGIN
  IF EXISTS (SELECT 1 FROM crm.accounts WHERE id = 5)
     AND EXISTS (
       SELECT 1
       FROM crm.empresas
       WHERE id = 'd41e2ba2-97e4-438d-a136-01c3a548a391'
         AND aces_id = 5
     ) THEN

INSERT INTO calendar.professionals (id, aces_id, name, specialty, is_active)
VALUES (
  '50000000-0000-0000-0000-000000000601',
  5,
  'Atendimento Centro',
  'Ordem de chegada',
  true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  specialty = EXCLUDED.specialty,
  is_active = true,
  updated_at = now();

INSERT INTO calendar.professional_locations (
  id, aces_id, professional_id, empresa_id, location_name, is_active, is_ai_visible
)
VALUES (
  '50000000-0000-0000-0000-000000000611',
  5,
  '50000000-0000-0000-0000-000000000601',
  'd41e2ba2-97e4-438d-a136-01c3a548a391',
  'Dr. Oculos - Centro',
  true,
  true
)
ON CONFLICT (id) DO UPDATE SET
  empresa_id = EXCLUDED.empresa_id,
  location_name = EXCLUDED.location_name,
  is_active = true,
  is_ai_visible = true,
  updated_at = now();

INSERT INTO calendar.services (
  id, aces_id, name, description, duration_minutes, price_cents,
  buffer_before_minutes, buffer_after_minutes, is_active, is_ai_visible
)
VALUES (
  '50000000-0000-0000-0000-000000000631',
  5,
  'Agendamento no Centro',
  'Agendamento simbolico; o atendimento presencial ocorre por ordem de chegada.',
  60,
  NULL,
  0,
  0,
  true,
  true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  duration_minutes = EXCLUDED.duration_minutes,
  price_cents = NULL,
  is_active = true,
  is_ai_visible = true,
  updated_at = now();

INSERT INTO calendar.professional_services (
  aces_id, professional_location_id, service_id, duration_minutes_override,
  price_cents_override, buffer_before_minutes_override, buffer_after_minutes_override,
  is_active, is_ai_visible
)
VALUES (
  5,
  '50000000-0000-0000-0000-000000000611',
  '50000000-0000-0000-0000-000000000631',
  60,
  NULL,
  0,
  0,
  true,
  true
)
ON CONFLICT (professional_location_id, service_id) DO UPDATE SET
  duration_minutes_override = 60,
  price_cents_override = NULL,
  buffer_before_minutes_override = 0,
  buffer_after_minutes_override = 0,
  is_active = true,
  is_ai_visible = true,
  updated_at = now();

DELETE FROM calendar.availability_rules
WHERE aces_id = 5
  AND professional_location_id = '50000000-0000-0000-0000-000000000611';

INSERT INTO calendar.availability_rules (
  aces_id, professional_location_id, weekday, start_time, end_time, is_active
)
VALUES
  (5, '50000000-0000-0000-0000-000000000611', 1, '08:00', '16:00', true),
  (5, '50000000-0000-0000-0000-000000000611', 2, '08:00', '16:00', true),
  (5, '50000000-0000-0000-0000-000000000611', 3, '08:00', '16:00', true),
  (5, '50000000-0000-0000-0000-000000000611', 4, '08:00', '16:00', true),
  (5, '50000000-0000-0000-0000-000000000611', 5, '08:00', '16:00', true),
  (5, '50000000-0000-0000-0000-000000000611', 6, '08:00', '12:00', true);

UPDATE agents.ai_agents
SET system_prompt = CASE
  WHEN position('REGRAS DA AGENDA DO CENTRO' IN system_prompt) > 0 THEN system_prompt
  ELSE system_prompt || E'\n\nREGRAS DA AGENDA DO CENTRO\nOs horarios do Centro sao referencias simbolicas para registrar o agendamento. Eles nao representam limite de vagas: mais de uma pessoa pode agendar no mesmo horario. Informe que o atendimento presencial e por ordem de chegada. Nunca diga que um horario esta lotado apenas porque ja existe outro agendamento no mesmo horario.'
END,
    updated_at = now()
WHERE aces_id = 5
  AND instance_name = 'cobranca';

  END IF;
END;
$seed$;

NOTIFY pgrST, 'reload schema';
