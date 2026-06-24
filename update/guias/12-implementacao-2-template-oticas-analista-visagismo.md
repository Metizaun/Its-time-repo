# Implementacao 2 - Analista de Receituario e Visagismo

## 1. Objetivo

Completar as duas Tools especializadas do template **Consultor para Oticas**:

1. **Analista:** interpreta uma foto de receituario, estrutura os dados, identifica necessidades opticas operacionais e encontra o preco configurado para as lentes.
2. **Visagismo:** qualifica o lead, analisa sua imagem, recomenda uma armacao do catalogo e gera uma simulacao visual.

As duas Tools usam imagem como entrada, mas executam processos diferentes. Um worker de classificacao deve identificar o tipo do arquivo antes de escolher a Tool.

Esta implementacao segue o padrao de `09-padrao-workers-agentes-modelos.md`: o agente principal conversa com o lead; workers internos analisam imagem, escolhem produto e editam; cada worker declara modelo, entrada, saida, auditoria e idempotencia proprios.

## 2. Fundacao compartilhada de imagens

### 2.1 Persistencia de entrada

O backend atual ja salva imagens recebidas em `chat-attachments` e registra `crm.message_attachments`. Essa copia e a entrada canonica das Tools.

Nao passar base64 em Redis nem depender do payload original do webhook depois da persistencia.

Entrada minima:

```ts
type ImageToolInput = {
  acesId: number;
  agentId: string;
  leadId: string;
  messageId: string;
  attachmentId: string;
  toolRunId: string;
};
```

### 2.2 Classificacao

Criar um worker de classificacao com saida estruturada:

```ts
type ImageClassification = {
  kind: "prescription" | "face" | "product" | "document" | "other";
  evidence: string[];
};
```

Nao calcular nem expor score de confianca.

Roteamento:

- `prescription` e Tool Analista ativa: executar Analista;
- `face` e sessao de Visagismo ativa: executar Visagismo;
- `face` sem qualificacao: salvar foto e solicitar as perguntas ausentes;
- demais tipos: manter a descricao multimodal generica do agente;
- Tool desativada: nao executar silenciosamente.

O classificador nao diagnostica e nao precifica. Ele apenas define o tipo de documento.

### 2.3 Orquestracao

Fluxo comum:

1. receber e salvar mensagem;
2. salvar anexo;
3. criar `agent_tool_runs` com idempotencia por `(tool_key, attachment_id)`;
4. classificar imagem;
5. executar a Tool habilitada;
6. salvar resultado operacional no `crm`;
7. publicar fatos na `crm.bi_outbox`;
8. entregar resultado ao agente principal;
9. agente responde ao lead;
10. finalizar run e metricas.

## 3. Parte 1 - Tool Analista

### 3.1 Responsabilidade

A Tool Analista recebe uma imagem de receituario e devolve dados estruturados e uma cotacao de lente baseada exclusivamente nas regras cadastradas pela otica.

Ela nao deve:

- inventar preco;
- responder sobre upsell;
- conduzir a conversa;
- alterar o prompt ou personalidade do agente;
- afirmar um diagnostico medico alem do que pode ser derivado do documento;
- mostrar raciocinio interno.

### 3.2 Campos extraidos

Extrair, quando visiveis:

- nome do paciente;
- data da receita;
- validade escrita no documento;
- OD esferico;
- OD cilindrico;
- OD eixo;
- OE esferico;
- OE cilindrico;
- OE eixo;
- adicao;
- DP/DNP, quando presente;
- observacoes da receita;
- nome do prescritor e registro, quando presentes.

Normalizacao:

- esfera, cilindro e adicao: `numeric(5,2)`;
- eixo: inteiro entre 0 e 180;
- datas: `date`;
- valores `PL`, `Plano` ou equivalentes: `0.00`;
- campo ausente permanece `null`;
- nao calcular validade se o documento nao informar uma regra explicita.

### 3.3 Validacao minima

Uma leitura e considerada suficiente para precificar quando:

- pelo menos esfera ou cilindro esta legivel para OD e OE;
- eixo esta presente sempre que o cilindro exigir eixo;
- adicao esta legivel quando o documento indicar perto ou multifocal;
- os valores respeitam os tipos e limites estruturais.

