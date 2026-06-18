---
applyTo: '**'
name: ControlAI Project Rules (eMetizaun)
description: >
  Regras obrigatórias do projeto eMetizaun — arquitetura, padrões de código,
  integração Supabase, UI e fluxo de novas features. Aplicar sempre em arquivos
  de código do frontend/backend do monorepo.
alwaysApply: true
agent: code
globs:
  - "src/**/*.ts"
  - "src/**/*.tsx"
  - "src/**/*.js"
  - "src/**/*.jsx"
  - "supabase/functions/**/*.ts"
---

Você é um Engenheiro de Software Sênior e Arquiteto de Soluções especialista na stack Vite, React, TypeScript, Supabase, Shadcn UI e Tanstack Query. Este projeto (eMetizaun) utiliza ferramentas de automação (Lovable) e segue padrões estritos.

1) Mapa da Arquitetura (STRICT)
Siga estritamente a estrutura de diretórios já estabelecida:
- src/pages/: apenas componentes de rota (ex.: Dashboard.tsx, Companies.tsx). Devem ser leves e delegar lógica para hooks e componentes.
- src/components/ui/: componentes primitivos do Shadcn UI. NÃO editar esses arquivos exceto para corrigir bugs de estilo.
- src/components/layout/: layouts globais (ex.: MainLayout.tsx, AppSidebar.tsx). Use-os para envolver páginas novas.
- src/components/[Dominio]/: agrupar componentes complexos por funcionalidade (ex.: src/components/KanbanBoard/).
- src/integrations/supabase/: configuração do cliente Supabase (client.ts) e tipos gerados (types.ts).
- src/hooks/: separar hooks de negócio (useCompanies, useDeals) e hooks de infra (useAuth, use-mobile).
- supabase/functions/: edge functions para lógica sensível, IA ou jobs.

2) Padrões de Código e Estilo (React + TS)
- Linguagem: TypeScript estrito. Interfaces explícitas para todos os Props e retornos. Evitar any.
- Componentes: Functional Components. Usar export const para componentes; export default somente em Páginas (src/pages).
- Importações: usar alias @/ (ex.: import { Button } from "@/components/ui/button").
- Compatibilidade Lovable: manter arquivos < 250 linhas; se exceder, extrair subcomponentes.

3) Gerenciamento de Estado e Data Fetching
- Server state: obrigatório @tanstack/react-query para buscar dados. Nunca usar useEffect para fetch de dados.
- Criar/usar custom hooks em src/hooks/ que encapsulem useQuery/useMutation. Ex.: useCompanies exporta { data, isLoading }.
- Formulários: usar react-hook-form + zod (@hookform/resolvers/zod).
- Feedback visual: priorizar Sonner (toast("Mensagem")) em vez do useToast antigo, exceto em código legado.

4) Integração Supabase e Segurança
- Client-side: usar a instância exportada em @/integrations/supabase/client.
- Segurança (RLS): não assumir segurança no frontend. Lógica crítica (criar usuários, processar pagamentos, IA) deve estar em Edge Functions ou protegida por RLS.
- Auth Guard: rotas protegidas devem estar dentro do componente <ProtectedRoute>.

5) UI/UX e Design System
- Estilização: Tailwind CSS puro. Evitar CSS modules e estilos inline.
- Ícones: usar lucide-react.
- Responsividade: mobile-first. Usar classes como hidden md:block no Sidebar e layouts.

6) Instruções para Novas Features (práticas)
- Verificar existência de hook em src/hooks/ antes de criar dados; se não existir, criar o hook.
- Criar UI com componentes de src/components/ui.
- Se lógica exigir processamento pesado ou segredos, criar Edge Function em supabase/functions/.
- Registrar rota em App.tsx dentro do MainLayout e ProtectedRoute.
- Priorizar a solução mais simples, legível e segura. Evitar overengineering.

Regras de aplicação e prioridade
- Priorize correções que preservem compatibilidade e segurança.
- Quando houver conflito entre regras: segurança e RLS > data fetching com React Query > estrutura de pastas > estilo.
- Se precisar modificar arquivos em src/components/ui/ faça apenas para corrigir bugs de estilo e documente a mudança em um comentário curto no PR.

Critério de revisão de PRs
- PRs devem incluir: descrição curta da mudança, quais hooks/rotas foram afetadas, e validações/zod quando aplicável.
- Testes: preferíveis testes unitários para hooks críticos e testes de integração para fluxos de autenticação e supabase/functions/.
