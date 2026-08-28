# PAI — Plano de Ação e Implementação do WhatsApp oficial da Meta

## Objetivo

Consolidar e preparar para operação a integração oficial do WhatsApp Business Platform/Cloud API da Meta no CRM, usando o código existente como base e garantindo que ela permaneça isolada de Evolution, Gupshup, Instagram e Messenger.

O MVP deve permitir configurar uma conta WABA e um número oficial, receber mensagens e status, enviar mensagens livres dentro da janela permitida e enviar templates aprovados quando a política exigir. O sistema deve operar por tenant e instância, com credenciais protegidas, auditoria e rollback controlado.

## Baseline existente

Antes de iniciar, registrar o estado atual destes componentes:

- `Project/IA/meta-whatsapp-provider.ts`
- `Project/IA/meta-webhook.ts`
- `Project/IA/meta-admin-service.ts`
- `Project/IA/meta-template-service.ts`
- `supabase/migrations/20260526023423_add_meta_whatsapp_foundation.sql`
- `src/services/instanceService.ts`
- `src/components/admin/InstanceManager.tsx`
- `src/pages/Chat.tsx`
- testes do provider, webhook, templates e política de envio.

O plano deve fechar lacunas e endurecer a operação existente; não deve substituir silenciosamente os contratos de Evolution ou Gupshup.

## Pré-condição 0 — baseline Git e segurança

1. Publicar a entrega local do Instagram na branch `instagram`, conforme `Messenger-API/PAI_MESSENGER.md`, antes de usar a fundação neutra como dependência de rollout.
2. Criar uma branch própria para o trabalho do WhatsApp oficial, a partir do baseline publicado e validado.
3. Separar commits de schema, backend, frontend, testes e documentação.
4. Verificar `git diff --check`, secrets, arquivos ignorados e artefatos locais antes de qualquer push.
5. Não colocar App Secret, access token, webhook verify token ou referências sensíveis reais em migrations, frontend, logs ou documentos versionados.

## Decisões fixas

- O provider oficial será `meta`; Evolution e Gupshup continuam providers independentes.
- `crm.instance_channels` será a fonte canônica de roteamento em runtime.
- Uma instância representa um número/canal de transporte; WABA, número e tenant devem formar um vínculo inequívoco.
- A identidade do contato do WhatsApp é o telefone normalizado, com `phone_identity` como chave operacional; não misturar com PSID, IGSID ou identificadores de Instagram/Messenger.
- O `phone_number_id` é a chave de roteamento do número oficial no webhook e no envio.
- Access token e App Secret ficam somente no backend, preferencialmente em secret manager/Vault; se o ambiente exigir armazenamento local, usar referência protegida e criptografia envelope.
- Mensagens livres seguem a janela vigente da Meta; fora dela, somente template aprovado e permitido pelo contrato atual.
- Templates precisam ser sincronizados, versionados por idioma/estado e validados antes do envio.
- Nenhum envio automático, IA, campanha ou follow-up será habilitado apenas porque o provider manual funciona.
- Graph API version, permissões, limites, categorias de template, pricing e regras de qualidade devem ser reconfirmados na documentação oficial antes do piloto.

## Set 1 — validação externa e configuração Meta

### Conta e ativos

- Confirmar Business Manager, WABA, número de telefone e business portfolio.
- Confirmar que o número não está vinculado a outro produto/provedor incompatível ou documentar a migração necessária.
- Confirmar permissões atuais para gerenciar WABA, números, templates, mensagens e webhooks.
- Definir se o onboarding será por Embedded Signup ou por configuração administrativa controlada.
- Confirmar App Review, Business Verification, papéis de administrador/tester e ambiente de teste.
- Reconfirmar versão Graph e endpoints oficiais antes de codificar novos contratos.

### Ambiente

- Definir `META_GRAPH_API_VERSION`, App ID, App Secret, verify token e referências de access token por ambiente.
- Garantir que webhook público não fique atrás de autenticação de usuário ou Cloudflare Access.
- Manter flags desligadas por padrão e preparar staging com um único número piloto.

### Saída do Set 1

- WABA/número de teste disponível.
- Fluxo de onboarding escolhido e aprovado.
- Secrets configurados somente no backend.
- URLs de callback/webhook e permissões registradas sem valores sensíveis.

## Set 2 — fundação de canal, instância e tenant

### Banco

- Revisar a migration `meta.whatsapp_channels` e garantir vínculo único entre tenant, instância e `phone_number_id`.
- Fazer `crm.instance_channels` ser a fonte de roteamento, preservando os registros legados de Meta.
- Criar ou ajustar RPC transacional de upsert para impedir colisão de WABA, número e instância entre tenants.
- Garantir constraints de provider/canal e estados `draft`, `active`, `disabled` e `error`.
- Aplicar RLS, grants mínimos e isolamento por `aces_id`.
- Criar preflight que valide tabelas, colunas, funções, grants, RLS e constraints necessários.

