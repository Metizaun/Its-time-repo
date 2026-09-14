BEGIN;

SELECT plan(29);

SELECT has_function(
  'agenda_sync', 'process_inbound_event',
  ARRAY['text','uuid','text','text','uuid','bigint','text','text','timestamp with time zone','jsonb'],
  'processamento inbound transacional existe'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'agenda_sync.process_inbound_event(text,uuid,text,text,uuid,bigint,text,text,timestamp with time zone,jsonb)',
    'EXECUTE'
  ),
  'frontend nao executa processamento inbound'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'agenda_sync.process_inbound_event(text,uuid,text,text,uuid,bigint,text,text,timestamp with time zone,jsonb)',
    'EXECUTE'
  ),
  'service role executa processamento inbound'
);
SELECT has_column('agenda_sync', 'inbound_events', 'response_body', 'recibo idempotente e persistido');
SELECT has_column('agenda_sync', 'inbound_events', 'reported_status', 'status informado e auditado');

INSERT INTO crm.accounts(id,name,status) VALUES(9974,'Agenda Inbound Test','active');
INSERT INTO crm.empresas(id,aces_id,cnpj,legal_name,name,address,city,state)
VALUES('99742000-0000-4000-8000-000000000001',9974,'66972304000129','Inbound LTDA','Inbound','Rua A','Curitiba','PR');
INSERT INTO crm.leads(id,aces_id,name,contact_phone,empresa_id)
VALUES('99743000-0000-4000-8000-000000000001',9974,'Paciente','+5541999999999','99742000-0000-4000-8000-000000000001');
INSERT INTO calendar.professionals(id,aces_id,name,specialty)
VALUES('99744000-0000-4000-8000-000000000001',9974,'Dra Inbound','Clinica');
INSERT INTO calendar.professional_locations(id,aces_id,professional_id,empresa_id)
VALUES('99745000-0000-4000-8000-000000000001',9974,'99744000-0000-4000-8000-000000000001','99742000-0000-4000-8000-000000000001');
INSERT INTO calendar.services(id,aces_id,name,duration_minutes,price_cents)
VALUES('99746000-0000-4000-8000-000000000001',9974,'Consulta',30,12345);
INSERT INTO calendar.professional_services(aces_id,professional_location_id,service_id)
VALUES(9974,'99745000-0000-4000-8000-000000000001','99746000-0000-4000-8000-000000000001');

INSERT INTO agenda_sync.connections(id,public_id,aces_id,name,outbound_url,scope_mode,status)
VALUES
 ('99747000-0000-4000-8000-000000000001',repeat('a',48),9974,'Partner Origin','https://a.example/events','selected_scope','active'),
 ('99747000-0000-4000-8000-000000000002',repeat('b',48),9974,'Partner Observer','https://b.example/events','all_resources','active'),
 ('99747000-0000-4000-8000-000000000003',repeat('c',48),9974,'Partner Outside','https://c.example/events','selected_scope','active');
INSERT INTO agenda_sync.connection_units(connection_id,aces_id,unit_id)
VALUES('99747000-0000-4000-8000-000000000001',9974,'99742000-0000-4000-8000-000000000001');

-- The booking engine correctly rejects creating appointments in the past. This
-- fixture disables only that validator and supplies its derived range; the
-- Agenda capture trigger remains enabled and is what this test exercises.
ALTER TABLE calendar.events DISABLE TRIGGER trg_calendar_events_consistency;
INSERT INTO calendar.events(
  id,aces_id,title,start_time,end_time,lead_id,empresa_id,professional_id,
  professional_location_id,service_id,duration_minutes_snapshot,price_cents_snapshot,
  occupied_range
)
VALUES
 ('99748000-0000-4000-8000-000000000001',9974,'Consulta concluivel',now()-interval '2 hours',now()-interval '90 minutes',
  '99743000-0000-4000-8000-000000000001','99742000-0000-4000-8000-000000000001','99744000-0000-4000-8000-000000000001',
  '99745000-0000-4000-8000-000000000001','99746000-0000-4000-8000-000000000001',30,12345,
  tstzrange(now()-interval '2 hours',now()-interval '90 minutes','[)')),
 ('99748000-0000-4000-8000-000000000002',9974,'Consulta para rejeicoes',now()-interval '1 hour',now()-interval '30 minutes',
  '99743000-0000-4000-8000-000000000001','99742000-0000-4000-8000-000000000001','99744000-0000-4000-8000-000000000001',
  '99745000-0000-4000-8000-000000000001','99746000-0000-4000-8000-000000000001',30,12345,
  tstzrange(now()-interval '1 hour',now()-interval '30 minutes','[)'));
ALTER TABLE calendar.events ENABLE TRIGGER trg_calendar_events_consistency;

DELETE FROM agenda_sync.outbox;

SELECT is(
  agenda_sync.process_inbound_event(
    repeat('a',48),'99749000-0000-4000-8000-000000000010','appointment.future_event',repeat('1',64)
  )->>'responseStatus',
  '200',
  'tipo futuro desconhecido recebe sucesso ignorado'
);
SELECT is(
  (SELECT outcome FROM agenda_sync.inbound_events WHERE event_id='99749000-0000-4000-8000-000000000010'),
  'ignored',
  'evento desconhecido fica auditado'
);
SELECT is(
  agenda_sync.process_inbound_event(
    repeat('a',48),'99749000-0000-4000-8000-000000000010','appointment.future_event',repeat('1',64)
  )->>'duplicate',
  'true',
  'repeticao devolve o recibo anterior'
);
SELECT is(
  agenda_sync.process_inbound_event(
    repeat('a',48),'99749000-0000-4000-8000-000000000010','appointment.future_event',repeat('2',64)
  )->>'code',
  'idempotency_conflict',
  'mesma chave com payload diferente conflita'
);

