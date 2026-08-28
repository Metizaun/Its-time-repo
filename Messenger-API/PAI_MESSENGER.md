# PAI — Plano de Ação e Implementação do Messenger

## Objetivo

Adicionar o Messenger como a próxima integração Meta do CRM, reutilizando a fundação neutra de canais criada para o Instagram, sem transformar Messenger em uma variação de WhatsApp ou acoplar sua identidade a telefone.

O MVP deve permitir conectar uma Página do Facebook, receber mensagens no chat/fila existentes e responder manualmente dentro das regras vigentes da Meta. IA, automações e campanhas ficam fora do primeiro rollout.

## Pré-condição 0 — publicar o estado local do Instagram

Antes de iniciar alterações específicas do Messenger:

1. Revisar o working tree atual da branch `instagram`, que contém a implementação local do Instagram.
2. Confirmar que não há secrets, tokens, arquivos locais ou artefatos de runtime no conjunto a publicar.
3. Validar o estado local com os comandos já definidos em `Instagram-API/CONTROLE_ENTREGA_SET_0_1.md`, `CONTROLE_ENTREGA_SET_2_3_4.md` e `CONTROLE_ENTREGA_SET_5_6.md`.
4. Reconciliar ou documentar a migration remota ausente `20260817205108` antes de depender de replay limpo.
5. Criar commits coesos para a entrega do Instagram, preservando mudanças não relacionadas quando necessário.
6. Publicar explicitamente a branch local `instagram` no remoto, configurando upstream somente se ainda não existir:

```powershell
git status --short
git diff --check
git add <arquivos-da-entrega-instagram>
git commit -m "feat: implement Instagram messaging integration"
git push -u origin instagram
```

7. Registrar o hash publicado e o resultado de build/testes no controle de entrega do Instagram.

Essa etapa não autoriza ativar o Instagram em produção. As flags e os gates reais continuam válidos.

## Decisões fixas

- Messenger será um canal próprio: `channel_type = 'messenger'` e `provider = 'messenger'`.
- A fonte de roteamento em runtime continuará sendo `crm.instance_channels`.
- Cada Página conectada terá uma instância dedicada no tenant; não compartilhará a instância de transporte com WhatsApp ou Instagram.
- A identidade do contato será um PSID (Page-scoped ID), escopado por Página/canal, armazenado em `crm.lead_channel_identities`.
- `crm.leads.contact_phone` poderá permanecer `NULL`; não será criado telefone sintético.
- O token será um Page Access Token protegido no backend, criptografado em repouso e nunca retornado ao frontend.
- O webhook responderá somente depois de validar assinatura e persistir/processar o evento de forma durável.
- O MVP será `manual_only`; IA, automações e mensagens de sistema não poderão usar capacidades exclusivas de atendimento humano.
- Nenhum template, provider, janela ou regra de WhatsApp será reutilizado sem um contrato explícito do Messenger.
- Versão da Graph API, permissões, janela de mensagens, requisitos de App Review e limites serão confirmados na documentação oficial da Meta antes do Set 1 e novamente antes do piloto.

## Set 0 — validação externa e publicação

### Meta e ambiente

- Confirmar que o App Meta usado pelo projeto pode operar Messenger para Página.
- Confirmar permissões mínimas atuais para leitura, recebimento e envio de mensagens.
- Confirmar o fluxo de login/autorização da Página e a forma vigente de emissão do Page Access Token.
- Confirmar a Página Business/Creator de teste, seus administradores e testers.
- Reservar as rotas públicas:
  - `GET/POST /api/webhook/messenger`
  - callback OAuth específico, caso o onboarding escolhido exija callback.
- Configurar verify token e App Secret somente no backend.
- Reconfirmar a política atual de janela, tags, handoff humano e reengagement; o MVP deve bloquear qualquer cenário não comprovado.
- Manter todas as flags Messenger desligadas por padrão.

### Saída do Set 0

- Branch `instagram` publicada e hash registrado.
- Requisitos Meta documentados sem secrets.
- Conta/Página de teste disponível.
- URLs públicas e secrets de ambiente preparados.
- Decisão registrada sobre OAuth de Página versus conexão administrativa por token protegido.

## Set 1 — fundação neutra de canal e identidade

### Banco

