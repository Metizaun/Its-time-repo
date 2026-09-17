BEGIN;

SELECT plan(44);

SELECT has_table('agenda_sync','resync_runs','execucoes de ressincronizacao sao duraveis');
SELECT has_table('agenda_sync','resync_deltas','deltas concorrentes possuem buffer');
SELECT has_table('agenda_sync','inbound_rate_limits','rate limit inbound e persistente');
SELECT has_column('agenda_sync','outbox','resync_run_id','outbox identifica a execucao');
SELECT has_column('agenda_sync','outbox','resync_phase','outbox identifica snapshot ou delta');
SELECT col_is_null('agenda_sync','deliveries','outbox_id','historico sobrevive a limpeza da outbox');
SELECT has_column('crm','notifications','admin_only','alerta operacional pode ser restrito');

SELECT has_function('agenda_sync','start_resync',ARRAY['integer','uuid','uuid','text'],'inicio transacional existe');
SELECT has_function('agenda_sync','claim_resync_batch',ARRAY['text','integer','integer'],'claim recuperavel existe');
SELECT has_function('agenda_sync','finalize_resyncs',ARRAY[]::text[],'ativacao final e verificada');
SELECT has_function('agenda_sync','resolve_dead_letter',ARRAY['integer','uuid','uuid','uuid','text','text'],'resolucao auditada existe');
SELECT has_function('agenda_sync','correct_appointment_status',ARRAY['integer','uuid','uuid','uuid','text','text'],'correcao terminal existe');
SELECT has_function('agenda_sync','consume_inbound_rate_limit',ARRAY['integer','uuid','text','integer'],'limitador por conexao e IP existe');
SELECT has_function('agenda_sync','cleanup_history',ARRAY['integer'],'limpeza em lotes existe');

SELECT ok(NOT has_table_privilege('anon','agenda_sync.resync_runs','SELECT'),'anon nao le ressincronizacoes');
SELECT ok(NOT has_table_privilege('authenticated','agenda_sync.resync_deltas','SELECT'),'frontend nao le buffer privado');
SELECT ok(has_table_privilege('service_role','agenda_sync.resync_runs','SELECT'),'backend le ressincronizacoes');
SELECT ok(NOT has_function_privilege('authenticated','agenda_sync.start_resync(integer,uuid,uuid,text)','EXECUTE'),'frontend nao ignora autorizacao do backend');
SELECT ok(has_function_privilege('service_role','agenda_sync.start_resync(integer,uuid,uuid,text)','EXECUTE'),'backend inicia ressincronizacao');
SELECT ok(NOT has_function_privilege('authenticated','agenda_sync.consume_inbound_rate_limit(integer,uuid,text,integer)','EXECUTE'),'limitador nao e API publica');

SELECT is((SELECT confdeltype::text FROM pg_constraint WHERE conname='agenda_deliveries_outbox_fk'),'n','exclusao da outbox preserva entrega com SET NULL');
SELECT ok(EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='agenda_sync' AND indexname='agenda_resync_runs_one_active_idx'
  AND indexdef LIKE '%WHERE (status = ANY%'),'indice impede duas execucoes ativas');
SELECT trigger_is('crm','empresas','trg_agenda_sync_capture_unit','agenda_sync','capture_unit_change','unidades geram deltas');
SELECT trigger_is('crm','empresas','trg_agenda_sync_capture_unit_delete','agenda_sync','capture_unit_delete','unidades geram tombstone antes da cascata');
SELECT trigger_is('calendar','professionals','trg_agenda_sync_capture_professional_delete','agenda_sync','capture_professional_delete','profissionais geram tombstone antes da cascata');
SELECT trigger_is('calendar','professional_locations','trg_agenda_sync_capture_assignment_delete','agenda_sync','capture_assignment_delete','vinculos geram tombstone antes da exclusao');
SELECT trigger_is('crm','leads','trg_agenda_sync_capture_patient','agenda_sync','capture_patient_change','pacientes alterados geram deltas');
SELECT trigger_is('calendar','availability_rules','trg_agenda_sync_capture_availability_rule','agenda_sync','capture_availability_change','disponibilidade gera deltas');

