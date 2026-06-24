# Implementacao 1 - Template para Oticas e Tools Basicas

> Prioridade atual: executar apenas backend, banco e configuracao operacional conforme
> [Guia 14 — Entrega urgente do backend](../Finalizados/14-tarefa-urgente-backend-template-oticas.md).
> Template Picker, Tool Rail e paineis de configuracao permanecem ocultos ate a etapa frontend.

## 1. Objetivo

Entregar a fundacao de Templates e Tools e disponibilizar as tres primeiras capacidades do template **Consultor para Oticas**:

1. Audio IA;
2. Encaminhamento;
3. Enviar midia.

Esta implementacao tambem cria a fundacao do schema `bi`, responsavel por armazenar fatos analiticos e versionados sobre os leads e o uso das Tools.

Ficam fora desta etapa:

- leitura de receituario;
- precificacao de lentes;
- execucao do visagismo;
- tela de Biblioteca/Storage;
- dashboards de BI no frontend.

## 2. Arquitetura de Templates e Tools

### 2.1 Registro de Tools

Criar um registro de Tools nativas. A V1 nao permite que o usuario escreva codigo ou crie uma Tool arbitraria.

Chaves iniciais:

```ts
type ToolKey =
  | "ai_audio"
  | "forwarding"
  | "send_media"
  | "prescription_analyst"
  | "visagism";
```

O dominio de agentes possui schema proprio. Configuracoes, templates, Tools e
execucoes de agentes nao devem ser criados no schema `crm`.

Tabelas no schema `agents`:

| Tabela | Responsabilidade |
|---|---|
| `tool_definitions` | Catalogo global, versao, nome e schema de configuracao das Tools. |
| `agent_templates` | Templates globais versionados. |
| `agent_template_tools` | Tools e configuracoes padrao de cada template. |
| `agent_tools` | Tool instalada em um agente, configuracao, prontidao e ativacao. |
| `agent_tool_runs` | Execucoes, retries, erros, modelos, custo e auditoria. |

O schema `agents` tambem passa a ser o owner das tabelas existentes
`ai_agents`, `ai_stage_rules`, `ai_lead_state` e `ai_runs`.

Dados cujo sujeito e o lead permanecem no schema `crm`:

| Tabela | Responsabilidade |
|---|---|
| `lead_tool_answers` | Respostas de qualificacao reutilizaveis por lead e Tool. |
| `lead_instance_memberships` | Instancias adicionais autorizadas para um lead. |
| `bi_outbox` | Entrega transacional de eventos operacionais para o schema `bi`. |

Estados de prontidao:

```text
ready | needs_config | unavailable
```

Estados de execucao:

```text
queued | running | waiting_input | succeeded | failed | cancelled
```

Regras:

- `agent_tools` tem unicidade por `(agent_id, tool_key)`;
- toda tabela multi-tenant possui `aces_id` e RLS;
- toda FK usada em joins possui indice;
- runs pendentes usam indice parcial;
- retries usam a mesma `idempotency_key`;
- chamadas externas nao ficam dentro de transacoes longas;
- configuracao usa JSONB somente para campos variaveis; identificadores, estado e datas permanecem em colunas tipadas.

### 2.2 Template Consultor para Oticas

O template instala as cinco Tools, mas somente ativa as que estiverem prontas.

Configuracao inicial:

| Tool | Estado inicial |
|---|---|
| Audio IA | `ready` quando ElevenLabs e voz padrao estiverem validas. |
| Encaminhamento | `needs_config` ate existir ao menos um destino. |
| Enviar midia | `needs_config` ate existir ao menos um arquivo valido. |
| Analista | `needs_config` ate existir tabela de precos. |
| Visagismo | `needs_config` ate catalogo e workflow estarem validados. |

Selecionar um template cria uma copia editavel e registra `template_key` e `template_version` no agente. Nao existe sincronizacao automatica posterior.

### 2.3 Criacao pelo backend

A criacao do agente com template deve ocorrer pelo backend em uma unica transacao curta:

1. validar conta, usuario e instancia;
2. criar `agents.ai_agents`;
3. copiar os bindings do template para `agents.agent_tools`;
4. registrar evento de criacao;
5. confirmar a transacao.

