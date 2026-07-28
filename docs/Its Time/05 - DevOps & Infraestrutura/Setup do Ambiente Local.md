---
title: "Setup do Ambiente Local"
tags:
  - project/its-time
  - type/devops
status: "approved"
last_updated: 2026-07-24
author: "Equipe Its Time"
related_code:
  - "start-dev.ps1"
  - "docker-compose.yml"
  - "docker-compose.evolution.yml"
  - "README.md"
---

# 💻 Setup do Ambiente Local (Its Time)

Este guia orienta a inicialização completa do ambiente de desenvolvimento do **Its Time** no Windows ou Linux.

---

## ⚡ Inicialização Rápida (PowerShell)

No Windows, você pode rodar o script automatizado `start-dev.ps1`:

```powershell
.\start-dev.ps1
```

O script realizará:
1. Subida das instâncias Docker da **Evolution API** e **Redis**.
2. Inicialização do servidor local do Vite em modo dev (`npm run dev`).

---

## 🔧 Passo a Passo Manual

### 1. Requisitos
- Node.js >= 18
- Docker Desktop ativo
- Supabase CLI instalado (`npx supabase`)

### 2. Instalação de Dependências
```bash
npm install
```

### 3. Configuração de Variáveis de Ambiente
Copie o arquivo de exemplo para `.env.local`:
```bash
cp .env.local.example .env.local
```

### 4. Inicializar Supabase & Containers
```bash
# Iniciar banco de dados Supabase local
npx supabase start

# Subir Evolution API e Redis
docker-compose -f docker-compose.evolution.yml up -d
```

### 5. Executar o App Frontend
```bash
npm run dev
```

Acesse no navegador: `http://localhost:5173`.

---

## 🔗 Links Relacionados
- [[🚀 MOC - Operações & Deploy]]
- [[Deploy VPS & Docker Stack]]
- [[Padronização de Migrations & Schema Preflight]]