### Segurança Supabase

- Não conceder `service_role` ou qualquer segredo ao frontend.
- Não usar `raw_user_meta_data` para decisões de autorização.
- Se houver views administrativas, mantê-las protegidas e com comportamento compatível com RLS.
- Testar `SELECT`, `UPDATE` e RPCs com usuário de tenant correto, tenant incorreto e papel sem permissão.
- Executar advisors após mudanças de schema e gerar migration versionada somente depois da revisão.

### Saída do Set 2

- Configuração Meta não altera canais de outro provider.
- Um `phone_number_id` não pode apontar para dois tenants ativos.
- O backend falha de forma explícita quando a configuração está incompleta.

## Set 3 — credenciais e onboarding

- Definir contrato de credencial: token de sistema ou token emitido pelo onboarding escolhido, validade, rotação e revogação.
- Implementar armazenamento protegido e separação entre metadados e material secreto.
- Criar fluxo de conexão/reconexão com state, nonce, tenant, instância e replay protection quando OAuth/Embedded Signup for usado.
- Validar WABA, número, display name e permissões no backend antes de ativar o canal.
- Persistir apenas IDs e metadados necessários ao painel.
- Não exibir token, App Secret ou authorization code nas respostas administrativas.
- Auditar conexão, reconexão, rotação, desativação e falhas de validação.
- Criar health check operacional que diferencie token inválido, número desativado, permissão ausente, template rejeitado e indisponibilidade Meta.

Rotas a consolidar ou criar:

- `POST /api/meta/whatsapp/connect/start`
- `GET /api/meta/whatsapp/connect/callback`
- `GET /api/meta/channels`
- `POST /api/meta/channels/:channelId/refresh`
- `POST /api/meta/channels/:channelId/disable`
- `GET /api/meta/metrics`

## Set 4 — webhook, inbound e status

- Manter `GET/POST /api/webhook/meta` compatível com o formato oficial vigente.
- Capturar raw body antes do parse e validar `X-Hub-Signature-256` com comparação segura.
- Roteiar inbound por `metadata.phone_number_id`, nunca apenas pelo telefone do remetente.
- Normalizar texto, mídia, áudio, documento, localização, reação e interações conforme o escopo aprovado; tipos não suportados devem ser `ignored` e observáveis.
- Localizar lead por telefone normalizado respeitando tenant e instância.
- Persistir mensagens com `provider = 'meta'` e `provider_message_id` idempotente.
- Persistir status `sent`, `delivered`, `read` e `failed`, incluindo código/mensagem sanitizados.
- Deduplicar mensagens e status repetidos, inclusive concorrentes.
- Garantir que o webhook responda somente após processamento limitado ou persistência durável.
- Implementar retry, lease, backoff e dead letter para falhas processáveis.
- Impedir que evento de um `phone_number_id` atualize mensagem ou lead de outro canal.

## Set 5 — outbound e política de mensagens

### Mensagem livre

- Revisar `meta-whatsapp-provider.ts` para usar o endpoint e payload oficial da Graph API vigente.
- Validar destinatário por `phone_identity` e canal resolvido.
- Permitir mensagem livre somente quando a política indicar janela aberta.
- Persistir o ID retornado pela Meta imediatamente após sucesso.

### Templates

- Sincronizar templates por WABA e idioma com `meta-template-service.ts`.
- Persistir estado, categoria, componentes, variáveis, idioma, rejeição e data da última sincronização.
- Validar template aprovado, idioma e variáveis antes de chamar a Meta.
- Não permitir template rejeitado, pausado, inexistente ou com variáveis incompatíveis.
- Exibir no composer somente templates elegíveis para a instância selecionada.
- Diferenciar erro de validação local, erro da Meta e falha de persistência.

### Política

- Consolidar `freeform`, `template_required` e `closed` sem alterar a política própria de Instagram/Messenger.
- Bloquear fora da janela antes da Graph API quando não houver template permitido.
- Garantir que automação e IA não usem capacidade exclusiva de atendimento humano.
- Cobrir opt-out, bloqueio, qualidade da conta e limites operacionais conforme as regras vigentes da Meta.

## Set 6 — frontend e operação

### Chat

- Reutilizar `Chat.tsx`, `ChatInput`, cards de template e estados já existentes.
- Exibir claramente quando o envio é livre, exige template ou está fechado.
- Permitir seleção de template com idioma e campos variáveis validados.
- Desabilitar envio durante loading, erro, token inválido, canal inativo ou falta de permissão.
- Mostrar status de envio sem expor payload técnico ou segredo.
- Preservar anexos somente nos tipos realmente suportados e testados pelo provider.