Nao existe score de confianca.

Se a validacao minima falhar:

1. marcar run como `waiting_input`;
2. pedir uma nova foto, preferencialmente frontal, iluminada e sem cortes;
3. permitir uma nova tentativa;
4. depois da segunda leitura invalida, acionar Encaminhamento quando houver destino configurado.

Nenhum preco e enviado para uma leitura invalida.

### 3.4 Evolucao de `crm.receituarios`

A tabela ja existe e deve ser evoluida, nao substituida. Preservar:

- `od_longe`;
- `oe_longe`;
- `od_perto`;
- `oe_perto`;
- `tipo_lente`;
- `observacoes`;
- `metadados`;
- trigger que marca `crm.leads.receita = true`.

Adicionar campos tipados:

```text
source_message_id uuid
source_attachment_id uuid
agent_tool_run_id uuid
status text
od_sphere numeric(5,2)
od_cylinder numeric(5,2)
od_axis smallint
oe_sphere numeric(5,2)
oe_cylinder numeric(5,2)
oe_axis smallint
addition numeric(5,2)
distance_pd numeric(5,2)
near_pd numeric(5,2)
patient_name text
prescriber_name text
prescriber_registration text
prescription_date date
expires_at date
has_myopia boolean
has_hyperopia boolean
has_astigmatism boolean
has_presbyopia boolean
analysis_model text
analysis_version integer
raw_extraction jsonb
updated_at timestamptz
```

Constraints:

- eixo entre 0 e 180;
- `status` em `parsed`, `needs_new_image`, `failed`;
- unicidade de `source_attachment_id` quando nao nulo;
- JSON de extracao deve ser objeto;
- FKs indexadas;
- `aces_id` deve ser coerente com o lead e com o run.

Dados novos usam nomes lowercase em ingles para nao perpetuar identificadores acentuados ou mistos. Campos legados continuam por compatibilidade.

### 3.5 Classificacoes opticas armazenadas

Derivar flags operacionais:

- esfera negativa: indicio de miopia;
- esfera positiva: indicio de hipermetropia;
- cilindro diferente de zero: indicio de astigmatismo;
- adicao positiva: indicio de presbiopia/necessidade de perto.

Essas flags servem para atendimento, BI e selecao de lente. Na mensagem ao lead, evitar apresentar a inferencia como novo diagnostico medico; o agente deve se referir ao receituario enviado.

### 3.6 Regras de preco

Criar `crm.lens_price_rules`:

```text
id uuid
aces_id integer
agent_tool_id uuid
display_name text
lens_category text
min_sphere numeric(5,2)
max_sphere numeric(5,2)
max_abs_cylinder numeric(5,2)
min_addition numeric(5,2)
max_addition numeric(5,2)
price_cents bigint
currency text default 'BRL'
priority integer
is_active boolean
created_at timestamptz
updated_at timestamptz
```

Categorias iniciais:

- `single_vision`;
- `multifocal`.

Selecao de categoria:

- adicao positiva e receita para longe/perto: `multifocal`;
- sem adicao: `single_vision`.

Matching:

1. filtrar `aces_id`, Tool e regras ativas;
2. validar os dois olhos dentro dos limites assinados de esfera;
3. validar cilindro absoluto;
4. validar adicao quando aplicavel;
5. ordenar por `priority ASC`;
6. selecionar a primeira regra;
7. devolver o preco salvo em centavos.

A UI deve avisar sobre faixas sobrepostas. A prioridade resolve sobreposicao de forma deterministica.

Se os dados forem validos, mas nenhuma faixa estiver cadastrada, a Tool nao inventa valor. Ela pede nova foto uma vez conforme a regra definida e, persistindo a ausencia de correspondencia, usa Encaminhamento.

### 3.7 Contrato da Tool

```ts
type PrescriptionToolResult = {
  prescriptionId: string;
  status: "priced" | "needs_new_image" | "needs_human";
  lensCategory?: "single_vision" | "multifocal";
  priceCents?: number;
  currency?: "BRL";
  findings?: Array<"myopia" | "hyperopia" | "astigmatism" | "presbyopia">;
  expiresAt?: string | null;
};
```