O frontend deixa de fazer insert direto quando `templateKey` for utilizado.

APIs publicas:

```text
GET   /api/agent-templates
POST  /api/agents
GET   /api/agents/:agentId/tools
PATCH /api/agents/:agentId/tools/:toolKey
POST  /api/agents/:agentId/tools/:toolKey/test
```

Contrato resumido de criacao:

```json
{
  "name": "Ana - Otica Central",
  "instanceName": "otica-central",
  "systemPrompt": "...",
  "templateKey": "optics-consultant"
}
```

## 3. Schema BI para conhecimento do lead

### 3.1 Principio

O schema `crm` continua sendo a fonte operacional. O schema `bi` nao substitui `crm.leads`, `crm.receituarios`, mensagens ou runs.

O `bi` recebe:

- fatos versionados sobre o comprador;
- snapshot analitico atual do lead;
- eventos de uso das Tools;
- medidas de desempenho e conversao.

O `bi` nao recebe:

- foto original do lead;
- imagem de receituario;
- audio gerado;
- conversa completa;
- credenciais;
- prompt integral do agente.

### 3.2 Seguranca

Criar o schema com acesso privado:

- revogar `ALL` de `PUBLIC`, `anon` e `authenticated`;
- conceder apenas o necessario a `service_role`;
- nao incluir `bi` nos schemas expostos pelo Data API nesta fase;
- habilitar RLS como defesa adicional nas tabelas com `aces_id`;
- usar somente `app_metadata`/contexto CRM confiavel em autorizacao;
- nenhuma consulta do frontend acessa `bi` diretamente.

Dashboards futuros devem consumir endpoints agregados do backend ou views controladas. Se uma view for exposta, deve usar `security_invoker = true` no Postgres 15+.

### 3.3 Modelo de dados

#### `bi.lead_profiles`

Um snapshot por lead:

- `lead_id uuid`;
- `aces_id integer`;
- `primary_instance_name text`;
- `profile_version integer`;
- `first_interaction_at timestamptz`;
- `last_interaction_at timestamptz`;
- `last_tool_key text`;
- `created_at timestamptz`;
- `updated_at timestamptz`.

Chave primaria: `(aces_id, lead_id)`.

#### `bi.lead_facts`

Armazena fatos genericos e versionados:

- `id uuid`;
- `aces_id integer`;
- `lead_id uuid`;
- `namespace text`;
- `fact_key text`;
- `value_type text`;
- exatamente um entre `value_text`, `value_numeric`, `value_boolean`, `value_date` ou `value_json`;
- `source_tool_key text`;
- `source_record_id uuid`;
- `observed_at timestamptz`;
- `valid_until timestamptz`;
- `superseded_at timestamptz`;
- `created_at timestamptz`.

Usar constraint para validar o tipo do valor e indice unico parcial para permitir somente um fato atual por `(aces_id, lead_id, namespace, fact_key)` quando `superseded_at IS NULL`.

Chaves iniciais:

```text
visagism.desired_perception
visagism.desired_feeling
face.shape
prescription.has_myopia
prescription.has_hyperopia
prescription.has_astigmatism
prescription.has_presbyopia
prescription.expires_at
lens.recommended_type
lens.quoted_price_cents
engagement.high_screen_time
```

#### `bi.tool_events`

Uma linha por evento relevante:

- `event_id uuid`;
- `aces_id integer`;
- `lead_id uuid`;
- `agent_id uuid`;
- `tool_run_id uuid`;
- `tool_key text`;
- `event_name text`;
- `status text`;
- `duration_ms integer`;
- `cost_amount numeric(12,6)`;
- `metrics jsonb`;
- `occurred_at timestamptz`.

`event_id` e `tool_run_id + event_name` devem impedir duplicidade.

### 3.4 Alimentacao por outbox

Criar `crm.bi_outbox` para nao acoplar a resposta do agente a uma escrita analitica:

1. a operacao CRM termina e grava um evento na outbox na mesma transacao curta;
2. um worker reivindica eventos pendentes em lote;
3. faz UPSERT idempotente em `bi`;
4. marca o evento como processado;
5. falhas recebem retry e erro auditavel.

