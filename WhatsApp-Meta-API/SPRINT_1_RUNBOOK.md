# Sprint 1 — operação segura do WhatsApp Meta

Este runbook cobre a aplicação no Supabase local do Docker, o `internal_bootstrap`, as verificações
de aceite e o rollback do canal piloto. Nenhum comando abaixo deve receber o
valor de um token como argumento.

## Estado seguro obrigatório

Mantenha estas flags no backend local:

```env
META_WHATSAPP_ONBOARDING_MODE=internal_bootstrap
META_WHATSAPP_OUTBOUND_ENABLED=false
META_WHATSAPP_WEBHOOK_WORKER_ENABLED=false
META_WHATSAPP_TEMPLATE_SYNC_ENABLED=false
META_WHATSAPP_AUTOMATION_ENABLED=false
META_GRAPH_API_VERSION=v26.0
META_APP_ID=<meta-app-id>
```

As variáveis `*_SECRET_REF` contêm somente o nome da variável protegida que
guarda o segredo. Os valores reais existem apenas no ambiente do backend.

## Aplicação no Supabase Docker

Inicie ou confirme o Supabase local. Não use reset e não execute comandos com
`--linked`: esta sprint usa exclusivamente o banco do Docker.

```powershell
supabase status
supabase migration up --local
supabase test db --local supabase/tests/meta_whatsapp_secure_foundation.sql
```

Depois da migration, carregue as credenciais locais do Docker apenas no processo
atual e execute o preflight:

```powershell
$localSupabase = supabase status -o env
$localSupabase | ForEach-Object {
  if ($_ -match '^([A-Z_]+)="(.*)"$') {
    [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
  }
}
$env:SUPABASE_URL = $env:API_URL
$env:SUPABASE_SERVICE_ROLE_KEY = $env:SERVICE_ROLE_KEY
Set-Location Project/IA
npm run schema:check
```

## Bootstrap do número piloto

Configure no backend os identificadores operacionais, as referências e o
operador:

```env
META_BOOTSTRAP_ACES_ID=<tenant-id>
META_BOOTSTRAP_INSTANCE_NAME=<instance-name>
META_BOOTSTRAP_WABA_ID=<waba-id>
META_BOOTSTRAP_PHONE_NUMBER_ID=<phone-number-id>
META_BOOTSTRAP_BUSINESS_ID=<business-id>
META_BOOTSTRAP_ACCESS_TOKEN_SECRET_REF=META_PILOT_ACCESS_TOKEN
META_BOOTSTRAP_APP_SECRET_REF=META_APP_SECRET
META_BOOTSTRAP_VERIFY_TOKEN_SECRET_REF=META_WEBHOOK_VERIFY_TOKEN
META_BOOTSTRAP_ACTOR_ID=<operator-id>
```

Execute no backend:

```powershell
$localSupabase = supabase status -o env
$localSupabase | ForEach-Object {
  if ($_ -match '^([A-Z_]+)="(.*)"$') {
    [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
  }
}
$env:SUPABASE_URL = $env:API_URL
$env:SUPABASE_SERVICE_ROLE_KEY = $env:SERVICE_ROLE_KEY
Set-Location Project/IA
npm run meta:bootstrap
```

O comando valida tenant, instância, WABA, número e acesso na Graph API antes de
persistir. O resultado contém somente o DTO operacional sanitizado. O canal é
salvo em `draft`, portanto o provider canônico existente não é alterado.

## Aceite

1. Execute `npm run schema:check` e confirme o preflight verde.
2. Consulte `GET /api/meta/channels` como administrador e confirme somente ID,
   instância, WABA, telefone exibido, status, saúde e timestamps.
3. Confirme que o canal pertence ao `aces_id` e à instância piloto corretos.
4. Confirme que o binding existente foi preservado enquanto o canal está em
   `draft`.
5. Confirme que outbound, worker de webhook, templates e automação continuam
   desativados.
6. Verifique a auditoria `bootstrap` sem payloads técnicos ou segredos.

## Ativação explícita

A promoção para provider `meta` é uma operação backend-only. Ela deve ser feita
somente depois do aceite do piloto e exige configuração completa já validada:

```sql
select crm.rpc_set_meta_whatsapp_channel_status(
  <tenant-id>,
  '<instance-name>',
  'active',
  '<operator-id>'
);
```

A ativação altera `crm.instance_channels` de forma transacional e registra a
auditoria. A flag de outbound continua sendo uma trava independente.

## Rollback sem perda de histórico

Com as mesmas variáveis de tenant, instância e operador usadas no bootstrap:

```powershell
$localSupabase = supabase status -o env
$localSupabase | ForEach-Object {
  if ($_ -match '^([A-Z_]+)="(.*)"$') {
    [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
  }
}
$env:SUPABASE_URL = $env:API_URL
$env:SUPABASE_SERVICE_ROLE_KEY = $env:SERVICE_ROLE_KEY
Set-Location Project/IA
npm run meta:disable
```

O rollback muda o canal e o binding Meta para `disabled`, registra a auditoria
e preserva configuração e histórico. Ele não apaga linhas e não altera bindings
de outros providers.
