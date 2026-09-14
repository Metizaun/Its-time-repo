# Crm Its time - Sistema de Gestão de Vendas

Sistema multi-tenant de CRM e automação de atendimento, desenvolvido com React, TypeScript, Tailwind CSS, Express e Supabase.

## 🎯 Funcionalidades

### Pipeline Kanban
- ✅ Visualização em colunas personalizáveis (Novo, Atendimento, Orçamento, Fechado, Perdido, Remarketing)
- ✅ Drag & drop para mover leads entre etapas
- ✅ Customização de cores das colunas (estilo Notion)
- ✅ Cards informativos com dados-chave dos leads

### Dashboard Analítico
- ✅ KPIs principais: Total de Leads, Negócios Ganhos, Receita Total, Taxa de Conversão
- ✅ Gráficos de tendência por dia
- ✅ Análise por origem de leads
- ✅ Funil de vendas visual
- ✅ Filtros por período (Hoje, 7 dias, 30 dias, Total)

### Gestão de Leads
- ✅ CRUD completo (Criar, Ler, Atualizar, Deletar)
- ✅ Tabela com todas as informações
- ✅ Export para CSV
- ✅ Busca global em tempo real
- ✅ Drawer de detalhes com ações rápidas

### Recursos Avançados
- ✅ Persistência local (LocalStorage)
- ✅ Sistema de Undo para ações críticas
- ✅ Toasts informativos
- ✅ Atalhos de teclado
- ✅ Acessibilidade (ARIA labels, keyboard navigation)
- ✅ Animações e microinterações

### Admin
- ✅ Gestão de usuários
- ✅ Reset de dados
- ✅ Visualização de configurações

## ⌨️ Atalhos de Teclado

- `Ctrl/Cmd + K` - Busca global
- `/` - Focar no campo de busca
- `N` - Criar novo lead
- `M` - Mover lead focado (no Kanban)

## 🎨 Design System

A interface segue o padrão White Minimalist SaaS / Soft UI documentado em
`chat-query.design-ui-ux/`. As cores, sombras, raios e estados interativos
devem usar os tokens definidos em `src/index.css`.

## 🚀 Começando

### Instalação

```bash
npm install
```

### Desenvolvimento

```bash
npm run dev
```

Esse comando sobe o backend, o `collection-worker` via Docker Compose e o
frontend via Vite, usando o ambiente local padronizado do projeto. Antes disso,
garanta que o Supabase local esteja ativo com `npx supabase start` e que o Node.js
22 esteja selecionado.

### Cobrança independente

A cobrança independente recebe dados de RB, webhook ou CSV/XLSX por meio de um
contrato canônico comum. A ingestão é idempotente e alimenta projeções e outbox;
o `collection-worker` executa pulls, importações, elegibilidade, leases e
retenção, enquanto somente o `automation-worker` envia mensagens.

O onboarding de cada fonte configura WhatsApp, agente, pipeline, régua e
mensagens. A conexão não inicia envios automaticamente: a ativação é explícita
e pode ser pausada por fonte. Para contas RB existentes, o cutover exige
backfill, três ciclos shadow aprovados e comparação sem divergências.

### Padrão de Desenvolvimento para Migrations

- Toda nova feature que depender de schema deve ter migration aplicada no ambiente antes de validar o backend.
- A migration `supabase/migrations/20260423113000_fix_automation_progress_and_ai_echo_freeze.sql` passa a ser obrigatoria como padrao deste projeto.
- Se o backend falhar no `schema-preflight`, aplique as migrations pendentes no Supabase antes de continuar o desenvolvimento ou redeploy.

Para validar localmente, use `npx supabase db reset`, `npx supabase test db` e
`npm run schema:check` dentro de `Project/IA`. Não execute `supabase db push`
contra produção fora de uma janela de publicação aprovada.

### Build

```bash
npm run build
```

## 📊 Estrutura de Dados

### Lead
```typescript
{
  id: string
  nome: string
  cidade: string
  email: string
  telefone: string
  origem: string
  conexao: "Baixa" | "Média" | "Alta"
  valor: number
  dataCriacao: string (ISO)
  responsavel: string
  status: "Novo" | "Atendimento" | "Orçamento" | "Fechado" | "Perdido" | "Remarketing"
  observacoes?: string
}
```

### User
```typescript
{
  id: string
  name: string
  email: string
  role: "admin" | "vendedor"
}
```

## 🎓 Tecnologias

- **React 18** - Framework UI
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **Shadcn/ui** - Component library
- **Recharts** - Data visualization
- **date-fns** - Date handling
- **Sonner** - Toast notifications
- **React Router** - Navigation

## 📝 Operação e deploy

O procedimento de release, homologação, aplicação de migrations, verificação
dos workers e rollback está em
`docs/Its Time/06 - Manuais & Procedimentos (SOPs)/Deploy e rollback da cobrança independente.md`.

## 🔒 Roles e Permissões

- **Admin**: Acesso completo + página de administração
- **Vendedor**: Acesso a Dashboard, Pipeline, Leads e Chat

## 🎯 Critérios de Aceitação

✅ CRUD de leads funcional
✅ Kanban com drag & drop
✅ Dashboard com métricas e gráficos
✅ Export CSV
✅ Theme toggle
✅ Busca em tempo real
✅ Atalhos de teclado
✅ Sistema de undo
✅ Toasts informativos
✅ Acessibilidade básica
✅ Animações suaves
✅ Responsividade

---

Desenvolvido com ❤️ para gestão eficiente de vendas de ótica
