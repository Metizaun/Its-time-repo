BEGIN;

SELECT plan(29);

SELECT has_function('agenda_sync', 'claim_delivery', ARRAY['text','integer','integer'], 'claim atomico existe');
SELECT has_function('agenda_sync', 'renew_delivery_lease', ARRAY['uuid','text','integer'], 'lease renovavel existe');
SELECT has_function('agenda_sync', 'finish_delivery', ARRAY['uuid','text','timestamp with time zone','integer','integer','text'], 'conclusao atomica existe');
SELECT has_function('agenda_sync', 'fail_delivery', ARRAY['uuid','text','timestamp with time zone','integer','integer','text','text','boolean','timestamp with time zone'], 'falha atomica existe');
SELECT ok(NOT has_function_privilege('authenticated', 'agenda_sync.claim_delivery(text,integer,integer)', 'EXECUTE'), 'frontend nao opera worker');
SELECT ok(has_function_privilege('service_role', 'agenda_sync.claim_delivery(text,integer,integer)', 'EXECUTE'), 'service role opera worker');
SELECT is_definer('agenda_sync','capture_appointment_change',ARRAY[]::text[],'trigger captura com privilegio interno');
SELECT ok(NOT has_function_privilege('authenticated','agenda_sync.capture_appointment_change()','EXECUTE'),'trigger interno nao e chamavel pelo frontend');

INSERT INTO crm.accounts(id,name,status) VALUES(9973,'Agenda Delivery Test','active');
INSERT INTO crm.empresas(id,aces_id,cnpj,legal_name,name,address,city,state)
VALUES('99732000-0000-4000-8000-000000000001',9973,'66972304000129','Unidade LTDA','Unidade','Rua A','Curitiba','PR');
INSERT INTO crm.leads(id,aces_id,name,contact_phone,empresa_id)
VALUES('99733000-0000-4000-8000-000000000001',9973,'Paciente','+5541999999999','99732000-0000-4000-8000-000000000001');
INSERT INTO calendar.professionals(id,aces_id,name,specialty)
VALUES('99734000-0000-4000-8000-000000000001',9973,'Dra Teste','Clinica');
INSERT INTO calendar.professional_locations(id,aces_id,professional_id,empresa_id)
VALUES('99735000-0000-4000-8000-000000000001',9973,'99734000-0000-4000-8000-000000000001','99732000-0000-4000-8000-000000000001');
INSERT INTO calendar.services(id,aces_id,name,duration_minutes,price_cents)
VALUES('99736000-0000-4000-8000-000000000001',9973,'Consulta',30,12345);
INSERT INTO calendar.professional_services(aces_id,professional_location_id,service_id)
VALUES(9973,'99735000-0000-4000-8000-000000000001','99736000-0000-4000-8000-000000000001');
INSERT INTO calendar.availability_rules(aces_id,professional_location_id,weekday,start_time,end_time)
SELECT 9973,'99735000-0000-4000-8000-000000000001',day,'00:00'::time,'23:59'::time
FROM generate_series(0,6) AS day;
INSERT INTO agenda_sync.connections(id,aces_id,name,outbound_url,scope_mode,status)
VALUES
 ('99737000-0000-4000-8000-000000000001',9973,'Partner A','https://a.example/events','selected_scope','active'),
 ('99737000-0000-4000-8000-000000000002',9973,'Partner B','https://b.example/events','all_resources','active');
INSERT INTO agenda_sync.connection_units(connection_id,aces_id,unit_id)
VALUES('99737000-0000-4000-8000-000000000001',9973,'99732000-0000-4000-8000-000000000001');

INSERT INTO calendar.events(id,aces_id,title,start_time,end_time,lead_id)
VALUES('99738000-0000-4000-8000-000000000099',9973,'Generico',now()+interval '1 day',now()+interval '1 day 1 hour','99733000-0000-4000-8000-000000000001');
SELECT is((SELECT count(*)::integer FROM agenda_sync.outbox),0,'evento generico nao e exportado');

INSERT INTO calendar.events(id,aces_id,title,start_time,end_time,lead_id,empresa_id,
 professional_id,professional_location_id,service_id,duration_minutes_snapshot,price_cents_snapshot)
VALUES('99738000-0000-4000-8000-000000000001',9973,'Consulta',
 ((current_date+2)::date::text||' 12:00')::timestamp AT TIME ZONE 'America/Sao_Paulo',
 ((current_date+2)::date::text||' 12:30')::timestamp AT TIME ZONE 'America/Sao_Paulo',
 '99733000-0000-4000-8000-000000000001','99732000-0000-4000-8000-000000000001',
 '99734000-0000-4000-8000-000000000001','99735000-0000-4000-8000-000000000001',
 '99736000-0000-4000-8000-000000000001',30,12345);