- Estender os constraints de `crm.instance_channels` para aceitar Messenger com provider compatível.
- Reutilizar `crm.lead_channel_identities` para a chave `(channel_id, provider_user_id)`; documentar `provider_user_id` como PSID no binding Messenger.
- Criar RPC transacional para localizar/criar lead por PSID, com tenant, canal e Página como escopo obrigatório.
- Preservar as regras atuais de criação manual de lead com telefone.
- Criar migration de preflight, grants, RLS e testes pgTAP de tenant, unicidade e concorrência.

### Contratos backend

- Adicionar `messenger` aos tipos neutros de canal, endereço e provider.
- Fazer o resolver rejeitar configurações incompatíveis antes de chamar qualquer provider.
- Generalizar o dispatcher somente onde os contratos forem realmente comuns; manter adapters separados para Instagram, Messenger, Meta WhatsApp, Evolution e Gupshup.
- Garantir que Messenger nunca caia por fallback no transporte Evolution.

### Saída do Set 1

- Messenger resolve por tenant + instância + canal.
- PSID concorrente cria um único lead e uma única identidade.
- Providers atuais passam a suíte de regressão sem alteração comportamental.

## Set 2 — schema operacional e credenciais

Criar schema backend-only `messenger` ou extensão equivalente isolada, conforme decisão de governança após validar o padrão do Instagram.

Estruturas previstas:

- `messenger.pages`: Página conectada, Page ID, nome, status, health, token expiration/refresh metadata quando aplicável.
- `messenger.page_credentials`: ciphertext, IV, auth tag e versão da chave.
- `messenger.oauth_states`: state/nonce, tenant, instância, expiração e consumo idempotente, se OAuth for usado.
- `messenger.webhook_events`: event key, payload normalizado, status, tentativas, lease e dead letter.
- `messenger.provider_status_events`: mudanças de conexão, erro e reconexão.
- `messenger.admin_audit_events`: refresh, reconexão, desativação e ações administrativas.

Regras:

- acesso direto de `anon` e `authenticated` revogado;
- tokens e payloads sensíveis fora dos logs;
- preflight bloqueia o bootstrap com migration incompleta;
- refresh, se aplicável ao token escolhido, terá lease, backoff, shutdown e alerta idempotente.

## Set 3 — conexão da Página e ciclo de vida

- Implementar endpoint autenticado para iniciar conexão.
- Validar state assinado, nonce, tenant, instância e replay.
- Trocar a autorização pelo token no backend e buscar somente metadados necessários da Página.
- Persistir token protegido e criar/atualizar binding em `crm.instance_channels`.
- Expor no frontend apenas status, nome da Página, saúde, expiração e erro sanitizado.
- Implementar reconexão, refresh manual com as mesmas regras do worker e desativação transacional.
- Auditar ações administrativas sem registrar token, authorization code ou payload completo.

Rotas previstas:

- `POST /api/messenger/connect/start`
- `GET /api/messenger/connect/callback`
- `GET /api/messenger/pages`
- `POST /api/messenger/pages/:pageId/refresh`
- `POST /api/messenger/pages/:pageId/disable`
- `GET /api/messenger/metrics`

## Set 4 — webhook e inbound

- Adicionar captura de raw body para `/api/webhook/messenger`.
- Implementar challenge GET e validação HMAC de `X-Hub-Signature-256`.
- Normalizar somente eventos suportados de mensagens recebidas.
- Identificar a Página pelo Page ID e o contato pelo PSID.
- Criar/localizar lead pela RPC de identidade sem telefone.
- Persistir evento e mensagem de forma idempotente em `messenger.webhook_events` e `crm.message_history`.
- Tratar echoes, eventos não suportados e payloads incompletos como `ignored` sem travar a fila.
- Implementar lease, retries, backoff e dead letter.
- Cobrir duplicação concorrente, assinatura inválida, tenant incorreto e falha permanente.

## Set 5 — outbound manual e política de conversa

- Criar `messenger-api-client.ts` com o endpoint e payloads confirmados na documentação Meta vigente.
- Enviar usando Page Access Token no backend e PSID como destinatário.
- Integrar ao dispatcher neutro sem alterar os adapters existentes.
- Criar política própria para Messenger: `freeform`, `closed` ou outro modo somente após validação do contrato vigente.
- Bloquear envio antes da Graph API quando a conversa estiver fora da política permitida.
- Persistir `provider_message_id` após sucesso e normalizar erros sem vazar payload Meta.
- Manter o MVP apenas com texto, salvo validação explícita de anexos.

