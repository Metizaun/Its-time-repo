# Release 2026-09-14 — Chat, Cobrança e Agenda

## Escopo imutável

- Branch: `release/2026-09-14`
- Tag: `release-2026-09-14.2`
- Supabase: `https://supa.itstime.pro`
- API: `https://api.itstime.pro`
- Frontend: `https://app.itstime.pro`
- Node.js: 22

Preencher o commit e a imagem antes do deploy:

```text
Commit: _________________________________________
Imagem: _________________________________________
Operador: _______________________________________
Início da janela: _______________________________
```

## 1. Gates antes da mudança

- [ ] Confirmar que a branch e a tag apontam para o mesmo commit.
- [ ] Confirmar que o artefato do frontend e a imagem do backend usam esse commit.
- [ ] Executar `ops/supabase-selfhost/validate-gates.sh` na VPS do Supabase.
- [ ] Confirmar Postgres privado, `pgcrypto`, `pg_cron`, espaço livre, memória e ausência de OOM.
- [ ] Confirmar que API, Auth, Storage e Realtime estão saudáveis antes da mudança.
- [ ] Confirmar presença dos secrets obrigatórios sem imprimir seus valores.
- [ ] Confirmar que todas as conexões de Agenda e todas as contas de Cobrança, exceto o canário aprovado, estão pausadas.

## 2. Registro obrigatório do backup

Executar o backup completo de banco e Storage antes das migrations.

```text
Horário: ________________________________________
Commit/imagem: __________________________________
Última migration antes do deploy: ______________
Usuários: _______________________________________
Buckets: ________________________________________
Objetos: ________________________________________
Banco — arquivo/checksum: _______________________
Storage — arquivo/checksum: _____________________
Responsável: ____________________________________
Restauração verificada por: _____________________
```

Não executar `restore-dump.sh` durante o fluxo normal de publicação.

## 3. Migrations self-hosted

Usar exclusivamente a conexão privada direta do Postgres self-hosted:

```bash
supabase migration list --db-url "$SELFHOST_DB_URL"
supabase db push --db-url "$SELFHOST_DB_URL" --dry-run --skip-vault
```

O delta precisa corresponder ao commit da release. Interromper se houver divergência no histórico. Após aprovação do backup e do dry-run:

```bash
supabase db push --db-url "$SELFHOST_DB_URL" --yes --skip-vault
supabase migration list --db-url "$SELFHOST_DB_URL"
```

É proibido usar `--linked`, `--include-all`, excluir registros de `schema_migrations` ou aplicar SQL avulso fora do histórico.

Após a aplicação:

- [ ] Confirmar tabelas, funções, grants, RLS e triggers de `agenda_sync`.
- [ ] Confirmar acesso de `agenda_sync` somente pelo backend/service role.
- [ ] Confirmar publicação Realtime do Chat.
- [ ] Confirmar reload do PostgREST.
- [ ] Executar `schema-preflight` contra `https://supa.itstime.pro`.

## 4. Runtime e deploy

Valores obrigatórios no ambiente protegido da API:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
GUPSHUP_WEBHOOK_SECRET
RB_WEBHOOK_JWT_SECRET
COLLECTION_SECRETS_ENCRYPTION_KEY
COLLECTION_SECRETS_ENCRYPTION_KEY_VERSION
AGENDA_SECRETS_ENCRYPTION_KEY
AGENDA_SECRETS_ENCRYPTION_KEY_VERSION
RB_BILLING_WORKER_ENABLED=true
CORS_ORIGINS=https://app.itstime.pro
WEBHOOK_PUBLIC_BASE_URL=https://api.itstime.pro
```

Publicar o backend somente com a branch explícita:

```bash
cd /opt/chat-query
GIT_BRANCH=release/2026-09-14 bash scripts/deploy-backend-vps.sh
```

Gates do backend:

- [ ] `itstime-api_api` na réplica esperada e sem reinício.
- [ ] `itstime-api_collection-worker` em `1/1` e sem reinício.
- [ ] `itstime-api_agenda-worker` em `1/1` e sem reinício.
- [ ] `https://api.itstime.pro/health` retorna HTTP 200.
- [ ] `schema-preflight` aprovado dentro da imagem.
- [ ] Nenhum secret ou payload sensível aparece nos logs.

Publicar o frontend com o mesmo commit e confirmar:

```text
VITE_SUPABASE_URL=https://supa.itstime.pro
VITE_SUPABASE_PUBLISHABLE_KEY=<anon/publishable do self-hosted>
VITE_CRM_BACKEND_URL=https://api.itstime.pro
```

Nunca configurar service role ou secret privado no frontend.

## 5. Ativação canário

### Chat interno

- [ ] ADMIN e VENDEDOR da mesma conta criam conversa direta e grupo.
- [ ] Menção, não lidas, Realtime e anexo funcionam.
- [ ] Usuário de outra conta não lê nem publica na conversa.

### Cobrança independente

- [ ] Somente a conta canário está com conexão, `billing_enabled` e binding `rb_billing` ativos.
- [ ] Execução manual por ADMIN conclui uma vez.
- [ ] Execução manual por usuário não ADMIN retorna 403.
- [ ] Repetição não gera duplicidade e preserva idempotência.
- [ ] Conta pausada não processa cobrança.

### Agenda

- [ ] Todas as conexões começam pausadas.
- [ ] Apenas o parceiro canário aprovado é ativado.
- [ ] Assinatura HMAC e credenciais validadas.
- [ ] `patient.upserted` ocorre antes de `appointment.created`.
- [ ] Retry, dead letter, inbound e resync foram exercitados.
- [ ] Isolamento por empresa/profissional confirmado.
- [ ] Pausa da conexão interrompe novos processamentos.
- [ ] Retenção, exclusão/anonimização, contrato de dados, rate limits e timeouts aprovados.

Sem parceiro e aprovação operacional, manter Agenda publicada e pausada.

## 6. Observação e rollback

Observar por no mínimo 60 minutos após os smoke tests:

- erros 5xx e reinícios;
- filas, retries e dead letters da Agenda;
- duplicidades ou falhas de cobrança;
- eventos Realtime, Auth e Storage do Chat;
- presença indevida de secrets nos logs.

Em caso de falha:

1. Pausar Cobrança e conexões da Agenda.
2. Reverter API e frontend ao artefato anterior.
3. Manter migrations e histórico aplicados.
4. Corrigir banco apenas por migration posterior.
5. Restaurar backup somente em desastre aprovado.

```text
Fim da observação: ______________________________
Resultado: ______________________________________
Responsável pelo aceite: ________________________
```
