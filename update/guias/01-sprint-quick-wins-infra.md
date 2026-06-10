# Sprint 1 - Quick Wins e Setup de Infraestrutura

## 1. Contexto

Sprint focada em ganhos rapidos de UI, correcoes de bugs conhecidos e preparacao da infraestrutura de Storage para futuras midias do chat.

Tarefas de referencia:

- 1.1 Alterar botao principal do painel Admin para laranja.
- 1.2 Refatorar modal de automacao para visual mais minimalista.
- 1.3 Corrigir bug de expansao no estudio de agentes.
- 1.4 Corrigir filtro "todas as instancias" no Dashboard.
- 1.5 Mover download de modelo CSV para o modulo de importacao.
- 1.6 Configurar Storage em nuvem para midias e documentos.

## 2. Diagnostico do codigo atual

### O que ja existe

- `src/pages/Admin.tsx` tem o botao "Criar Usuario" com classes `bg-emerald-500 hover:bg-emerald-600`.
- `src/pages/Automacao.tsx` e `src/components/modals/AutomationMessageModal.tsx` ja possuem builder avancado, tabs, condicoes, envio humanizado e debug.
- `src/components/modals/AgentConfigModal.tsx` controla a expansao com `studioExpanded`, alternando entre modal compacto e `95vw/90vh`.
- `src/pages/Dashboard.tsx` filtra instancias com `selectedInstance === "todas"`.
- `src/pages/Leads.tsx` mostra botao separado "Modelo CSV".
- `src/components/modals/LeadCsvImportModal.tsx` concentra o fluxo real de importacao CSV.
- `src/lib/utils/export.ts` ja possui `downloadLeadImportTemplate()`.
- Supabase ja e usado no frontend/backend, mas nao ha bucket/documentacao de anexos do chat.

### O que precisa ser criado ou ajustado

- Criar migration de Storage apenas na execucao real da sprint.
- Definir bucket privado para anexos do chat.
- Mover o download do modelo para dentro do modal de importacao.
- Revisar layout expandido do Agent Studio para overflow, altura e proporcoes.

## 3. Arquivos provaveis

| Arquivo | Motivo | Risco |
|---|---|---|
| `src/pages/Admin.tsx` | Ajustar cor do botao principal de criacao | Baixo |
| `src/components/modals/AutomationMessageModal.tsx` | Reduzir densidade visual do modal sem remover funcoes | Medio |
| `src/pages/Automacao.tsx` | Ajustes de composicao ao abrir modal | Baixo |
| `src/components/modals/AgentConfigModal.tsx` | Corrigir expansao do studio | Medio |
| `src/pages/Dashboard.tsx` | Validar filtro "todas as instancias" | Medio |
| `src/pages/Leads.tsx` | Remover botao solto de modelo CSV | Baixo |
| `src/components/modals/LeadCsvImportModal.tsx` | Inserir acao de baixar modelo no fluxo de importacao | Baixo |
| `src/lib/utils/export.ts` | Reaproveitar helper existente | Baixo |
| `supabase/migrations/*` | Criar bucket/policies do Storage | Medio |

## 4. Proposta tecnica

- UI Admin: trocar a cor do CTA principal para laranja usando tokens existentes sempre que possivel; se nao houver token laranja, usar classe Tailwind consistente e isolada.
- Automacao: simplificar superficie visual do modal preservando os fluxos existentes: criacao de jornada, mensagens, regras, debug em dev e envio humanizado.
- Agentes: manter `studioExpanded`, mas garantir que modal expandido tenha dimensoes estaveis, textarea com altura correta, painel lateral legivel e scroll previsivel.
- Dashboard: revisar se "todas" usa a lista filtrada por periodo sem aplicar filtro de instancia adicional; confirmar que `useInstances()` nao restringe indevidamente o admin.
- Importacao CSV: remover botao "Modelo CSV" da pagina `Leads` e colocar acao dentro de `LeadCsvImportModal`, perto da area de upload.
- Storage: planejar bucket privado `chat-attachments` com signed URLs e politicas por usuario/conta antes de qualquer envio de midia.

## 5. Ordem de execucao

1. Ajustar botao principal em `Admin.tsx`.
2. Mover download de modelo CSV para `LeadCsvImportModal` e remover o botao solto em `Leads.tsx`.
3. Corrigir expansao do `AgentConfigModal` em desktop e mobile.
4. Revisar filtro "todas as instancias" no `Dashboard.tsx` com admin e vendedor.
5. Reduzir densidade visual do `AutomationMessageModal` mantendo a estrutura funcional.
6. Criar migration Supabase para bucket/policies de Storage em ambiente de implementacao.
7. Atualizar exemplos de `.env` se alguma variavel publica ou privada for necessaria.

## 6. Criterios de aceite

- Botao principal do Admin aparece em laranja e mantem estados disabled/loading.
- Modal de automacao fica mais simples visualmente sem perder criacao/edicao de jornadas e mensagens.
- Agent Studio expande e recolhe sem cortar editor, botoes ou blocos laterais.
- Dashboard mostra dados consolidados quando "Todas as instancias" esta selecionado.
- Download de modelo CSV fica disponivel dentro do modal de importacao.
- Bucket de Storage fica documentado/aplicado com acesso privado e base para signed URLs.

## 7. Riscos e mitigacoes

| Risco | Probabilidade | Mitigacao |
|---|---|---|
| Simplificacao do modal remover ferramenta usada | Media | Nao remover funcionalidades; apenas reorganizar visual |
| Filtro de instancia mudar escopo multi-tenant | Media | Testar admin e vendedor com mais de uma instancia |
| Storage expor arquivos indevidamente | Media | Bucket privado, RLS/policies e signed URLs |
| Expansao quebrar mobile | Media | Validar viewport estreito e altura reduzida |

## 8. Testes

- `npm run lint`
- `npm run build`
- Teste manual em `/admin`, `/automacao`, `/agentes`, `/`, `/leads`.
- Testar modal de importacao com CSV valido, invalido e sem arquivo.
- Testar Dashboard com "Todas as instancias" e uma instancia especifica.
- Para Storage: validar upload/listagem/signed URL em ambiente de teste antes de conectar ao chat.

## 9. Pontos de atencao

- Nao recriar helper de download CSV; usar `downloadLeadImportTemplate()`.
- Nao alterar schema de chat nesta sprint, exceto a fundacao de Storage.
- Se tocar Supabase, verificar documentacao/changelog atual e criar migration com Supabase CLI.

