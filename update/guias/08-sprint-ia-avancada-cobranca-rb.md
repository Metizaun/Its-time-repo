# Sprint 8 - IA Avancada, Visagismo e Cobranca RB

## 1. Contexto

Sprint focada em recursos avancados de IA: worker de visagismo, agente de cobranca e integracao final com RB. Esta sprint depende da Sprint 7 para memoria/subfases e contrato RB.

Tarefas de referencia:

- 8.1 Desenvolver e ativar worker de visagismo.
- 8.2 Construir logica operacional e prompt do agente de cobranca.
- 8.3 Integrar agente de cobranca com RB para automacao financeira.

## 2. Diagnostico do codigo atual

### O que ja existe

- Backend ja usa OpenAI para transcricao/visao de midias recebidas em `sdr-agent-gemini.ts`.
- Agentes ja possuem prompt, handoff, runs e freeze.
- Automacoes ja possuem worker e envio WhatsApp.
- Billing existe no schema publico, mas parece ligado a uso/plano da plataforma, nao a cobranca de clientes finais.
- Nao ha modulo RB implementado.
- Nao ha worker dedicado de visagismo.
- Nao ha agente de cobranca separado por dominio.

### Lacunas

- Contrato do que e "visagismo" no produto precisa estar definido.
- Nao ha fluxo de entrada para fotos/documentos especificos de visagismo.
- Nao ha politica de consentimento/retencao para imagem sensivel.
- Agente de cobranca precisa de tom, limites legais/operacionais e handoff.
- RB precisa estar mapeado e testado em modo mock antes do live.

## 3. Arquivos provaveis

| Arquivo | Motivo | Risco |
|---|---|---|
| Novo `Project/IA/visagism-worker.ts` | Worker dedicado de processamento visual | Alto |
| Novo `Project/IA/rb-client.ts` | Cliente RB com mock/live | Alto |
| `Project/IA/api-server.ts` | Endpoints de worker, cobranca ou webhooks RB | Alto |
| `Project/IA/sdr-agent-gemini.ts` | Reuso de IA, handoff e envio | Alto |
| `Project/IA/automation-worker.ts` | Possivel reuso de padrao worker/retries | Medio |
| `src/pages/Agentes.tsx` | Configuracao/visualizacao de agente de cobranca | Medio |
| `src/components/modals/AgentConfigModal.tsx` | Campos especificos se ficarem no mesmo modal | Medio |
| `supabase/migrations/*` | Tabelas de jobs, resultados e RB events | Alto |

## 4. Proposta tecnica

### Worker de visagismo

- Criar worker separado do agente SDR para nao misturar responsabilidades.
- Entrada recomendada:
  - `lead_id`;
  - `message_id` ou `attachment_id`;
  - `image_storage_path`;
  - `aces_id`;
  - `requested_by`;
  - status do job.
- Saida recomendada:
  - resumo;
  - recomendacoes;
  - modelo usado;
  - custos/tokens quando aplicavel;
  - snapshot de entrada sem armazenar imagem duplicada.
- Usar bucket privado e signed URLs.
- Implementar consentimento/retencao antes de ativar em producao.

### Agente de cobranca

- Nao deve ser apenas outro prompt generico.
- Criar perfil operacional especifico:
  - tom respeitoso;
  - sem ameacas;
  - regras de horario;
  - limite de tentativas;
  - escalonamento/handoff;
  - registro de cada contato.
- Deve depender de dados financeiros confiaveis vindos do RB ou fonte definida.

### Integracao RB

- Usar contrato da Sprint 7.
- Cliente RB deve ter modo `mock` por padrao e `live` apenas por env explicita.
- Toda chamada mutavel deve ter idempotency key.
- Webhooks/eventos RB devem ser persistidos e processados de forma assincrona.
- Erros permanentes/transientes devem seguir padrao do `automation-worker.ts`.

## 5. Ordem de execucao

1. Confirmar que Sprint 7 entregou contrato RB e memoria/subfases.
2. Definir politica de consentimento e retencao para imagens de visagismo.
3. Criar schema de jobs/resultados de visagismo.
4. Implementar `visagism-worker` em modo manual/mock.
5. Criar cliente RB em modo mock/live com idempotencia.
6. Criar schema de eventos/cobrancas RB.
7. Implementar agente de cobranca com limites operacionais.
8. Integrar agente de cobranca ao RB em ambiente de teste.
9. Liberar live somente com feature flag/env e criterios de rollback.

## 6. Criterios de aceite

- Worker de visagismo processa imagem autorizada e grava resultado auditavel.
- Falhas de visagismo ficam registradas sem travar chat/automacoes.
- Agente de cobranca so atua quando ha dado financeiro confiavel.
- Mensagens de cobranca respeitam limites de horario/tentativas.
- RB mock cobre sucesso, falha transiente, falha permanente e webhook de retorno.
- Modo live RB exige env explicita e logs seguros.
- Operador consegue auditar o que foi enviado e por que foi enviado.

## 7. Riscos e mitigacoes

| Risco | Probabilidade | Mitigacao |
|---|---|---|
| Imagem sensivel sem consentimento | Alta | Consentimento, bucket privado e retencao curta |
| Cobranca automatica inadequada | Alta | Limites, handoff, tom controlado e auditoria |
| RB indisponivel causar duplicidade | Media | Idempotency key e fila com retries |
| Custos de IA de visao altos | Media | Feature flag, limites por conta e logs de uso |
| Confundir billing da plataforma com cobranca final | Media | Separar schemas/nomes e contrato RB |

## 8. Testes

- `npm --prefix Project/IA run build`
- `npm --prefix Project/IA run schema:check`
- Teste de worker de visagismo com job mock.
- Teste de imagem expirada/sem permissao.
- Teste de agente de cobranca com dados incompletos: deve nao enviar.
- Teste RB mock: sucesso, 429/500, 400 e webhook.
- Teste de idempotencia para evitar cobranca duplicada.

## 9. Pontos de atencao

- Nao ativar cobranca live sem revisao humana e feature flag.
- Nao reutilizar billing interno da plataforma como se fosse financeiro do cliente final.
- Nao salvar imagem duplicada em logs/snapshots de IA.
- Documentar rollback antes do primeiro teste live.

