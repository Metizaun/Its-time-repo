# Lead webhook — automações com IA

## Contrato de entrada

O endpoint é `POST /api/integrations/leads/v1/connections/{publicConnectionId}/events`. Envie `Content-Type: application/json`, `Idempotency-Key`, `x-leads-timestamp` e `x-leads-signature`. A assinatura é `sha256=HMAC_SHA256(secret, timestamp + "." + rawBody)` e aceita uma janela de cinco minutos.

```json
{
  "name": "Maria Silva",
  "phone": "5511999999999",
  "email": "maria@example.com",
  "observation": "Interesse em multifocais",
  "tags": ["campanha-site"],
  "media": {
    "type": "image",
    "url": "https://cdn.example.com/produto.webp",
    "caption": "Imagem recebida do parceiro"
  }
}
```

`media` é opcional. A conexão precisa estar com “Receber imagem” habilitado. São aceitos JPEG, PNG e WebP por HTTPS, até 5 MB, três redirecionamentos e 15 segundos. DNS e IP público são verificados em cada salto; MIME declarado e assinatura binária precisam coincidir. O sistema guarda apenas URL final, MIME, tamanho, SHA-256, legenda e data de validação — nunca os bytes.

## Operação da jornada

O webhook cria ou atualiza o lead e seu receipt idempotente. Ele não envia mensagens diretamente. Depois da persistência de lead, notas, tags, receipt e mídia, o motor existente inscreve o lead em cada jornada ativa vinculada à conexão e à mesma instância.

Cada jornada nova nasce inativa. A ativação valida conexão, instância, agente primário, mídia, instrução de IA, bindings, aprovação e eventual reclassificação do template. A instância da jornada determina agente, provedor e remetente.

Mensagens de IA são geradas antes da humanização. O texto é persistido em `crm.automation_executions.ai_generated_text` antes do envio e reaproveitado em todas as retentativas. A chave de custo é `automation_execution:{executionId}:message_generation`. O modelo recebe contexto limitado e identifica notas, histórico, fatos, respostas e legenda como dados não confiáveis; payload bruto, credenciais e bytes de mídia não são enviados.

Para mídia do webhook, a imagem é baixada e validada novamente antes do envio. Indisponibilidade e HTTP 5xx geram retentativa; rede privada, MIME inválido e alteração de hash encerram a execução. Um evento sem imagem cancela, com motivo auditável, qualquer passo que exija `Imagem do webhook`.

## Diagnóstico

- `crm.lead_webhook_receipts`: identidade, resposta idempotente e snapshot da mídia.
- `crm.automation_enrollments.source_webhook_receipt_id`: inscrição originada pelo evento.
- `crm.automation_executions`: snapshots, texto gerado, provedor/modelo, uso e erro final.
- `crm.message_history`: conteúdo final entregue, com `source_type=automation`.
- `crm.notifications`: templates pausados, rejeitados, removidos ou reclassificados apontam para `/automacao`.

Respostas `5xx` podem ser repetidas com a mesma chave e o mesmo corpo. `4xx` exige correção. Reutilizar uma chave com corpo diferente retorna conflito e nunca cria nova inscrição.
