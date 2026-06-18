# Sprint 5 - Integracoes Externas Meta e Gestao

## 1. Contexto

Sprint focada em dar autonomia operacional ao Admin para gerenciar canais/instancias Meta e evoluir a integracao com Facebook Graph API.

Tarefas de referencia:

- 5.1 Desenvolver interface Admin para gerenciamento de instancias.
- 5.2 Implementar fluxo assistido de criacao/ativacao Meta via Embedded Signup e Graph API.

## 2. Diagnostico do codigo atual

### O que ja existe

- `src/components/admin/InstanceManager.tsx` ja lista instancias, cria/reconecta via Evolution, gerencia cores, status, delete e canal Meta.
- `src/services/instanceService.ts` ja possui funcoes `listMetaChannels`, `upsertMetaChannel`, `syncMetaTemplates` e `listMetaTemplates`.
- `Project/IA/api-server.ts` expoe `/api/meta/channels`, `/api/meta/templates`, `/api/meta/templates/sync` e webhooks Meta.
- `Project/IA/meta-admin-service.ts` persiste canais Meta.
- `Project/IA/meta-template-service.ts` sincroniza templates em modo mock/live.
- `Project/IA/meta-webhook.ts` processa status/inbound Meta.
- `Project/IA/meta-whatsapp-provider.ts` implementa envio Meta de texto/template.
- `Project/IA/whatsapp-provider-registry.ts` resolve provider Evolution/Meta, mas ainda precisa ser integrado aos fluxos reais de envio se nao estiver em uso.
- Migration `20260521205000_add_meta_whatsapp_foundation.sql` cria schema `meta` e colunas provider.

### Lacunas

- Criacao real de numero/canal pela Meta depende do fluxo oficial de Embedded Signup, Business Manager, WABA, phone number e aprovacoes externas quando aplicavel.
- O provider registry nao aparece consumido pelos fluxos principais de envio.
- Interface atual configura canal, mas nao cobre fluxo guiado completo de criacao/ativacao dentro do ecossistema Meta.
- Segredos sao referenciados por nome de env (`accessTokenSecretRef`), mas a operacao precisa de convencao clara.

## 3. Arquivos provaveis

| Arquivo | Motivo | Risco |
|---|---|---|
| `src/components/admin/InstanceManager.tsx` | Evoluir UI Meta e fluxo guiado | Alto |
| `src/services/instanceService.ts` | Novos endpoints/contratos Admin Meta | Medio |
| `Project/IA/api-server.ts` | Endpoints para ativacao/criacao e validacoes | Alto |
| `Project/IA/meta-admin-service.ts` | Logica de configuracao Meta | Alto |
| `Project/IA/meta-whatsapp-provider.ts` | Envio live e erros Graph API | Alto |
| `Project/IA/whatsapp-provider-registry.ts` | Integrar escolha de provider | Alto |
| `Project/IA/schema-preflight.ts` | Garantir schema `meta` pronto | Medio |
| `supabase/migrations/*` | Ajustes em schema `meta`, se necessario | Alto |

## 4. Proposta tecnica

### Escopo realista v1

- Evoluir de "configurar canal" para "assistente de ativacao".
- O Admin deve conseguir:
  - selecionar instancia existente;
  - iniciar fluxo assistido Meta/Embedded Signup quando disponivel;
  - informar ou confirmar WABA ID, Phone Number ID, Business ID e refs de segredo;
  - testar configuracao em modo mock/live;
  - sincronizar templates;
  - visualizar status e ultima sincronizacao;
  - alternar provider da instancia quando canal estiver ativo.

### Criacao assistida pela Meta

- Nao tratar a criacao como provisionamento automatico total. O modelo esperado e semelhante ao de BSPs como Gupshup: a plataforma orquestra o onboarding, mas etapas criticas acontecem dentro do Embedded Signup/Business Manager da Meta.
- Antes de codar qualquer criacao real, mapear permissoes Graph API, app review, tipo de conta e ativos disponiveis para o app Meta.
- Se a API/conta nao permitir criar ativos automaticamente, o v1 deve tratar como criacao/ativacao assistida e validacao operacional.
- Apos o numero ser criado/registrado no WABA, o envio deve ocorrer pela WhatsApp Cloud API usando o `phone_number_id` autorizado. A Business Manager sustenta ownership/permissoes, mas nao e o sender direto.
- Capturar e persistir os identificadores retornados/autorizados pelo fluxo:
  - `business_id`: Business Manager do cliente;
  - `waba_id`: WhatsApp Business Account autorizada;
  - `phone_number_id`: numero usado como remetente na Cloud API;
  - `accessTokenSecretRef`: referencia segura para o token/permissao.
