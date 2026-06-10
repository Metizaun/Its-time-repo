# Sprint 5 - Integracoes Externas Meta e Gestao

## 1. Contexto

Sprint focada em dar autonomia operacional ao Admin para gerenciar canais/instancias Meta e evoluir a integracao com Facebook Graph API.

Tarefas de referencia:

- 5.1 Desenvolver interface Admin para gerenciamento de instancias.
- 5.2 Implementar integracao para criacao automatizada de instancias pela API da Meta.

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

- Criacao real de numero/canal pela Meta pode depender de Business Manager, WABA, phone number e aprovacao externa.
- O provider registry nao aparece consumido pelos fluxos principais de envio.
- Interface atual configura canal, mas nao cobre fluxo guiado completo de criacao/ativacao.
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
  - informar WABA ID, Phone Number ID, Business ID e refs de segredo;
  - testar configuracao em modo mock/live;
  - sincronizar templates;
  - visualizar status e ultima sincronizacao;
  - alternar provider da instancia quando canal estiver ativo.

### Criacao automatizada pela Meta

- Antes de codar criacao real, mapear a permissao Graph API disponivel.
- Se a API/conta nao permitir criar ativos automaticamente, o v1 deve tratar como cadastro assistido e validacao operacional.
- Separar claramente:
  - `draft`: dados cadastrados, sem envio;
  - `active`: canal valido e provider pode enviar;
  - `error`: falha de validacao/sync;
  - `disabled`: canal pausado.

### Provider

- Integrar `WhatsAppProviderRegistry` nos caminhos de envio manual, automacao e IA.
- Persistir provider/resultados em `message_history.provider`, `provider_message_id`, `provider_status`.
- Tratar erros Meta com payload resumido, sem vazar token.

## 5. Ordem de execucao

1. Mapear permissao real da conta/app Meta e decidir se v1 sera criacao automatica ou ativacao assistida.
2. Atualizar documentacao/envs de segredos Meta.
3. Criar endpoints de validacao/teste de canal Meta.
4. Integrar provider registry no envio manual primeiro.
5. Integrar provider registry em automacoes e IA.
6. Evoluir UI do `InstanceManager` para fluxo guiado.
7. Validar webhook Meta inbound/status com fixtures e ambiente real quando disponivel.

## 6. Criterios de aceite

- Admin visualiza canais Meta por instancia.
- Admin cadastra/edita dados de canal Meta sem expor tokens.
- Admin sincroniza templates e ve resultado.
- Instancia ativa com provider Meta envia mensagem por Meta quando configurada.
- Instancia sem canal ativo continua usando Evolution.
- Erros Graph API aparecem com mensagem operacional e log backend seguro.
- Webhook Meta registra status/inbound sem duplicidade.

## 7. Riscos e mitigacoes

| Risco | Probabilidade | Mitigacao |
|---|---|---|
| Meta nao permitir criacao automatica total | Alta | Implementar ativacao assistida e validar permissao antes |
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
- Testar envio texto Meta em modo live apenas com credenciais validas.
- Testar webhook status enviado/entregue/lido/falhou.

## 9. Pontos de atencao

- Nao assumir que a Graph API cria tudo automaticamente; confirmar permissao real.
- Nao salvar token diretamente no banco quando o padrao for `secretRef`.
- Nao remover fluxo Evolution; Meta deve conviver como provider alternativo.

