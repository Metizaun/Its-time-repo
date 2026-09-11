---
title: "Padronização de Migrations & Schema Preflight"
tags:
  - project/its-time
  - type/arquitetura
status: "approved"
last_updated: 2026-07-24
author: "Equipe Its Time"
related_code:
  - "README.md"
  - "supabase/migrations/"
---

# 🛠️ Padronização de Migrations & Schema Preflight

Para evitar divergências de banco de dados entre ambiente de desenvolvimento local e produção no Supabase, o projeto **Its Time** adota um padrão estrito de validação automatizada de schema.

---

## 📌 Regras Obrigatórias de Desenvolvimento

1. **Dependência de Schema**: Toda nova funcionalidade que alterar tabelas, colunas, enums ou RLS deve conter um arquivo de migração versionado sob a pasta `supabase/migrations/`.
2. **Migration Obrigatória**: A migration `supabase/migrations/20260423113000_fix_automation_progress_and_ai_echo_freeze.sql` é o marco obrigatório de integridade do ambiente.
3. **Bloqueio por Preflight**: Se o servidor backend falhar na verificação de `schema-preflight`, o deploy ou ambiente local deve ser interrompido até a aplicação de `npx supabase db push` ou `apply_migration`.
4. **Node suportado**: O backend, os testes e o preflight devem rodar com Node.js 22 ou superior.
5. **Ambiente remoto protegido**: O projeto remoto de produção não deve receber migrations durante o desenvolvimento. Primeiro valide no Supabase local e em homologação; só depois execute `db push` em uma janela aprovada.

---

## 💻 Checklist de Aplicação de Migrations

```bash
# 1. Iniciar o Supabase local
npx supabase start

# 2. Recriar o banco local e aplicar todas as migrations
npx supabase db reset

# 3. Executar os testes SQL
npx supabase test db

# 4. Executar o preflight de checagem no backend
cd Project/IA
npm run schema:check
```

Antes de qualquer ambiente remoto, confira o que seria aplicado sem executar
alterações:

```bash
npx supabase db push --dry-run
npx supabase migration list
```

O procedimento completo da cobrança independente, incluindo homologação,
pausa do dispatcher, validação dos workers e rollback, está no runbook de
`Deploy e rollback da cobrança independente`.

---

## 🔗 Links Relacionados
- [[🏗️ MOC - Arquitetura & Engenharia]]
- [[Modelo de Dados & Schema Supabase]]
- [[Políticas de RLS & Segurança]]
- [[Troubleshooting & Resolução de Erros Comuns]]