O agente recebe somente esse resultado estruturado, nunca a resposta bruta do modelo.

### 3.8 Regra de upsell no agente principal

Depois de informar o preco:

1. verificar se `engagement.high_screen_time` ja existe;
2. se nao existir, perguntar uma unica vez se o lead passa muito tempo diante do computador;
3. salvar a resposta em `lead_tool_answers` e projetar no BI;
4. usar a resposta para oferecer tratamentos ou opcoes complementares;
5. nao alterar o preco base sem outra regra comercial configurada.

Esta instrucao pertence ao template/prompt do agente principal. Ela nao entra no prompt do worker Analista.

### 3.9 Projecao no schema BI

Publicar fatos:

```text
prescription.has_myopia
prescription.has_hyperopia
prescription.has_astigmatism
prescription.has_presbyopia
prescription.prescription_date
prescription.expires_at
lens.recommended_type
lens.quoted_price_cents
engagement.high_screen_time
```

O `source_record_id` aponta para `crm.receituarios.id`. Uma nova receita substitui os fatos atuais, mas preserva o historico com `superseded_at`.

O BI nao armazena a foto ou a extracao bruta.

### 3.10 Seguranca

Receituario e dado sensivel:

- escrita apenas pelo backend;
- revogar acesso direto de `anon` e `authenticated`;
- RLS por `aces_id`/lead como defesa adicional;
- service role nunca vai ao frontend;
- logs nao incluem imagem, base64 ou receita completa;
- foto segue a retencao do bucket de anexos;
- dados estruturados sao removidos em cascata quando o lead for excluido.

### 3.11 Metricas de sucesso

- 100% dos precos originados de `lens_price_rules`;
- zero preco inventado pelo modelo;
- acuracia de campo >= 95% em dataset rotulado;
- 100% dos receituarios validos persistidos;
- 100% das flags publicadas no BI de forma idempotente;
- foto invalida nunca recebe preco;
- zero acesso entre contas;
- zero pergunta de screen time repetida depois de respondida.

## 4. Parte 2 - Tool Visagismo

### 4.1 Fonte analisada

Fluxo de referencia:

[n8n - Visagismo - Dr. Óculos.json](../../referencias/n8n%20-%20Visagismo%20-%20Dr.%20%C3%93culos.json)

O arquivo real possui 31 nos e implementa:

1. entrada de numero, imagem, lead e conta;
2. armazenamento temporario da foto no Redis;
3. busca do lead;
4. leitura das duas respostas de qualificacao;
5. analise facial pelo Gemini;
6. leitura de todo o catalogo `image`;
7. matching por descricao com AI Agent;
8. retorno estruturado de um ID do Google Drive;
9. download da imagem escolhida;
10. edicao pelo `gemini-2.5-flash-image`;
11. envio direto pela Evolution;
12. exclusao da foto temporaria;
13. webhook separado para contabilizacao.

### 4.2 Comportamento que deve ser preservado

Perguntas:

1. `Como voce quer ser percebido pelas pessoas?`
2. `Quais valores ou caracteristicas melhor representam quem voce realmente e?`

Analise:

- caracteristicas do rosto;
- formato facial;
- cabelo;
- tom de pele;
- elementos visuais relevantes;
- percepcao desejada;
- valores informados pelo lead.

Selecao:

- cruzar o perfil com descricao das armacoes;
- escolher exatamente uma armacao;
- devolver um identificador valido;
- em nova solicitacao, evitar a ultima armacao quando houver alternativa.

Edicao:

- aplicar a armacao escolhida no rosto;
- substituir o oculos existente quando houver;
- nunca devolver a foto original sem edicao;
- preservar resolucao e cenario;
- nao criar elementos fora do oculos.

### 4.3 Qualificacao persistente

Usar `crm.lead_tool_answers` como fonte canonica generica:

```text
tool_key=visagism, question_key=desired_perception
tool_key=visagism, question_key=desired_feeling
```

Durante a transicao:

- backfill de `crm.leads.como_quer_ser_percebido`;
- backfill de `crm.leads.qual_imagem_passar`;
- manter espelhamento para o n8n legado;
- nao perguntar novamente quando a resposta atual existir;
- permitir atualizacao quando o lead disser que sua preferencia mudou.

### 4.4 Catalogo temporario

Enquanto a Biblioteca nao existir, manter cadastro manual com Google Drive.

Cada item precisa de:

- `aces_id`;
- produto/SKU;
- descricao de recomendacao;
- Google Drive file ID;
- URL de referencia;
- status ativo;
- tags opcionais;
- datas.

Nunca fazer `getAll` sem filtro. Carregar apenas itens ativos da conta e da Tool configurada.

### 4.5 Nova fronteira entre backend e n8n

O n8n continua como runtime inicial de analise e edicao, mas deixa de controlar identidade, envio e auditoria.

Responsabilidade do backend:

- autorizar conta, agente, lead e anexo;
- criar run;
- recuperar qualificacao;
- carregar catalogo filtrado;
- gerar URLs assinadas;
- chamar n8n;
- validar callback;
- salvar resultado;
- enviar pela abstracao WhatsApp;
- registrar mensagem, anexo, custo e BI.

Responsabilidade do n8n:

- analisar face;
- comparar descricoes;
- escolher um item da lista recebida;
- baixar a armacao autorizada;
- editar a imagem;
- devolver resultado estruturado.

O n8n nao deve:

- consultar catalogo irrestrito;
- decidir `aces_id`;
- enviar WhatsApp;
- escrever diretamente no historico;
- receber credencial por payload;
- usar telefone como chave de estado;
- contabilizar tokens em webhook separado.

### 4.6 Contrato backend -> n8n

```json
{
  "toolRunId": "uuid",
  "callbackUrl": "https://backend/internal/tool-runs/{id}/callback",
  "lead": {
    "id": "uuid",
    "desiredPerception": "texto",
    "desiredFeeling": "texto"
  },
  "sourceImage": {
    "url": "signed-url",
    "mimeType": "image/jpeg"
  },
  "catalog": [
    {
      "itemId": "uuid",
      "product": "SKU",
      "description": "texto",
      "driveFileId": "id"
    }
  ],
  "excludedItemIds": ["uuid"]
}
```

O payload nao inclui API keys, numero de telefone, nome da instancia ou service role.

### 4.7 Contrato n8n -> backend

```json
{
  "toolRunId": "uuid",
  "status": "succeeded",
  "selectedItemId": "uuid",
  "analysis": {
    "faceShape": "texto",
    "summary": "texto resumido"
  },
  "outputImage": {
    "contentType": "image/jpeg",
    "downloadUrl": "url-temporaria"
  },
  "usage": {
    "analysisModel": "modelo",
    "imageModel": "modelo",
    "inputTokens": 0,
    "outputTokens": 0
  }
}
```

Callback:

- autenticado por segredo rotacionavel e assinatura HMAC;
- rejeita run de outra conta;
- rejeita item fora do catalogo enviado;
- aceita repeticao idempotente;
- URL de resultado possui expiracao curta;
- backend baixa e valida bytes antes de salvar.

### 4.8 Estado, idempotencia e retries

Substituir Redis baseado em telefone por `agent_tool_runs.id`.

Estados:

```text
waiting_input -> queued -> running -> succeeded
                              \-> failed
```

Regras:

- um anexo nao inicia duas execucoes identicas;
- retry reutiliza run ou cria attempt associado;
- no maximo um retry automatico para falha transiente;
- falha permanente informa o agente principal;
- selecao anterior vem dos runs concluidos, nao da memoria informal do modelo;
- o output original nunca e enviado como se fosse editado.

### 4.9 Modelos dos workers

Configurar separadamente:

```text
VISAGISM_ANALYSIS_WORKER_MODEL=gemini-2.5-flash
VISAGISM_MATCHING_WORKER_MODEL=<modelo validado>
VISAGISM_IMAGE_WORKER_MODEL=gemini-2.5-flash-image
```

O valor de `agents.ai_agents.model` nao controla esses workers.