SELECT is((SELECT count(*)::integer FROM agenda_sync.outbox),4,'duas conexoes recebem paciente e agendamento');
SELECT results_eq(
  $$SELECT event_type FROM agenda_sync.outbox WHERE connection_id='99737000-0000-4000-8000-000000000001' ORDER BY sequence$$,
  $$SELECT * FROM (VALUES('patient.upserted'::text),('appointment.created'::text)) AS expected(event_type)$$,
  'paciente precede agendamento'
);
SELECT is((SELECT version FROM agenda_sync.resource_versions WHERE aces_id=9973 AND resource_type='appointment'),1::bigint,'versao inicial atomica');
SELECT is((SELECT envelope#>>'{resource,service,price}' FROM agenda_sync.outbox WHERE event_type='appointment.created' LIMIT 1),'123.45','payload usa preco congelado');

UPDATE calendar.events SET start_time=start_time+interval '1 hour',end_time=end_time+interval '1 hour'
WHERE id='99738000-0000-4000-8000-000000000001';
SELECT is((SELECT version FROM agenda_sync.resource_versions WHERE aces_id=9973 AND resource_type='appointment'),2::bigint,'reagendamento incrementa versao');
SELECT is((SELECT count(*)::integer FROM agenda_sync.outbox WHERE event_type='appointment.rescheduled'),2,'reagendamento chega a ambas conexoes');

SELECT set_config('agenda_sync.origin_connection_id','99737000-0000-4000-8000-000000000001',true);
UPDATE calendar.events SET status='done' WHERE id='99738000-0000-4000-8000-000000000001';
SELECT is((SELECT count(*)::integer FROM agenda_sync.outbox WHERE event_type='appointment.status_changed' AND connection_id='99737000-0000-4000-8000-000000000001'),0,'eco nao retorna a origem');
SELECT is((SELECT count(*)::integer FROM agenda_sync.outbox WHERE event_type='appointment.status_changed' AND connection_id='99737000-0000-4000-8000-000000000002'),1,'mudanca ainda chega a outra conexao');
SELECT set_config('agenda_sync.origin_connection_id','',true);

UPDATE calendar.events SET deleted_at=now() WHERE id='99738000-0000-4000-8000-000000000001';
SELECT is((SELECT count(*)::integer FROM agenda_sync.outbox WHERE event_type='appointment.cancelled'),2,'soft delete gera cancelamento nas conexoes');
SELECT is((SELECT version FROM agenda_sync.resource_versions WHERE aces_id=9973 AND resource_type='appointment'),4::bigint,'soft delete tambem incrementa versao');

CREATE TEMP TABLE claimed AS SELECT * FROM agenda_sync.claim_delivery('worker-a',60,20);
SELECT is((SELECT count(*)::integer FROM claimed),2,'claim paraleliza uma cabeca por conexao');
SELECT is((SELECT count(*)::integer FROM agenda_sync.claim_delivery('worker-b',60,20)),0,'lease impede segundo worker na mesma cabeca');
SELECT ok((SELECT bool_and(attempt_count=1) FROM claimed),'claim incrementa tentativa uma vez');
SELECT ok(agenda_sync.renew_delivery_lease((SELECT id FROM claimed LIMIT 1),'worker-a',60),'dono renova lease');
SELECT ok(NOT COALESCE(agenda_sync.renew_delivery_lease((SELECT id FROM claimed LIMIT 1),'worker-b',60),false),'outro worker nao renova lease');

SELECT ok(agenda_sync.finish_delivery((SELECT id FROM claimed ORDER BY connection_id LIMIT 1),'worker-a',now(),5,204,'No Content'),'sucesso conclui entrega');
SELECT is((SELECT count(*)::integer FROM agenda_sync.deliveries WHERE outcome='delivered'),1,'tentativa sanitizada e registrada');
SELECT is((SELECT count(*)::integer FROM agenda_sync.claim_delivery('worker-c',60,20)),1,'fila avanca apenas na conexao concluida');

UPDATE agenda_sync.outbox SET locked_until=now()-interval '1 second' WHERE status='delivering';
CREATE TEMP TABLE recovered AS SELECT * FROM agenda_sync.claim_delivery('worker-recovery',60,20);
SELECT ok((SELECT count(*) FROM recovered) >= 1,'lease abandonado e recuperado');
SELECT ok(EXISTS(SELECT 1 FROM recovered r JOIN claimed c ON c.id=r.id AND c.event_id=r.event_id AND c.payload_hash=r.payload_hash),'retry preserva eventId e payload para idempotencia');

SELECT * FROM finish();
ROLLBACK;