- Separar claramente:
  - `draft`: dados cadastrados, sem envio;
  - `pending_meta`: aguardando conclusao/verificacao no fluxo Meta;
  - `active`: canal valido, numero registrado e provider pode enviar pela Cloud API;
  - `error`: falha de validacao/sync;
  - `disabled`: canal pausado.

### Provider

- Integrar `WhatsAppProviderRegistry` nos caminhos de envio manual, automacao e IA.
- Persistir provider/resultados em `message_history.provider`, `provider_message_id`, `provider_status`.
- Tratar erros Meta com payload resumido, sem vazar token.

## 5. Ordem de execucao

1. Mapear permissao real da conta/app Meta, Embedded Signup, app review e ativos disponiveis.
2. Definir contrato do assistente: inicio do onboarding, retorno/callback, captura de `business_id`, `waba_id` e `phone_number_id`.
3. Atualizar documentacao/envs de segredos Meta.
4. Criar endpoints de validacao/teste de canal Meta.
5. Integrar provider registry no envio manual primeiro.
6. Integrar provider registry em automacoes e IA.
7. Evoluir UI do `InstanceManager` para fluxo guiado.
8. Validar webhook Meta inbound/status com fixtures e ambiente real quando disponivel.

## 6. Criterios de aceite

- Admin visualiza canais Meta por instancia.
- Admin inicia ou conclui fluxo assistido de criacao/ativacao Meta quando a conta/app permitir.
- Admin cadastra/edita dados de canal Meta sem expor tokens.
- Admin sincroniza templates e ve resultado.
- Instancia ativa com provider Meta envia mensagem pela WhatsApp Cloud API usando o `phone_number_id` autorizado.
- Instancia sem canal ativo continua usando Evolution.
- Erros Graph API aparecem com mensagem operacional e log backend seguro.
- Webhook Meta registra status/inbound sem duplicidade.

## 7. Riscos e mitigacoes

| Risco | Probabilidade | Mitigacao |
|---|---|---|
| Meta nao permitir criacao automatica total | Alta | Implementar criacao/ativacao assistida via Embedded Signup e validar permissao antes |
| Embedded Signup retornar ativos incompletos ou pendentes | Media | Manter status `pending_meta` e permitir completar dados manualmente |
| Token vazar no frontend/log | Media | Usar secret refs e mascarar logs |
| Provider registry nao cobrir todos envios | Alta | Integrar envio manual primeiro, depois automacao/IA |
| Rate limit Graph API | Media | Retries com backoff e classificacao de erro |
| Webhook duplicar mensagens/status | Media | Usar `provider_message_id` e indices existentes |

## 8. Testes

- `npm --prefix Project/IA run build`
- `npm --prefix Project/IA run schema:check`
- Testar modo mock Meta com fixtures.
- Testar listagem/salvamento de canal no Admin.
- Testar fallback Evolution quando Meta nao esta ativo.
- Testar fluxo assistido com retorno/captura de Business ID, WABA ID e Phone Number ID quando ambiente Meta estiver disponivel.
- Testar envio texto Meta em modo live apenas com credenciais validas e numero registrado na Cloud API.
- Testar webhook status enviado/entregue/lido/falhou.

## 9. Pontos de atencao

- Nao assumir que a Graph API cria tudo automaticamente; confirmar permissao real, app review e disponibilidade do Embedded Signup.
- Nao vender "disparo pela BM" como sender tecnico. O sender real e o `phone_number_id` registrado no WABA e usado via WhatsApp Cloud API.
- Nao salvar token diretamente no banco quando o padrao for `secretRef`.
- Nao remover fluxo Evolution; Meta deve conviver como provider alternativo.