## Set 6 — frontend e operação

### Chat

- Reutilizar `Chat.tsx`, `ChatHeader`, `MessageList`, `MessageBubble` e `ChatInput`.
- Exibir Messenger por ícone/texto já existente no padrão do app.
- Mostrar aviso operacional quando o envio estiver fechado; não expor API, token, worker ou detalhes técnicos ao atendente.
- Cobrir loading, erro de policy, disabled, reconexão, mensagem sem telefone e identidade PSID.

### Administração

- Adicionar card Messenger no fluxo de conexão de instâncias.
- Uma ação primária por estado: conectar ou reconectar.
- Exibir estados loading, conectando, ativo, atenção, reconexão necessária, desativado e erro.
- Usar tokens do design system Chat Query, foco visível, responsividade em 1280/1024/768/mobile e reduced motion.
- Nunca exibir Page Access Token, App Secret, encryption key ou authorization code.

## Set 7 — testes, staging e rollout

### Testes obrigatórios

- Migrations, grants, RLS, preflight e isolamento por tenant.
- Resolver/dispatcher com Messenger e regressão de todos os providers atuais.
- PSID concorrente e criação de lead sem telefone.
- OAuth state/replay, criptografia, redaction e ciclo de vida do token.
- Webhook raw body, challenge, assinatura, dedupe, retry e dead letter.
- Policy de envio e bloqueio antes da Graph API.
- Chat e painel em todos os estados e breakpoints.
- Teste real com Página de teste: conexão, inbound, resposta manual, erro, reconexão e desativação.
- QA visual no navegador e verificação de console.

### Ordem de rollout

1. Publicar a branch `instagram` e registrar o baseline.
2. Aplicar fundação Messenger em staging sem reset destrutivo.
3. Conectar uma Página piloto sem habilitar webhook/worker globalmente.
4. Habilitar inbound para uma única instância.
5. Habilitar outbound manual dentro da política validada.
6. Habilitar refresh/alertas e observar métricas e dead letters.
7. Expandir gradualmente após estabilidade e revisão de compliance.
8. Considerar IA, automação, mídia e campanhas somente em projeto pós-MVP separado.

### Flags mínimas

- `MESSENGER_CHANNEL_ENABLED`
- `MESSENGER_OUTBOUND_ENABLED`
- `MESSENGER_WEBHOOK_WORKER_ENABLED`
- `MESSENGER_TOKEN_REFRESH_WORKER_ENABLED`
- `MESSENGER_AUTOMATION_ENABLED` — permanece `false` no MVP.

## Rollback

- Desabilitar flags Messenger e parar workers com shutdown normal.
- Marcar apenas o binding Messenger como `disabled`.
- Preservar mensagens, identidades, credenciais e migrations.
- Não alterar bindings de Instagram ou WhatsApp do mesmo tenant.
- Manter o fallback proibido; erro de configuração deve ser explícito.
- Só remover ou invalidar credencial após ação administrativa auditada e reconexão controlada.

## Critério final de aceite

Uma Página piloto conecta sem SQL manual, cria/localiza um lead pelo PSID sem telefone, recebe mensagem no chat/fila, permite resposta humana dentro da política vigente, bloqueia envio fora da janela antes da Graph API, processa webhooks duplicados com idempotência, mantém credencial protegida, alerta falhas operacionais e pode ser desativada sem modificar Instagram, WhatsApp ou Gupshup.

## Referências oficiais a reconfirmar

- Messenger Platform: https://developers.facebook.com/docs/messenger-platform
- Webhooks: https://developers.facebook.com/docs/messenger-platform/webhooks
- Send API: https://developers.facebook.com/docs/messenger-platform/send-messages
- Page access tokens: https://developers.facebook.com/docs/messenger-platform/get-started/app-setup
- App Review: https://developers.facebook.com/docs/app-review

As versões, permissões, limites e políticas da Meta são voláteis. Nenhuma delas deve ser tratada como permanente sem nova confirmação antes da implementação e do piloto.