SELECT is(
  agenda_sync.process_inbound_event(
    repeat('c',48),'99749000-0000-4000-8000-000000000011','appointment.status_reported',repeat('3',64),
    '99748000-0000-4000-8000-000000000001',1,'done','ok',now(),'{}'
  )->>'responseStatus',
  '404',
  'agendamento fora do escopo nao e revelado'
);

SELECT is(
  agenda_sync.process_inbound_event(
    repeat('a',48),'99749000-0000-4000-8000-000000000001','appointment.status_reported',repeat('4',64),
    '99748000-0000-4000-8000-000000000001',1,'no_show','Paciente ausente',now(),'{"desk":"A"}'
  )->>'responseStatus',
  '202',
  'status valido e aceito'
);
SELECT is(
  (SELECT status FROM calendar.events WHERE id='99748000-0000-4000-8000-000000000001'),
  'no_show',
  'status do CRM e atualizado'
);
SELECT is(
  (SELECT version FROM agenda_sync.resource_versions WHERE resource_id='99748000-0000-4000-8000-000000000001'),
  2::bigint,
  'alteracao inbound incrementa resourceVersion uma vez'
);
SELECT is(
  (SELECT outcome FROM agenda_sync.inbound_events WHERE event_id='99749000-0000-4000-8000-000000000001'),
  'accepted',
  'evento aceito fica auditado'
);
SELECT is(
  (SELECT metadata#>>'{agendaLastStatusReport,reason}' FROM calendar.events WHERE id='99748000-0000-4000-8000-000000000001'),
  'Paciente ausente',
  'auditoria operacional e gravada no agendamento'
);
SELECT is(
  (SELECT count(*)::integer FROM agenda_sync.outbox WHERE connection_id='99747000-0000-4000-8000-000000000001'),
  0,
  'evento nao ecoa para a conexao de origem'
);
SELECT is(
  (SELECT count(*)::integer FROM agenda_sync.outbox WHERE connection_id='99747000-0000-4000-8000-000000000002' AND event_type='appointment.status_changed'),
  1,
  'outra conexao autorizada recebe a mudanca'
);
SELECT is(
  (SELECT envelope#>>'{resource,status}' FROM agenda_sync.outbox WHERE connection_id='99747000-0000-4000-8000-000000000002'),
  'no_show',
  'evento propagado contem o novo status'
);

SELECT is(
  agenda_sync.process_inbound_event(
    repeat('a',48),'99749000-0000-4000-8000-000000000001','appointment.status_reported',repeat('4',64),
    '99748000-0000-4000-8000-000000000001',1,'no_show','Paciente ausente',now(),'{"desk":"A"}'
  )->>'responseStatus',
  '202',
  'retry idempotente devolve o status original'
);
SELECT is(
  (SELECT count(*)::integer FROM agenda_sync.outbox WHERE connection_id='99747000-0000-4000-8000-000000000002'),
  1,
  'retry nao repete efeito nem evento outbound'
);
SELECT is(
  (SELECT version FROM agenda_sync.resource_versions WHERE resource_id='99748000-0000-4000-8000-000000000001'),
  2::bigint,
  'retry nao incrementa versao novamente'
);

SELECT is(
  agenda_sync.process_inbound_event(
    repeat('a',48),'99749000-0000-4000-8000-000000000002','appointment.status_reported',repeat('5',64),
    '99748000-0000-4000-8000-000000000001',1,'done','atrasado',now(),'{}'
  )->>'code',
  'stale_resource_version',
  'versao-base obsoleta recebe conflito'
);
SELECT is(
  (SELECT response_body->>'currentResourceVersion' FROM agenda_sync.inbound_events WHERE event_id='99749000-0000-4000-8000-000000000002'),
  '2',
  'conflito informa a versao atual'
);
SELECT is(
  agenda_sync.process_inbound_event(
    repeat('a',48),'99749000-0000-4000-8000-000000000003','appointment.status_reported',repeat('6',64),
    '99748000-0000-4000-8000-000000000001',2,'done','segunda conclusao',now(),'{}'
  )->>'code',
  'invalid_status_transition',
  'estado terminal nao transiciona novamente'
);

SELECT is(
  agenda_sync.process_inbound_event(
    repeat('a',48),'99749000-0000-4000-8000-000000000004','appointment.status_reported',repeat('7',64),
    '99748000-0000-4000-8000-000000000002',1,'done','futuro',now()+interval '6 minutes','{}'
  )->>'code',
  'reported_at_in_future',
  'reportedAt distante no futuro e rejeitado'
);
SELECT is(
  agenda_sync.process_inbound_event(
    repeat('a',48),'99749000-0000-4000-8000-000000000005','appointment.status_reported',repeat('8',64),
    '99748000-0000-4000-8000-000000000002',1,'done','cedo',now()-interval '2 hours','{}'
  )->>'code',
  'attendance_before_start',
  'resultado anterior ao inicio e rejeitado'
);
SELECT is(
  (SELECT status FROM calendar.events WHERE id='99748000-0000-4000-8000-000000000002'),
  'scheduled',
  'rejeicoes nao alteram o CRM'
);
SELECT is(
  (SELECT count(*)::integer FROM agenda_sync.inbound_events WHERE aces_id=9974),
  7,
  'todos os eventIds distintos ficam auditados uma unica vez'
);
SELECT is(
  agenda_sync.process_inbound_event(
    repeat('d',48),'99749000-0000-4000-8000-000000000006','appointment.future_event',repeat('9',64)
  )->>'responseStatus',
  '401',
  'identificador publico inexistente nao revela conexoes'
);

SELECT * FROM finish();
ROLLBACK;
