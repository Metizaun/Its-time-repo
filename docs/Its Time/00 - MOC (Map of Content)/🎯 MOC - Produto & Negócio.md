---
title: "🎯 MOC - Produto & Negócio"
tags:
  - project/its-time
  - type/moc
status: "approved"
last_updated: 2026-07-24
author: "Equipe Its Time"
---

# 🎯 MOC - Produto & Negócio (Its Time)

Este Map of Content agrupa toda a especificação funcional do sistema **Its Time**, seu posicionamento no segmento de óticas, fluxos de conversão e regras de negócio.

---

## 📌 Links Rápidos para Documentos de Produto

- [[📌 MOC - Visão Geral do App]]: Voltar ao MOC Principal.
- [[Visão Geral do Sistema (CRM Óticas)]]: Propósito, proposta de valor e KPIs do negócio.
- [[Regras de Negócio & Workflows]]: SLA de atendimento, transição de estados e atribuição de leads.
- [[Perfis de Acesso & Permissões (Roles)]]: Matriz de acesso para Admin, Gerente e Vendedor.

---

## 🧩 Módulos do Sistema

### 1. [[Kanban & Pipeline de Vendas]]
- **Estágios padrão**: `Novo`, `Atendimento`, `Orçamento`, `Fechado`, `Perdido`, `Remarketing`.
- **Estilização**: Colunas personalizáveis Notion-style com paleta escura e detalhes dourados (`#C9A66B`).
- **Recursos**: Drag & Drop responsivo, cálculo automático do valor total por coluna, busca e ordenação rápida.

### 2. [[Gestão Multi-Empresas & Encaminhamento Inteligente]]
- **Multi-tenancy**: Suporte a grupos de óticas e matriz/filiais.
- **Roteamento Inteligente**: Algoritmo de distribuição automática de contatos recebidos no WhatsApp para a filial correta baseado em geo-localização ou intenção.
- **Isolamento de Dados**: Controle rígido onde atendentes enxergam apenas os leads de sua empresa autorizada.

### 3. [[Agenda & Agendamentos]]
- **Fluxo de Ótica**: Agendamento de exames de vista (refração), ajustes de armação e entrega de óculos.
- **Integração com Leads**: Todo agendamento é vinculado ao histórico do lead no CRM.
- **Notificações Automáticas**: Lembrete prévio via WhatsApp para evitar no-show (faltas).

### 4. [[Agentes de IA & Automações]]
- **Qualificação Inicial**: Agente virtual qualifica se o cliente tem receita, busca óculos de grau ou solar.
- **Memória de Conversa**: Retenção do contexto de conversas passadas.
- **Transição Transparente**: Transferência suave da IA para atendente humano quando solicitado ou em etapa de fechamento.

---
*Retornar ao [[📌 MOC - Visão Geral do App]]*