INSERT INTO crm.accounts(id,name,status) VALUES(9972,'Agenda Resync Test','active');
INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('99720000-0000-4000-8000-000000000001','authenticated','authenticated','agenda-resync@test.local','',now(),'{}','{}',now(),now());
INSERT INTO crm.users(id,auth_user_id,email,name,role,aces_id)
VALUES('99721000-0000-4000-8000-000000000001','99720000-0000-4000-8000-000000000001','agenda-resync@test.local','Agenda Resync','ADMIN',9972);
INSERT INTO crm.empresas(id,aces_id,cnpj,legal_name,name,address,city,state)
VALUES('99722000-0000-4000-8000-000000000001',9972,'66972304000129','Agenda Resync LTDA','Unidade Resync','Rua A','Curitiba','PR');
INSERT INTO crm.leads(id,aces_id,name,contact_phone,empresa_id)
VALUES('99723000-0000-4000-8000-000000000001',9972,'Paciente Resync','+5541999999999','99722000-0000-4000-8000-000000000001');
INSERT INTO calendar.professionals(id,aces_id,name)
VALUES('99724000-0000-4000-8000-000000000001',9972,'Profissional Resync');
INSERT INTO calendar.professional_locations(id,aces_id,professional_id,empresa_id)
VALUES('99725000-0000-4000-8000-000000000001',9972,'99724000-0000-4000-8000-000000000001','99722000-0000-4000-8000-000000000001');
INSERT INTO calendar.services(id,aces_id,name,duration_minutes)
VALUES('99726000-0000-4000-8000-000000000001',9972,'Consulta Resync',30);
INSERT INTO calendar.professional_services(aces_id,professional_location_id,service_id)
VALUES(9972,'99725000-0000-4000-8000-000000000001','99726000-0000-4000-8000-000000000001');
INSERT INTO calendar.availability_rules(aces_id,professional_location_id,weekday,start_time,end_time)
SELECT 9972,'99725000-0000-4000-8000-000000000001',day,'00:00'::time,'23:59'::time FROM generate_series(0,6) day;
INSERT INTO calendar.events(id,aces_id,title,start_time,end_time,lead_id,empresa_id,professional_id,professional_location_id,service_id,duration_minutes_snapshot)
VALUES('99728000-0000-4000-8000-000000000001',9972,'Consulta',
  ((current_date+2)::date::text||' 12:00')::timestamp AT TIME ZONE 'America/Sao_Paulo',
  ((current_date+2)::date::text||' 12:30')::timestamp AT TIME ZONE 'America/Sao_Paulo',
  '99723000-0000-4000-8000-000000000001','99722000-0000-4000-8000-000000000001','99724000-0000-4000-8000-000000000001',
  '99725000-0000-4000-8000-000000000001','99726000-0000-4000-8000-000000000001',30);
INSERT INTO agenda_sync.connections(id,aces_id,name,outbound_url,scope_mode,status,tested_at)
VALUES('99727000-0000-4000-8000-000000000001',9972,'Partner Resync','https://partner.example/events','all_resources','active',now());

SELECT lives_ok($$SELECT agenda_sync.start_resync(9972,'99721000-0000-4000-8000-000000000001','99727000-0000-4000-8000-000000000001','Teste concorrente')$$,'ressincronizacao inicia');
UPDATE crm.empresas SET name='Unidade Resync Atualizada' WHERE id='99722000-0000-4000-8000-000000000001';
SELECT is((SELECT count(*)::integer FROM agenda_sync.resync_deltas WHERE aces_id=9972),1,'alteracao concorrente entra no buffer');
SELECT is((SELECT count(*)::integer FROM agenda_sync.outbox WHERE aces_id=9972),0,'delta nao ultrapassa snapshot');
DO $$ DECLARE i integer; result jsonb; BEGIN FOR i IN 1..20 LOOP
  SELECT agenda_sync.claim_resync_batch('worker-resync',60,100) INTO result; EXIT WHEN result IS NULL;
