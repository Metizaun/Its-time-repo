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

---

## 💻 Checklist de Aplicação de Migrations

```bash
# 1. Iniciar o Supabase local
npx supabase start

# 2. Aplicar migrations pendentes
npx supabase db push

# 3. Executar preflight de checagem
npm run schema-preflight
```

---

## 🔗 Links Relacionados
- [[🏗️ MOC - Arquitetura & Engenharia]]
- [[Modelo de Dados & Schema Supabase]]
- [[Políticas de RLS & Segurança]]
- [[Troubleshooting & Resolução de Erros Comuns]]
