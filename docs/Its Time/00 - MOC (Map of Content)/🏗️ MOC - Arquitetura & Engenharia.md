---
title: "🏗️ MOC - Arquitetura & Engenharia"
tags:
  - project/its-time
  - type/moc
status: "approved"
last_updated: 2026-07-24
author: "Equipe Its Time"
---

# 🏗️ MOC - Arquitetura & Engenharia (Its Time)

Este Map of Content centraliza a arquitetura técnica, padrões de banco de dados, frontend e convenções de código do **Its Time**.

---

## 📌 Documentos de Arquitetura

- [[📌 MOC - Visão Geral do App]]: Voltar ao MOC Principal.
- [[Visão Geral da Arquitetura (System Overview)]]: Visão topológica (Frontend Vite/React -> Backend Node/Supabase -> Evolution API -> Redis).
- [[Modelo de Dados & Schema Supabase]]: Schemas DDL, tabelas relacionais e enums.
- [[Políticas de RLS & Segurança]]: Implementação de Row Level Security e tokens JWT.
- [[Estrutura do Frontend (React + Vite + TS)]]: Arquitetura de componentes UI, hooks customizados e gerenciamento de estado.
- [[Padronização de Migrations & Schema Preflight]]: Fluxo de migração obrigatório e script de checagem preflight.

---

## 💻 Tech Stack de Engenharia

```text
+-------------------------------------------------------------------+
|                        FRONTEND (Vite / Vercel)                   |
|   React 18  |  TypeScript  |  Tailwind CSS  |  Shadcn UI          |
+-------------------------------------------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
|                     BACKEND & PERSISTÊNCIA                        |
|   Supabase (PostgreSQL, Auth, RLS, Storage, Edge Functions)       |
+-------------------------------------------------------------------+
                                  |
               +------------------+------------------+
               |                                     |
               v                                     v
+-----------------------------+       +-----------------------------+
|    MENSAGERIA & BOT         |       |        FILAS & CACHE        |
|  Evolution API (WhatsApp)   |       |   Redis Server (BullMQ)     |
+-----------------------------+       +-----------------------------+
```

---
*Retornar ao [[📌 MOC - Visão Geral do App]]*