END LOOP; END $$;
SELECT is((SELECT status FROM agenda_sync.resync_runs WHERE aces_id=9972),'awaiting_delivery','snapshot e deltas chegam a entrega');
SELECT ok((SELECT max(sequence) FILTER(WHERE resync_phase='snapshot') < min(sequence) FILTER(WHERE resync_phase='delta') FROM agenda_sync.outbox WHERE aces_id=9972),'delta fica depois de todo snapshot');
SELECT results_eq($$SELECT DISTINCT resync_phase FROM agenda_sync.outbox WHERE aces_id=9972 ORDER BY 1$$,$$SELECT * FROM (VALUES('delta'::text),('snapshot'::text)) expected(resync_phase)$$,'outbox identifica as duas fases');
UPDATE agenda_sync.outbox SET status='delivered',delivered_at=now() WHERE aces_id=9972;
SELECT is(agenda_sync.finalize_resyncs(),1,'finalizacao ativa execucao entregue');
SELECT is((SELECT status FROM agenda_sync.connections WHERE aces_id=9972),'active','conexao ativa somente ao final');

SELECT ok((SELECT bool_and(agenda_sync.consume_inbound_rate_limit(9972,'99727000-0000-4000-8000-000000000001','203.0.113.7',120)) FROM generate_series(1,120)),'primeiras 120 requisicoes sao aceitas');
SELECT ok(NOT agenda_sync.consume_inbound_rate_limit(9972,'99727000-0000-4000-8000-000000000001','203.0.113.7',120),'requisicao 121 e limitada');
SELECT ok(agenda_sync.consume_inbound_rate_limit(9972,'99727000-0000-4000-8000-000000000001','203.0.113.8',120),'outro IP possui janela independente');

UPDATE agenda_sync.outbox SET status='dead_letter',dead_lettered_at=now(),attempt_count=8
WHERE aces_id=9972 AND sequence=(SELECT min(sequence) FROM agenda_sync.outbox WHERE aces_id=9972);
INSERT INTO agenda_sync.deliveries(connection_id,aces_id,outbox_id,event_id,attempt_number,started_at,finished_at,duration_ms,outcome,worker_id)
SELECT connection_id,aces_id,id,event_id,1,now()-interval '2 minutes',now()-interval '1 minute',1,'dead_letter','worker-original'
FROM agenda_sync.outbox WHERE aces_id=9972 ORDER BY sequence LIMIT 1;
SELECT is(agenda_sync.resolve_dead_letter(9972,'99721000-0000-4000-8000-000000000001','99727000-0000-4000-8000-000000000001',
  (SELECT id FROM agenda_sync.outbox WHERE aces_id=9972 ORDER BY sequence LIMIT 1),'retry','Falha corrigida'),'retry','dead letter pode ser repetida com motivo');
SELECT is((SELECT attempt_count FROM agenda_sync.outbox WHERE aces_id=9972 ORDER BY sequence LIMIT 1),0::smallint,'retry reinicia tentativas preservando o evento');
CREATE TEMP TABLE retried AS SELECT * FROM agenda_sync.claim_delivery('worker-manual-retry',60,1);
SELECT is((SELECT count(*)::integer FROM retried),1,'retry manual inicia uma nova janela de entrega');
SELECT ok(agenda_sync.finish_delivery((SELECT id FROM retried),'worker-manual-retry',now(),1,204,'No Content'),'tentativa reiniciada nao colide com o historico');
SELECT is((SELECT count(*)::integer FROM agenda_sync.deliveries WHERE aces_id=9972 AND attempt_number=1),2,'historico conserva tentativas com o mesmo numero entre janelas');

SELECT * FROM finish();
ROLLBACK;
