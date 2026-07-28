---
title: "Troubleshooting & Resolução de Erros Comuns"
tags:
  - project/its-time
  - type/sop
status: "approved"
last_updated: 2026-07-24
author: "Equipe Its Time"
---

# 🚨 Troubleshooting & Resolução de Erros Comuns (Its Time)

Este documento condensa os procedimentos operacionais padrão (SOP) para diagnosticar e corrigir os erros mais frequentes identificados no desenvolvimento e produção do **Its Time**.

---

## ❌ 1. Erro: `schema-preflight failed` no Backend / Build

### Sintoma
O servidor Node.js ou build do projeto falha com mensagem indicando que a estrutura do banco não coincide com a versão mínima requerida.

### Causa
Falta aplicar as migrations pendentes no Supabase.

### Solução
```bash
# 1. Garantir que o Supabase local esteja ativo
npx supabase status

# 2. Forçar a aplicação das migrations obrigatórias
npx supabase db push

# 3. Se persistir, aplique a migration de recuperação diretamente:
# supabase/migrations/20260423113000_fix_automation_progress_and_ai_echo_freeze.sql
```

---

## ❌ 2. Erro: Evolution API desconectada (WhatsApp Web Off)

### Sintoma
Leads chegam mas o sistema não envia nem recebe mensagens via WhatsApp.

### Causa
A instância da Evolution API perdeu o token de sessão ou o QR Code expirou.

### Solução
1. Acesse o painel de admin ou endpoint da Evolution API (`http://localhost:8080` ou URL VPS).
2. Verifique o status da instância vinculada à empresa (`GET /instance/fetchInstances`).
3. Se o status for `DISCONNECTED`, solicite a reconexão gerando um novo QR Code (`GET /instance/connect/:instance`).
4. Re-escaneie o QR Code usando o celular corporativo da ótica.

---

## ❌ 3. Erro: RLS (Row Level Security) bloqueia consulta do Vendedor

### Sintoma
O vendedor abre o Kanban e a tela fica vazia ou retorna erro `42501 (insufficient_privilege)`.

### Causa
O perfil do usuário na tabela `users` / `profiles` não possui a `empresa_id` vinculada ou a role está incorreta.

### Solução
1. Acesse o Supabase Studio (`http://localhost:54323` ou Painel Cloud).
2. Verifique a tabela `public.users` e certifique-se de que o campo `empresa_id` corresponde à empresa do vendedor.
3. Garanta que a coluna `role` esteja preenchida com `'vendedor'`, `'gerente'` ou `'admin'`.

---

## 🔗 Links Relacionados
- [[📖 MOC - Visão Geral do App]]
- [[Padronização de Migrations & Schema Preflight]]
- [[Políticas de RLS & Segurança]]
- [[Evolution API (WhatsApp)]]
