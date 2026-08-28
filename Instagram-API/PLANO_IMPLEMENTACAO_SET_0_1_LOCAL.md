# Plano de implementação local — Sets 0 e 1

## Objetivo

Preparar o ambiente externo de desenvolvimento e a fundação interna de canal e identidade para Instagram Messaging, preservando Evolution, Meta WhatsApp e Gupshup. Esta etapa não implementa OAuth, webhook nem envio de mensagens; esses fluxos começam nos Sets 2, 3 e 4.

## Decisões fixas

- Meta App ID único do projeto: `1096313326150839`.
- Instagram é um canal próprio, com endereço `instagram_scoped_id` (IGSID), e nunca um telefone.
- `crm.instance_channels` é a única fonte de roteamento em runtime.
- Não existe fallback de Instagram para Evolution ou outro provider WhatsApp.
- O MVP Instagram permanece `manual_only`; IA, automações e workers estão desativados por flags.
- Secrets permanecem apenas no ambiente do backend. Nenhum valor real é salvo neste documento, nas migrations ou no frontend.
- Credenciais futuras serão armazenadas com AES-256-GCM, chave versionada e separação entre metadados e material criptografado.

## Set 0 — ambiente externo e configuração local

### Etapa 0.1 — configuração versionada

1. Manter `INSTAGRAM_APP_ID=1096313326150839` no exemplo de ambiente.
2. Deixar App Secret, verify token, versão da Graph API e chave de criptografia sem valores inventados.
3. Manter todas as flags Instagram em `false` até os respectivos sets estarem implementados e validados.
4. Usar o profile Docker Compose `instagram` para o serviço `cloudflared`.

### Etapa 0.2 — túnel nomeado

- Nome planejado: `instagram-local`.
- Tunnel ID confirmado: `1eec84c2-bf8a-48b6-932d-d1fca25b7d8c`.
- Hostname planejado: `instagram-dev-api.itstime.pro`.
- Destino dentro do Compose: `http://backend:3000`.
- O token deve ser colocado como `TUNNEL_TOKEN` somente no arquivo ignorado `.env.cloudflare`.
- O webhook e o callback precisam ser públicos para a Meta; não colocar Cloudflare Access diante dessas rotas.

O profile foi validado, a réplica conectou ao Tunnel ID confirmado e a origem local respondeu HTTP 200. A criação do Public Hostname/DNS no painel Cloudflare permanece uma etapa externa.

### Etapa 0.3 — painel Meta

No App `1096313326150839`:

1. Confirmar produto/login compatível com Instagram Messaging.
2. Manter o App em modo de desenvolvimento durante o piloto.
3. Associar uma conta Instagram profissional Business ou Creator.
4. Adicionar administradores, desenvolvedores e testers do piloto.
5. Confirmar na documentação vigente da Meta a versão Graph e as permissões mínimas realmente usadas.
6. Reservar as URLs futuras:
   - OAuth callback: `https://instagram-dev-api.itstime.pro/api/instagram/oauth/callback` (Set 2).
   - Webhook: `https://instagram-dev-api.itstime.pro/api/webhook/instagram` (Set 3).
7. Gerar App Secret e verify token sem copiá-los para arquivos versionados.
8. Registrar o estado de Business Verification e App Review; nenhum dos dois é considerado concluído por esta implementação local.

## Set 1 — fundação de canal e identidade

### Etapa 1.1 — migration de roteamento e identidade

Migration: `supabase/migrations/20260825234904_instagram_channel_identity_foundation.sql`.

- Cria `crm.instance_channels`, com par válido entre tipo de canal e provider.
- Faz backfill de todas as instâncias atuais, preservando provider conhecido e mantendo Evolution explícito para os registros legados sem configuração.
- Cria `crm.lead_channel_identities`, com unicidade por `(channel_id, provider_user_id)` e FKs compostas de tenant.
- Permite `crm.leads.contact_phone = NULL`.
- Adiciona Instagram aos constraints compartilhados de provider.
- Cria `crm.rpc_find_or_create_channel_lead`, com lock transacional por canal e IGSID.
- Cria RPCs transacionais para configuração de Meta WhatsApp e Gupshup, mantendo suas tabelas legadas sincronizadas para rollback.
- Habilita RLS e restringe tabelas/RPCs sensíveis ao `service_role`.

### Etapa 1.2 — schema operacional backend-only

Migration: `supabase/migrations/20260825234913_instagram_operational_schema.sql`.

- Cria `instagram.channels`.
- Cria `instagram.channel_credentials`, separando ciphertext, IV, auth tag e versão da chave.
- Cria `instagram.oauth_states`, `instagram.webhook_events` e `instagram.provider_status_events` para os próximos sets.
- Habilita RLS, remove acesso direto de `anon`/`authenticated` e concede acesso somente ao backend.
- Expõe o schema ao PostgREST local apenas para uso autenticado pelo backend.

### Etapa 1.3 — contratos e resolver

- `Project/IA/messaging-channel.ts`: providers, tipos de canal, capability, origem e endereços discriminados.
- `Project/IA/messaging-channel-resolver.ts`: resolve por tenant + instância usando somente `crm.instance_channels`.
- `Project/IA/whatsapp-provider-registry.ts`: usa o resolver canônico e rejeita Instagram antes de selecionar um provider WhatsApp.
- Serviços admin Meta/Gupshup usam as novas RPCs transacionais.
- Chamadas de automação e agente passam `aces_id`, impedindo resolução fora do tenant.
- O tipo frontend de telefone do lead aceita `null`, sem sintetizar número para Instagram.
- `schema-preflight.ts` valida as duas tabelas CRM e as cinco tabelas do schema Instagram.

## Execução local

### 1. Subir dependências

```powershell
npx supabase start
docker compose up -d redis backend
```

Para subir também o túnel, depois de copiar `.env.cloudflare.example` para o arquivo ignorado `.env.cloudflare` e configurar o token real:

```powershell
docker compose --profile instagram up -d --build
```

### 2. Aplicar migrations

Em uma base local nova ou com histórico alinhado:

```powershell
npx supabase migration up --local
```

O banco local usado nesta entrega possui a migration remota `20260817205108` sem arquivo correspondente no repositório. Por segurança, não foi executado `migration repair` nem `db reset`. As duas migrations novas foram aplicadas diretamente nesse banco apenas para validação. Antes de um replay limpo, é obrigatório reconciliar esse histórico; não apagar dados locais para contornar a divergência.

### 3. Validar banco, concorrência e contratos

```powershell
npx supabase test db supabase/tests/instagram_channel_foundation.sql --local

$supabaseStatus = npx supabase status --output json 2>$null | ConvertFrom-Json
$env:SUPABASE_URL = $supabaseStatus.API_URL
$env:SUPABASE_SERVICE_ROLE_KEY = $supabaseStatus.SERVICE_ROLE_KEY
$env:INSTAGRAM_FOUNDATION_INTEGRATION = "true"
npm --prefix Project/IA run test:instagram:integration
npm --prefix Project/IA run schema:check
```

### 4. Validar aplicação e regressões

```powershell
npm --prefix Project/IA run build
npm --prefix Project/IA test
npm run typecheck
docker compose --profile instagram config --quiet
```

## Saída esperada para avançar ao Set 2

- Histórico de migrations reconciliado e replay limpo aprovado.
- Túnel e hostname públicos ativos.
- Configuração externa do App Meta e conta profissional de teste confirmadas.
- Secrets reais disponíveis somente no backend.
- Todos os itens obrigatórios do Set 1 continuam verdes.
