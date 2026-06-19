# Padrao de Separacao entre Agentes e Workers de IA

## 1. Contexto

Este guia fixa a regra arquitetural para separar agentes de atendimento de workers internos de IA.

O problema que este padrao evita: um agente visivel para o cliente, como Sarah, herdar o modelo usado por um worker interno de analise. Agente e worker podem usar IA, mas nao representam a mesma responsabilidade operacional.

## 2. Regra central

- `crm.ai_agents.model` representa o modelo do agente que responde ao lead.
- Workers internos devem ter modelo proprio, definido por constante e, quando necessario, por variavel de ambiente.
- O frontend de Agentes deve exibir apenas configuracoes do agente de atendimento, nao configuracoes internas de workers.

Modelos padrao:

- `DEFAULT_CUSTOMER_AGENT_MODEL = "gemini-2.5-flash"`
- `DEFAULT_CRM_ANALYSIS_WORKER_MODEL = "gemini-3.1-flash-lite"`

Exemplo aplicado:

- Sarah e agente de atendimento: responde ao lead usando `gemini-2.5-flash`.
- Worker de analise de conversa e servico interno: analisa conversa/CRM usando `gemini-3.1-flash-lite`.

## 3. Contrato para novos workers

Todo novo worker deve declarar explicitamente:

- `name`: nome unico e estavel do worker.
- `purpose`: tarefa operacional unica.
- `enabled`: flag de ativacao, no formato `*_WORKER_ENABLED`.
- `model`: modelo proprio do worker, no formato `*_WORKER_MODEL` quando houver override por ambiente.
- `input`: origem dos dados processados.
- `output`: alteracoes ou eventos produzidos.
- `audit`: onde registrar decisao, modelo usado, erro e snapshot resumido.
- `idempotency`: chave ou regra para evitar processamento duplicado.

Checklist minimo:

- Definir funcao unica do worker.
- Separar entrada operacional de mensagem enviada ao cliente.
- Declarar modelo do worker sem depender de `crm.ai_agents.model`.
- Auditar o modelo usado em logs, runs ou tabela de jobs.
- Registrar falhas transientes e permanentes com contexto suficiente.
- Seguir o padrao de retries, locks e idempotencia do worker atual.

## 4. O que e proibido

- Reutilizar `crm.ai_agents.model` para analise interna de CRM.
- Mostrar worker interno no frontend como se fosse agente de atendimento.
- Misturar resposta ao lead e decisao operacional na mesma configuracao.
- Criar worker generico sem nome, tarefa, modelo e auditoria explicitos.
- Trocar modelo global de agentes para atender uma necessidade de worker.
- Fazer um worker enviar mensagem ao cliente sem trilha de origem e idempotencia.

## 5. Relacao com guias existentes

- Sprint 6 (`06-sprint-automacoes-crm-workers.md`) continua sendo a base operacional para workers, retries, health, auditoria e idempotencia.
- Sprint 8 (`08-sprint-ia-avancada-cobranca-rb.md`) deve seguir este padrao para workers especializados, como visagismo, cobranca e integracoes RB.

## 6. Criterios de aceite para futuras implementacoes

- Agentes de atendimento existentes e novos usam `gemini-2.5-flash` por padrao.
- Workers internos usam seus proprios modelos e nao alteram o default dos agentes.
- Runs/logs deixam claro qual modelo foi usado para resposta ao lead e qual modelo foi usado para analise interna.
- O frontend nao induz o usuario a acreditar que o modelo do worker e o modelo do agente.
- Toda nova feature de IA indica se e agente, worker ou ambos.

## 7. Pontos de atencao

- Quando uma feature precisar responder ao lead e tambem atualizar CRM, trate como dois papeis: geracao de resposta e analise operacional.
- Se houver uma unica chamada de modelo por limitacao tecnica temporaria, documentar o risco e abrir tarefa para separar as chamadas.
- Alteracoes de default em `crm.ai_agents.model` devem ser revisadas como mudanca de comportamento do agente de atendimento.
- Alteracoes de modelos de worker devem ser feitas em constantes/envs especificas do worker.
