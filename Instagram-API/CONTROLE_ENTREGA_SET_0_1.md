# Controle de entrega e validação — Sets 0 e 1

Atualizado em: 2026-08-21
Branch: `instagram`
Meta App ID único: `1096313326150839`

## Etapa A — preparação

- [x] Branch `instagram` criada a partir do estado solicitado.
- [x] Alterações locais anteriores do usuário preservadas.
- [x] App ID antigo removido da configuração local.
- [x] Nenhum secret real adicionado a arquivos versionados.

## Etapa B — Set 0 local

- [x] Variáveis Instagram documentadas em `.env.local.example`.
- [x] Flags de canal, webhook, refresh e automação começam em `false`.
- [x] Profile `cloudflared` adicionado ao Docker Compose.
- [x] Configuração do Compose validada.
- [x] Tunnel ID `1eec84c2-bf8a-48b6-932d-d1fca25b7d8c` confirmado e conectado.
- [x] Réplica `cloudflared` ativa com quatro conexões QUIC registradas.
- [x] Token isolado no arquivo ignorado `.env.cloudflare`, sem exposição ao backend.
- [x] Origem local `http://backend:3000` saudável.
- [x] Apontar `instagram-dev-api.itstime.pro` para `http://backend:3000`.
- [x] Validar `https://instagram-dev-api.itstime.pro/health` após criar o Public Hostname/DNS.
- [ ] Confirmar produto Instagram Messaging no App `1096313326150839`.
- [ ] Confirmar App em modo desenvolvimento, papéis e conta Business/Creator de teste.
- [ ] Confirmar versão Graph e permissões vigentes no painel/documentação Meta.
- [ ] Gerar e configurar App Secret e verify token no backend.
- [ ] Registrar situação de Business Verification e App Review.

## Etapa C — Set 1 banco

- [x] `crm.instance_channels` criada e usada como fonte canônica.
- [x] Backfill preserva providers existentes.
- [x] `crm.lead_channel_identities` criada com unicidade por canal + IGSID.
- [x] `crm.leads.contact_phone` aceita `NULL`.
- [x] Isolamento por tenant aplicado com FKs compostas.
- [x] RPC transacional de localização/criação do lead criada.
- [x] Schema `instagram` e cinco tabelas operacionais criados.
- [x] RLS e grants backend-only aplicados.
- [x] PostgREST local e schema preflight atualizados.
- [x] Migrations aplicadas diretamente ao banco local para validação.
- [ ] Reconciliar a migration ausente `20260817205108` e validar replay limpo sem apagar dados locais.

## Etapa D — Set 1 backend

- [x] Tipos neutros distinguem telefone de IGSID.
- [x] Resolver consulta somente `crm.instance_channels`.
- [x] Provider ausente/inválido gera erro explícito.
- [x] Instagram não possui fallback para Evolution.
- [x] Registry WhatsApp recebe tenant e rejeita canal Instagram.
- [x] Configuração Meta WhatsApp/Gupshup usa RPC transacional.
- [x] Tipo de telefone do lead atualizado para `string | null`.

## Etapa E — validação executada

- [x] Build backend: aprovado.
- [x] Typecheck frontend: aprovado.
- [x] Testes backend: 133 aprovados, 0 falhas.
- [x] Testes pgTAP Set 1: 22 aprovados, 0 falhas.
- [x] Teste real com 12 chamadas concorrentes: 1 lead e 1 identidade.
- [x] Lead concorrente criado com telefone nulo.
- [x] Schema preflight: aprovado.
- [x] Docker Compose com profile Instagram: configuração válida.
- [x] Supabase advisors executados; nenhum aviso nas estruturas novas.
- [ ] OAuth real com conta de teste — escopo do Set 2.
- [ ] Webhook real — escopo do Set 3.
- [ ] Outbound manual — escopo do Set 4.

## Gate para iniciar o Set 2

- [ ] Todas as pendências externas do Set 0 resolvidas.
- [ ] Histórico/replay das migrations validado em base descartável ou staging.
- [ ] Checklist revisado sem incluir secrets em evidências.