### Administração

- Consolidar o card Meta WhatsApp no `InstanceManager.tsx`.
- Exibir WABA, número mascarado/display phone, estado, saúde, último erro sanitizado e última sincronização de templates.
- Ações primárias: conectar, reconectar ou resolver configuração, conforme o estado.
- Ações secundárias: atualizar, sincronizar templates e desativar com confirmação acessível.
- Nunca exibir token, App Secret, chave de criptografia ou authorization code.
- Seguir o design system: `bg-base`, superfícies contidas, CTA laranja único, foco visível, estados completos, responsividade 1280/1024/768/mobile e reduced motion.

## Set 7 — testes e observabilidade

### Banco e segurança

- Migration aplicada em staging sem reset destrutivo.
- Constraints, RPCs, RLS, grants e isolamento por tenant.
- Colisão de `phone_number_id`, WABA, instância e provider.
- Dedupe concorrente e atualização idempotente de status.

### Backend

- Provider: texto, template, mídia permitida, erros e redaction.
- Webhook: challenge, assinatura, raw body, inbound, status, eventos incompletos e dead letter.
- Policy: janela aberta, template obrigatório, fechado, opt-out e bloqueio pré-API.
- Resolver: Meta preservado e Evolution/Gupshup sem regressão.
- Onboarding: state/replay/tenant, credencial protegida, rotação e desativação.

### Frontend

- Composer nos três modos.
- Template com idioma, variáveis inválidas e estado sem templates.
- Painel em loading, ativo, atenção, erro, reconexão e desativado.
- Acessibilidade, foco, teclado, breakpoints e console sem erros.

### Métricas mínimas

- Inbound/outbound por instância e `phone_number_id`.
- Mensagens livres aceitas, bloqueadas e falhas.
- Templates sincronizados, usados, rejeitados e com variáveis inválidas.
- Status Meta por categoria e tempo de persistência.
- Webhooks deduplicados, processados, falhos e em dead letter.
- Saúde do número, token, WABA e qualidade.

## Rollout

1. Validar e publicar baseline do Instagram.
2. Criar branch do WhatsApp oficial e aplicar fundação em staging.
3. Conectar um WABA/número piloto sem habilitar automações.
4. Validar webhook real e inbound.
5. Validar mensagem livre dentro da janela.
6. Validar template aprovado fora da janela, somente conforme política vigente.
7. Observar status, qualidade, erros, métricas e dead letters.
8. Expandir por tenant/número com autorização explícita.
9. Só depois avaliar automação, IA, mídia ampliada e campanhas em escopos separados.

## Flags sugeridas

- `META_WHATSAPP_ENABLED`
- `META_WHATSAPP_OUTBOUND_ENABLED`
- `META_WHATSAPP_WEBHOOK_WORKER_ENABLED`
- `META_WHATSAPP_TEMPLATE_SYNC_ENABLED`
- `META_WHATSAPP_AUTOMATION_ENABLED` — permanece `false` no MVP.

Flags de Meta WhatsApp não devem controlar Instagram, Messenger, Evolution ou Gupshup.

## Rollback

- Desabilitar outbound e workers Meta WhatsApp primeiro.
- Marcar somente o channel binding/número afetado como `disabled` ou `error`.
- Preservar histórico, templates, status, identidades e migrations.
- Não alterar bindings de Instagram, Messenger, Evolution ou Gupshup.
- Reverter aplicação somente com compatibilidade de schema ou plano de migration reversível.
- Invalidar credencial apenas por ação administrativa auditada.
- Reativar após health check, teste de webhook e envio piloto aprovados.

## Critério final de aceite

Um número oficial conectado a uma WABA de teste é roteado pelo tenant correto, recebe mensagens e status com assinatura e deduplicação, localiza o lead pelo telefone normalizado, envia mensagem livre dentro da janela, usa template aprovado quando exigido, bloqueia cenários inválidos antes da Graph API, mantém tokens protegidos, oferece operação administrativa auditável e não altera o comportamento dos demais providers.

## Referências oficiais a reconfirmar

- WhatsApp Business Platform: https://developers.facebook.com/docs/whatsapp
- Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api
- Webhooks: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
- Send messages: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages
- Templates: https://developers.facebook.com/docs/whatsapp/message-templates
- Embedded Signup: https://developers.facebook.com/docs/whatsapp/embedded-signup
- App Review: https://developers.facebook.com/docs/app-review

Versões, permissões, limites, pricing, categorias de template e políticas de janela são voláteis. Devem ser confirmados novamente antes da implementação e do piloto.
