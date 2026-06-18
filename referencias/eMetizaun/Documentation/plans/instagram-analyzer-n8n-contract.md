# Instagram Analyzer - Contrato n8n (V1)

## Objetivo
- Permitir que workflows n8n leiam/escrevam no schema `research` sem upload de midia em bucket.
- Garantir idempotencia e segregacao por `organization_id`.

## Tabelas-alvo
- `research.projects`
- `research.scrape_items`
- `research.project_saved_items`
- `research.project_documents`
- `research.project_ai_notes`
- `research.vector_queue`

## Regras operacionais
- 1 workflow por organizacao.
- Nunca misturar `organization_id` em um mesmo fluxo.
- Chave do Supabase no n8n com escopo minimo necessario.
- Midia nao deve ser armazenada no Storage; salvar apenas links/metadados.

## Fluxo 1 - Upsert de projeto
Entrada minima:
- `organization_id`
- `created_by_user_id`
- `name`
- `competitor_username`

Estratégia:
- Upsert por `(organization_id, competitor_username)` em `research.projects`.

## Fluxo 2 - Insercao de itens de scrape externos
Entrada minima:
- `organization_id`
- `scrape_job_id`
- `profile_username`
- `type` (`photo` ou `reel`)
- `permalink`

Estrategia:
- Upsert por `(organization_id, scrape_job_id, permalink)` em `research.scrape_items`.

## Fluxo 3 - Salvar itens em projeto
Entrada minima:
- `organization_id`
- `project_id`
- `scrape_item_id`
- `selected_by_user_id`

Estrategia:
- Upsert por `(project_id, scrape_item_id)` em `research.project_saved_items`.

## Fluxo 4 - Gerar documentos de analise/roteiro
Entrada minima:
- `organization_id`
- `project_id`
- `created_by_user_id`
- `title`
- `doc_type` (`analysis`, `notes`, `script`)
- `content_md`

Estrategia:
- Insert em `research.project_documents`.
- Opcionalmente registrar em `research.project_ai_notes` e enfileirar em `research.vector_queue` (status `pending`).

## Idempotencia recomendada
- Projetos: `(organization_id, competitor_username)`.
- Itens de scrape: `(organization_id, scrape_job_id, permalink)`.
- Itens salvos: `(project_id, scrape_item_id)`.

## Observabilidade minima
- Registrar `runId` do workflow n8n no metadata JSON quando aplicavel.
- Capturar erros no n8n e gravar feedback em `project_ai_notes` quando o fluxo falhar.