### 4.10 Entrega

1. backend baixa o resultado do callback;
2. valida formato e tamanho;
3. salva em `chat-attachments`;
4. envia pela instancia do agente via `sendMedia`;
5. salva mensagem outbound com `sender_agent_id`;
6. finaliza run;
7. publica eventos BI.

Legenda inicial:

> Aqui esta a armacao que mais combina com voce!

A legenda pode ser personalizada na Tool, sem alterar o workflow.

### 4.11 Projecao no schema BI

Fatos:

```text
visagism.desired_perception
visagism.desired_feeling
face.shape
visagism.selected_product_id
visagism.simulations_count
```

Eventos:

```text
visagism.started
visagism.waiting_input
visagism.product_selected
visagism.image_generated
visagism.sent
visagism.failed
```

Nao copiar foto, URL assinada ou analise facial integral para o BI. Guardar somente resumo categorizado e identificadores necessarios para metricas.

### 4.12 Metricas de sucesso

- 100% das armacoes pertencem ao catalogo da conta;
- zero `aces_id` ou instancia hardcoded;
- zero consulta irrestrita ao catalogo;
- zero envio direto pelo n8n;
- zero repeticao imediata quando houver alternativa;
- sucesso na primeira tentativa >= 90%;
- sucesso apos um retry >= 97%;
- 100% das imagens enviadas presentes no historico;
- 100% dos modelos e custos auditados;
- zero imagem original entregue como resultado editado.

## 5. BI e perfil atual do comprador

O worker de projecao deve manter `bi.lead_profiles` atualizado depois de Analista ou Visagismo.

Exemplo de perfil optico reconstruido a partir de fatos atuais:

```json
{
  "desiredPerception": "moderno e acessivel",
  "desiredFeeling": "confiante",
  "faceShape": "oval",
  "hasMyopia": true,
  "hasAstigmatism": true,
  "hasHyperopia": false,
  "hasPresbyopia": false,
  "prescriptionExpiresAt": "2027-06-01",
  "recommendedLensType": "single_vision",
  "quotedPriceCents": 39900,
  "highScreenTime": true
}
```

Esse JSON e apenas uma representacao de leitura. Os fatos permanecem tipados e versionados em `bi.lead_facts`.

Uma view backend-only futura, `bi.v_optical_lead_profiles`, pode pivotar os fatos atuais para relatorios. Ela nao deve ser exposta ao frontend nesta implementacao.

## 6. Testes obrigatorios

### Classificacao

- receituario;
- selfie;
- foto de armacao;
- documento nao optico;
- imagem ilegivel;
- Tool desativada.

### Analista

- receita simples;
- multifocal com adicao;
- `PL` normalizado para zero;
- cilindro com eixo ausente;
- foto cortada;
- duas receitas do mesmo lead;
- limites exatos de faixa;
- faixas sobrepostas por prioridade;
- nenhum preco compativel;
- retry e encaminhamento;
- persistencia e supersessao de fatos BI.

### Visagismo

- respostas existentes;
- uma e duas respostas ausentes;
- catalogo vazio;
- filtro por conta;
- repeticao com exclusao do item anterior;
- lead ja usando oculos;
- callback duplicado;
- callback adulterado;
- falha Gemini, Drive e n8n;
- output invalido;
- envio e historico.

### Seguranca

- duas contas com leads, catalogos e runs diferentes;
- acesso anon/auth a receituarios e BI negado;
- service role ausente no browser;
- logs sem base64, receita completa ou URL assinada duradoura.

## 7. Rollout

Feature flags:

```text
IMAGE_CLASSIFICATION_WORKER_ENABLED
PRESCRIPTION_ANALYST_ENABLED
VISAGISM_TOOL_ENABLED
VISAGISM_N8N_RUNTIME_ENABLED
BI_PROJECTION_WORKER_ENABLED
```

Ordem:

1. migrations compatíveis e backfills;
2. worker de classificacao em modo de observacao;
3. Analista em conta interna;
4. validacao com dataset rotulado;
5. Visagismo sem envio, apenas geracao;
6. envio em conta interna;
7. contas piloto;
8. liberacao gradual.
