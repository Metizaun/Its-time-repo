# Sprint 1 - Quick Wins e Setup de Infraestrutura

## 1. Contexto

Sprint focada em ganhos rapidos de UI, correcoes de bugs conhecidos e preparacao da infraestrutura de Storage para futuras midias do chat.

Tarefas de referencia:

- 1.1 Alterar botao principal do painel Admin para laranja.
- 1.2 Refatorar modal de automacao para visual mais minimalista.
- 1.3 Corrigir bug de expansao no estudio de agentes.
- 1.4 Corrigir filtro "todas as instancias" no Dashboard.
- 1.5 Mover download de modelo CSV para o modulo de importacao.
- 1.6 Configurar a fundacao de Storage privado para anexos do chat, preparando o envio futuro de midias/documentos pela Evolution API.

## 2. Diagnostico do codigo atual

### O que ja existe

- `src/pages/Admin.tsx` tem o botao "Criar Usuario" com classes `bg-emerald-500 hover:bg-emerald-600`.
- `src/pages/Automacao.tsx` e `src/components/modals/AutomationMessageModal.tsx` ja possuem builder avancado, tabs, condicoes, envio humanizado e debug.
- `src/components/modals/AgentConfigModal.tsx` controla a expansao com `studioExpanded`, alternando entre modal compacto e `95vw/90vh`.
- `src/pages/Dashboard.tsx` filtra instancias com `selectedInstance === "todas"`.
- `src/pages/Leads.tsx` mostra botao separado "Modelo CSV".
- `src/components/modals/LeadCsvImportModal.tsx` concentra o fluxo real de importacao CSV.
- `src/lib/utils/export.ts` ja possui `downloadLeadImportTemplate()`.
- Supabase ja e usado no frontend/backend, mas nao havia bucket/documentacao de anexos do chat antes da execucao do Sprint 1.6.
- O chat atual envia apenas texto pelo backend (`/api/chat/send-manual`); o fluxo de arquivo local do usuario ainda nao esta implementado.
- A Evolution API e o provedor operacional atual para envio manual, mas ainda falta contrato de midia/anexo no provider.

### O que precisa ser criado ou ajustado

- Criar migration de Storage apenas na execucao real da sprint.
- Definir bucket privado `chat-attachments` para anexos do chat, com limite de 100 MB e MIME types de imagens, audios, PDF, TXT e documentos comuns.
- Documentar o fluxo alvo: arquivo do PC do usuario -> frontend seleciona -> backend valida lead/instancia/usuario -> Storage privado -> backend chama Evolution API para enviar a midia -> historico do chat exibe mensagem/anexo.
- Deixar explicito que o Sprint 1.6 nao entrega ainda a UI de upload nem o envio real de midia; isso depende dos contratos do Sprint 2 e da interface do Sprint 3.
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
- Storage: criar bucket privado `chat-attachments` com signed upload URL como estrategia v1. Nesta fundacao, nao criar policies amplas de `storage.objects` para `anon` ou `authenticated`; o backend validara usuario/lead/instancia antes de gerar URLs temporarias nas proximas sprints.
- Evolution API: tratar o Storage como origem segura/controlada do arquivo, mas deixar a chamada de envio de midia para o backend/provider nas sprints de chat. O frontend nao deve chamar a Evolution diretamente.

## 5. Ordem de execucao

1. Ajustar botao principal em `Admin.tsx`.
2. Mover download de modelo CSV para `LeadCsvImportModal` e remover o botao solto em `Leads.tsx`.
3. Corrigir expansao do `AgentConfigModal` em desktop e mobile.
4. Revisar filtro "todas as instancias" no `Dashboard.tsx` com admin e vendedor.
5. Reduzir densidade visual do `AutomationMessageModal` mantendo a estrutura funcional.
6. Criar migration Supabase para bucket privado de Storage em ambiente de implementacao.
7. Atualizar exemplos de `.env` se alguma variavel publica ou privada for necessaria.
8. Registrar no guia tecnico o contrato esperado para as proximas sprints: upload seguro, metadados do anexo, envio pela Evolution e exibicao no chat.

## 6. Criterios de aceite

- Botao principal do Admin aparece em laranja e mantem estados disabled/loading.
- Modal de automacao fica mais simples visualmente sem perder criacao/edicao de jornadas e mensagens.
- Agent Studio expande e recolhe sem cortar editor, botoes ou blocos laterais.
- Dashboard mostra dados consolidados quando "Todas as instancias" esta selecionado.
- Download de modelo CSV fica disponivel dentro do modal de importacao.
- Bucket de Storage fica documentado/aplicado com acesso privado e base para signed URLs.
- `schema-preflight` valida que o bucket `chat-attachments` existe, e privado e possui limite/MIME types esperados.
- O fluxo alvo de anexos fica documentado, incluindo validacao no backend, uso da Evolution API para envio e proibicao de expor `service_role` ou `EVOLUTION_API_KEY` no frontend.
- Fica claro que upload pelo usuario, persistencia de metadados, envio de midia e exibicao do anexo no chat sao entregas das sprints 2 e 3, nao do Sprint 1.6 isoladamente.

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
- Validar que o desenho nao exige credenciais sensiveis no frontend e que o backend sera o unico responsavel por conversar com a Evolution API.
- Validar que acesso publico/listagem anonima ao bucket privado permanece bloqueado.

## 9. Pontos de atencao

- Nao recriar helper de download CSV; usar `downloadLeadImportTemplate()`.
- Nao alterar schema de chat nesta sprint, exceto a fundacao de Storage.
- Nao implementar upload no `ChatInput`, envio de midia na Evolution ou renderizacao de anexos nesta sprint; manter essas entregas para Sprint 2/3.
- Nao criar policies amplas em `storage.objects` para o bucket `chat-attachments`; signed upload URL sera gerada pelo backend apos validacao de dominio.
- Se tocar Supabase, verificar documentacao/changelog atual e criar migration com Supabase CLI.
