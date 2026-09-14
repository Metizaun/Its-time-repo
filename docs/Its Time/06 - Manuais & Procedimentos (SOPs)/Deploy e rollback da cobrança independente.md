---
title: "Deploy e rollback da cobrança independente"
tags:
  - project/its-time
  - type/runbook
  - domain/collections
status: "draft"
last_updated: 2026-09-10
author: "Equipe Its Time"
---

# Deploy e rollback da cobrança independente

Este runbook descreve a promoção da cobrança independente entre ambientes. A
etapa atual é somente local: o projeto remoto `hv...` não deve receber
migration, alteração de dados ou deploy até existir uma janela de publicação
aprovada.

## 1. Regras de segurança da execução

- O release é um único commit/tag contendo frontend, backend, `collection-worker`, migrations, testes e documentação.
- Homologação deve usar um projeto Supabase separado do projeto remoto de produção.
- Os testes que alteram estado devem apontar para o Supabase local ou de homologação explicitamente conferido.
- Nunca executar `npx supabase db reset` no projeto remoto.
- Não apagar migrations aplicadas nem fazer rollback destrutivo do banco. Correções de banco são migrations corretivas; restauração de snapshot exige análise e aprovação.
- Logs devem conter somente IDs, hashes, contagens, códigos e tempos. Não registrar segredos, payload bruto ou instruções completas de pagamento.

## 2. Etapa local — executar agora

Pré-requisitos:

```powershell
node --version       # deve ser 22.x
npm --version        # deve ser 10.x ou superior
npx supabase start
```

Validar o release no repositório:

```powershell
npx supabase db reset
npx supabase test db
npm run typecheck
npm run build
npm run lint

Set-Location Project/IA
npm run build
npm run lint
npm test
npm run schema:check
Set-Location ../..
```

Validar o compose local e iniciar a API com o worker de cobrança:

```powershell
docker compose config --quiet
.\scripts\dev-local.ps1 start
```

O fluxo ponta a ponta local deve cobrir fonte webhook, rotação e cópia do
segredo, HMAC válido e inválido, replay, payload adulterado, ingestão
incremental e snapshot, CSV/XLSX, outbox, execução do worker, elegibilidade,
pausas, envio exclusivamente pelo `automation-worker` e atualização de títulos
quitados, cancelados e suspensos.

## 3. Homologação — somente após aprovação

1. Confirmar o commit/tag do release e o projeto Supabase de homologação. Não prosseguir se a URL ou o project ref apontar para `hv...`.
2. Fazer backup/snapshot e registrar o responsável, horário e identificador do snapshot.
3. Conferir `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `COLLECTION_SECRETS_ENCRYPTION_KEY`, `RB_WEBHOOK_JWT_SECRET` e credenciais dos provedores de mensagens.
4. Conferir o plano sem executar mudanças:

   ```powershell
   npx supabase db push --dry-run
   npx supabase migration list
   ```

5. Aplicar somente na homologação:

   ```powershell
   npx supabase db push
   npx supabase migration list
   Set-Location Project/IA
   npm run schema:check
   Set-Location ../..
   ```

6. Subir API e `collection-worker` usando a mesma imagem Docker candidata à produção e confirmar que ambos estão saudáveis.
7. Executar smoke tests com conta de teste: autenticação, criação/rotação de fonte, webhook, arquivo, RB, ingestão, outbox, pausas e status da cobrança.
8. Simular falhas de API, worker, credencial, outbox e provedor. Confirmar que não há segredos ou payloads sensíveis nos logs.
9. Observar ingestões, outbox, fontes stale, execuções canceladas, falhas de credencial e mensagens enviadas.

Critério de avanço: migrations aplicadas, preflight aprovado, API e worker
saudáveis, smoke tests aprovados e nenhum erro crítico durante o período de
observação.

## 4. Publicação futura no projeto remoto

Executar somente em janela autorizada e após homologação:

1. Congelar o commit/tag exato validado.
2. Fazer backup/snapshot do banco remoto e registrar o estado atual:

   ```powershell
   npx supabase migration list
   ```

3. Pausar o dispatcher global e confirmar que não haverá novos envios.
4. Conferir novamente o project ref e aplicar as migrations:

   ```powershell
   npx supabase db push
   npm run schema:check
   ```

5. Construir a imagem Node 22 com tag imutável e publicar API e `collection-worker` pelo stack existente.
6. Preservar `failure_action: rollback` no update do Swarm.
7. Confirmar serviços e logs:

   ```bash
   docker service ls
   docker service ps <stack>_api
   docker service ps <stack>_collection-worker
   docker service logs <stack>_api
   docker service logs <stack>_collection-worker
   ```

8. Executar smoke tests antes de reativar o dispatcher.
9. Para contas RB antigas: backfill, três ciclos shadow aprovados, comparação sem divergências, cutover individual e validação de envio.
10. Reativar o dispatcher e monitorar continuamente por 24 horas, mantendo acompanhamento operacional por 7 dias.

## 5. Rollback

### Falha antes de iniciar envios

- Manter o dispatcher pausado.
- Interromper ou escalar o `collection-worker` para zero.
- Reverter somente a imagem da aplicação para a tag anterior.
- Preservar migrations, outbox e registros de ingestão.
- Corrigir o banco com migration corretiva ou restaurar snapshot apenas depois da análise e aprovação.

### Falha durante o processamento

- Pausar a fonte afetada ou o dispatcher global se o escopo não estiver isolado.
- Impedir novos envios e preservar outbox, ingestões e auditoria.
- Confirmar idempotência antes de qualquer reprocessamento.
- Reativar fontes individualmente após validar a causa e os registros pendentes.

O rollback da aplicação é feito pela imagem Docker anterior. Não usar `db
reset`, `supabase db reset`, `DROP`, down migration ou qualquer rollback
destrutivo em produção.

## 6. Evidências e aceite

Guardar no registro do release:

- commit/tag, imagem e digest publicados;
- snapshot/backup e estado da lista de migrations;
- saída do `schema:check` e dos testes locais/homologação;
- saúde e logs resumidos de API e `collection-worker`;
- smoke tests de webhook, arquivo, RB, ingestão, outbox e cobrança;
- contagens de outbox pendente, fontes stale, execuções canceladas e mensagens;
- resultado do ensaio de rollback.

O release só pode ser considerado concluído quando a API e o worker estiverem
saudáveis, todas as migrations do ambiente de destino estiverem aplicadas,
RB sem billing ou token não puder despachar, as pausas bloquearem envios, não
houver pendências anormais e o período de observação estiver encerrado.
