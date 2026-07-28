---
title: "Gestão Multi-Empresas & Encaminhamento Inteligente"
tags:
  - project/its-time
  - type/modulo
status: "approved"
last_updated: 2026-07-24
author: "Equipe Its Time"
related_code:
  - "update/especificacao_empresas_e_encaminhamento_inteligente.md"
  - "update/design_implementacao_empresas_agenda_encaminhamento_inteligente.md"
---

# 🏬 Gestão Multi-Empresas & Encaminhamento Inteligente

A arquitetura do **Its Time** permite gerenciar múltiplas óticas/filiais em uma única instância do sistema, mantendo o isolamento de dados entre empresas e oferecendo roteamento inteligente de mensagens de entrada.

---

## 🔄 Fluxo de Encaminhamento Inteligente

```mermaid
sequenceDiagram
    autonumber
    actor Cliente
    participant WhatsApp as Evolution API / WhatsApp
    participant Engine as Engine de Encaminhamento
    participant IA as Agente de IA / Classificador
    participant CRM as CRM Its Time (Filial Selecionada)

    Cliente->>WhatsApp: Envia mensagem no número central
    WhatsApp->>Engine: Dispara Webhook de Mensagem Recebida
    Engine->>IA: Qualifica intenção e filial sugerida
    IA-->>Engine: Retorna Empresa ID & Estágio Recomendado
    Engine->>CRM: Associa Lead à Empresa e Vendedor Responsável
    CRM-->>Cliente: Notificação/Atendente assume conversa
```

---

## 🛡️ Regras de Isolamento Multi-Tenancy (RLS)

1. **Atendente / Vendedor**: Possui visibilidade estrita aos leads e orçamentos vinculados à sua `empresa_id` cadastrada.
2. **Gerente de Filial**: Visualiza relatórios e kanban de toda a sua filial.
3. **Admin Geral**: Possui visão global, podendo alternar o contexto de visualização entre filiais ou visualizar o consolidador multi-empresas.

---

## 🔗 Links Relacionados
- [[🎯 MOC - Produto & Negócio]]
- [[Modelo de Dados & Schema Supabase]]
- [[Políticas de RLS & Segurança]]