O worker nunca segura lock enquanto chama ElevenLabs, Evolution, Gemini, Google Drive ou n8n.

## 4. Tool Audio IA

### 4.1 Regra de humanizacao

O calculo acontece uma vez por resposta completa, antes do envio:

```text
hash(ai_run_id + agent_id + lead_id) mod 10000 < 180
```

Isso produz selecao estavel de 1,8% e impede mudanca de formato durante retry.

Resposta elegivel:

- origem `ai`;
- apenas texto conversacional;
- entre 20 e 800 caracteres apos unir os blocos;
- sem URL, codigo de verificacao ou payload tecnico;
- sem anexo obrigatorio na mesma resposta.

Quando selecionada, todos os blocos sao unidos em um unico audio. Nao enviar texto e audio juntos.

### 4.2 ElevenLabs

Configuracao backend:

```text
ELEVENLABS_API_KEY
ELEVENLABS_TTS_MODEL=eleven_flash_v2_5
ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128
```

A chave e da plataforma e nunca aparece no frontend. O binding do agente guarda apenas `voice_id` e configuracoes permitidas.

Fluxo:

1. decidir audio ou texto;
2. gerar TTS;
3. salvar o MP3 em `chat-attachments`;
4. gerar URL assinada;
5. enviar como voice note pela Evolution;
6. salvar mensagem e anexo;
7. registrar run e evento BI.

Adicionar `sendVoiceNote` ao contrato de WhatsApp. Para Evolution, usar `/message/sendWhatsAppAudio/{instance}` com `encoding=true`. Nao usar o envio generico de arquivo de audio.

Se TTS ou envio falhar, enviar o texto original e registrar `fallback_to_text`. O retry nunca pode enviar os dois formatos.

### 4.3 Metricas

- taxa selecionada: `1,8% +/- 0,3 ponto percentual` apos 10 mil respostas elegiveis;
- zero duplicidade texto/audio;
- sucesso de entrega >= 98%;
- fallback para texto em 100% das falhas;
- TTS p95 <= 4 segundos;
- envio completo p95 <= 8 segundos;
- caracteres e custo por conta e agente.

## 5. Tool Encaminhamento

### 5.1 Modos

#### Notificar destino

Usado para loja, clinica ou parceiro externo:

1. identificar o destino configurado;
2. solicitar autorizacao para compartilhar dados quando necessario;
3. enviar nome, telefone, resumo e motivo;
4. registrar notificacao;
5. o agente original decide naturalmente se continua ou encerra a conversa.

#### Encaminhar para outra IA

A IA de destino possui sua propria instancia e inicia uma nova conversa com o mesmo lead. As duas IAs podem continuar conversando, cada uma pelo seu numero.

Para respeitar que um lead pertence originalmente a uma instancia:

- manter `crm.leads.instancia` como instancia primaria;
- criar `crm.lead_instance_memberships` para instancias adicionais autorizadas;
- rotear cada inbound somente pelo agente da instancia que recebeu a mensagem;
- manter `agents.ai_lead_state` separado por agente;
- adicionar `sender_agent_id` em `crm.message_history`;
- entregar a IA de destino um snapshot do contexto da transferencia, nao todo o historico irrestrito.

Tabelas:

- `agents.forwarding_destinations`;
- `crm.lead_instance_memberships`;
- `agents.agent_transfer_sessions`.

V1 permite `target_agent_id` apenas dentro do mesmo `aces_id`. Destinos externos continuam pelo modo WhatsApp.

Protecoes:

- idempotencia por mensagem de origem e destino;
- uma transferencia ativa por par lead/destino;
- cooldown contra ping-pong;
- proibicao de transferir automaticamente de volta durante a mesma sessao;
- isolamento por conta;
- owner original do lead nao e trocado silenciosamente.

### 5.2 Migracao do handoff atual

Os campos `handoff_enabled`, `handoff_prompt` e `handoff_target_phone` permanecem durante uma janela de compatibilidade.

Backfill:

1. criar binding `forwarding` para agentes com handoff configurado;
2. criar um destino WhatsApp equivalente;
3. fazer o runtime preferir a nova Tool;
4. manter leitura legada durante o rollout;
5. remover os campos apenas em uma migracao futura dedicada.

### 5.3 Metricas

- 100% dos encaminhamentos auditados;
- zero transferencia duplicada;
- zero loop automatico;
- entrega externa >= 99%;
- primeira mensagem da IA de destino em ate 30 segundos no p95;
- destino correto em 100% dos testes de roteamento.

## 6. Tool Enviar midia

### 6.1 Cadastro inicial

Antes da Biblioteca, cadastrar ativos por link:

- Google Drive com acesso por link;
- URL HTTPS permitida.

Tabela `agents.tool_media_assets`:

- `id`;
- `aces_id`;
- `agent_tool_id`;
- `asset_key`;
- `display_name`;
- `description`;
- `usage_instruction`;
- `source_type`;
- `source_url`;
- `media_kind`;
- `mime_type`;
- `file_name`;
- `default_caption`;
- `is_active`;
- datas.

Unicidade: `(agent_tool_id, asset_key)`.

### 6.2 Seguranca

- aceitar somente HTTPS;
- resolver e bloquear IP privado, loopback e metadata endpoints;
- validar redirects;
- allowlist inicial para Google Drive e hosts aprovados;
- validar MIME pelos bytes, nao apenas pelo header;
- limitar aos tipos JPEG, PNG, WebP e PDF;
- respeitar limite de 100 MB da infraestrutura atual;
- nunca permitir que o modelo forneca uma URL arbitraria.

### 6.3 Execucao

O agente escolhe apenas `asset_key` entre os itens habilitados.

Fluxo:

1. carregar ativo pelo binding e conta;
2. baixar no backend;
3. validar novamente tipo e tamanho;
4. copiar para o caminho da mensagem em `chat-attachments`;
5. gerar URL assinada;
6. enviar via `sendMedia`;
7. persistir mensagem, anexo, run e evento BI.

Falha de download ou validacao nao envia um substituto. O agente recebe resultado estruturado para explicar que o material esta temporariamente indisponivel.

### 6.4 Metricas

- entrega >= 99%;
- zero ativo de outra conta;
- zero URL arbitraria enviada pela IA;
- 100% das midias presentes no historico;
- zero duplicidade em retry;
- selecao correta do ativo nos cenarios de homologacao.

## 7. Observabilidade e rollout

Feature flags:

```text
AGENT_TEMPLATES_ENABLED
AGENT_TOOL_ROUTER_ENABLED
ELEVENLABS_TTS_ENABLED
FORWARDING_TOOL_ENABLED
SEND_MEDIA_TOOL_ENABLED
BI_PROJECTION_WORKER_ENABLED
```

Rollout:

1. migrations e backfills;
2. registry e APIs com flags desligadas;
3. frontend de Templates e Tool Rail;
4. conta interna de homologacao;
5. contas piloto;
6. validacao das metricas;
7. liberacao gradual.

## 8. Testes e criterios de aceite

### Banco e seguranca

- RLS entre duas contas;
- grants explicitos;
- FK indexadas;
- UPSERT concorrente de fatos BI;
- outbox idempotente;
- backfill de instancia primaria;
- acesso anon/auth ao schema `bi` negado.

### Template

- criar em branco;
- criar por template;
- Tools incompletas permanecem desativadas;
- alteracao do template nao muda agente criado;
- falha no clone faz rollback completo.

### Audio

- amostragem deterministica;
- mesmo run escolhe sempre o mesmo formato;
- resposta com URL nao vira audio;
- falha ElevenLabs cai para texto;
- falha Evolution cai para texto sem duplicar;
- audio aparece no historico.

### Encaminhamento

- notificacao externa;
- transferencia para IA da mesma conta;
- duas instancias conversam sem colisao;
- owner original preservado;
- loop e duplicidade bloqueados.

### Midia

- imagem e PDF validos;
- link do Drive sem permissao;
- MIME falso;
- redirect para IP privado;
- ativo desativado;
- retry idempotente;
- anexo salvo no chat.
