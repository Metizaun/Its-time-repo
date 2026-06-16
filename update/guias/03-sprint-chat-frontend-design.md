# Guia de Design - Sprint 3 Chat Frontend

Este guia complementa `update/guias/03-sprint-chat-frontend.md` e deve ser usado como a especificacao visual/UX da Sprint 3. A implementacao tecnica continua seguindo o guia principal; este documento define como a tela deve se comportar e parecer.

## 1. Fontes obrigatorias

Antes de editar componentes `.tsx` ou CSS do chat, ler:

- `chat-query.design-ui-ux/00-manifesto.md`
- `chat-query.design-ui-ux/01-tokens.md`
- `chat-query.design-ui-ux/02-componentes.md`
- `chat-query.design-ui-ux/05-layout-responsividade.md`
- `chat-query.design-ui-ux/06-ux-animacoes.md`
- `chat-query.design-ui-ux/07-governanca.md`
- `update/guias/03-sprint-chat-frontend.md`

Regra operacional: usar somente tokens de `src/index.css`. Nao criar hex, sombra, radius, spacing ou gradiente hardcoded fora dos tokens.

## 2. Principio visual da tela

O chat e uma superficie de trabalho, nao uma landing page. A prioridade e velocidade de leitura, controles previsiveis e estados claros para midia.

Aplicar o estilo White Minimalist SaaS / Soft UI:

- Fundo principal: `var(--color-bg-base)`.
- Superficies de header, composer, popover e tiles: `var(--color-surface-1)` ou `var(--color-surface-2)`.
- CTA principal: laranja `var(--color-primary-500)` apenas para enviar/confirmar.
- Acoes auxiliares: botoes icon-only ghost/outline com Lucide icons e tooltip.
- Tags: pills compactas, sem brilho/neon, sem cor solida pesada.
- Movimento: transicoes via `var(--duration-*)` e `var(--ease-*)`; nao animar width/height para estados frequentes.

Antipatterns proibidos nesta sprint:

- Gradiente em botoes, header, bolhas ou composer.
- Branco puro como background da pagina.
- `service_role`, Evolution API key ou base64 grande no frontend.
- Controles sobrepostos em mobile.
- Tags com catalogo duplicado.
- Upload que bloqueia a conversa inteira sem feedback.

## 3. Estrutura alvo

Desktop:

```text
+----------------------------+-----------------------------------------------+
| Conversas                  | Header: lead, instancia, tags, IA, detalhes   |
| 320px aprox.               +-----------------------------------------------+
| busca global ja vem topbar |                                               |
| lista de leads             | Lista de mensagens                            |
| tags/resumo compacto       | texto + imagens + audio + documentos          |
|                            |                                               |
|                            +-----------------------------------------------+
|                            | Composer: anexar, audio, texto, enviar        |
+----------------------------+-----------------------------------------------+
```

Mobile:

```text
+------------------------------------------------+
| Header compacto: voltar/conversa/acoes          |
| Tags em scroll horizontal                       |
+------------------------------------------------+
| Mensagens                                       |
+------------------------------------------------+
| Tray de upload/gravacao quando existir          |
| [paperclip] [mic] textarea flex [send]          |
+------------------------------------------------+
```

Regras de layout:

- Container da pagina: usar altura baseada em `var(--layout-topbar-height)`, nao `4rem` fixo.
- `LeadSidebar`: largura desktop entre 300 e 340px; em mobile virar drawer/lista separada ou ser ocultada quando uma conversa estiver aberta.
- `ChatHeader`: altura visual entre 64 e 88px; quando tags quebrarem linha, crescer de forma controlada.
- `MessageList`: area flexivel, scroll proprio, padding com tokens.
- `ChatInput`: sticky no rodape do painel, superficie `surface-1`, sem deslocar botoes ao digitar.

## 4. ChatHeader e tags

Criar ou evoluir um componente dedicado, por exemplo `ConversationTags`, dentro do `ChatHeader`.

Anatomia:

```text
[avatar] Lead name
         instancia/status
         [tag] [tag] [tag] [+]

                                      [IA] [detalhes]
```

Comportamento:

- Exibir ate 3 tags no header desktop antes de colapsar em `+N`.
- Em mobile, tags entram em linha horizontal com scroll sem mostrar scrollbar.
- Botao de adicionar/remover: icon-only `Plus` ou `Tags`, 32px, ghost, tooltip "Editar tags".
- Remocao rapida: `X` dentro da pill apenas em hover/focus no desktop; sempre visivel no popover.
- Popover de edicao: largura 320px desktop, `min(calc(100vw - 32px), 320px)` mobile.
- Popover contem busca, lista com checkbox, estado vazio, loading e erro.

Estilo de tag:

```text
base: bg surface-3, border default, text gray-700, radius-full, mono 12px
urgencia 1: success-bg + success-600
urgencia 2: bg-muted/surface-3 + gray-600
urgencia 3: error-bg + error-600
urgencia 4: warning-bg + warning-600
```

Nao reutilizar estilos neon de urgencia no header. Eles geram ruido visual e quebram a governanca Soft UI.

Dados:

- Reaproveitar `crm.tags` e `crm.lead_tags`.
- O projeto ja tem tags em `useAutomationCatalog`; preferir extrair `useTagsCatalog` e fazer `useAutomationCatalog` consumir esse hook, ou criar um hook reutilizavel equivalente.
- Criar `useLeadTags(leadId)` para tags da conversa, add/remove e refetch.
- Apos mutacao de tag, chamar `notifyLeadsUpdated()` para a sidebar refletir o novo resumo.

## 5. Composer de mensagem

O `ChatInput` deve continuar enviando texto com Enter e quebra de linha com Shift+Enter. A Sprint 3 adiciona anexos e audio sem transformar o composer em um painel pesado.

Anatomia padrao:

```text
+--------------------------------------------------------------+
| [tray de anexos ou gravacao, somente quando necessario]       |
| [paperclip] [mic] [textarea flexivel................] [send] |
+--------------------------------------------------------------+
```

Botoes:

- `Paperclip`: abre input de arquivo oculto. Ghost icon button 40px.
- `Mic`: inicia gravacao. Ghost icon button 40px.
- `SendHorizontal`: unico botao solid/laranja quando pode enviar.
- `X`: cancela upload, arquivo selecionado ou gravacao.
- `Square` ou `CircleStop`: para finalizar gravacao antes de enviar.

Estados do composer:

- `idle`: textarea + botoes.
- `typing`: send habilitado se texto tiver conteudo.
- `file-selected`: tray acima do input com tile do arquivo antes do upload.
- `uploading`: progress bar, nome do arquivo, tamanho e botao cancelar desabilitado se nao houver cancelamento real.
- `upload-error`: tile com `AlertCircle`, mensagem curta e acao `Retry`.
- `recording`: barra compacta com ponto vermelho semantico, timer, cancelar e finalizar.
- `recorded`: tile de audio com preview e acoes cancelar/enviar.
- `sending`: send em loading, controles de edicao desabilitados parcialmente.
- `mic-denied`: helper em `error-600`, sem modal obrigatorio.

Regras de estabilidade:

- Icon buttons sempre 40x40.
- Textarea min 24px, max 150px como hoje, mas sem empurrar os botoes para fora.
- Tray de previews deve ter max-height e scroll interno se houver mais de um item.
- V1 deve assumir 1 anexo por mensagem porque o backend atual recebe `attachment` singular em `/api/chat/send-manual`. A UI pode ser preparada para lista, mas o envio precisa respeitar o contrato vigente.

Arquivos aceitos:

- Imagens: jpeg, png, webp, gif, heic, heif.
- Audio: mpeg, mp4, aac, ogg, opus, wav, webm.
- Documentos: pdf, txt, csv, doc, docx, xls, xlsx, ppt, pptx, rtf.
- Limite: 100 MB. Validar antes de pedir signed upload URL.

## 6. Upload e envio

Contrato backend ja disponivel:

- `POST /api/chat/attachments/upload-url`
- `POST /api/chat/send-manual`
- `GET /api/chat/leads/:leadId/messages`

Fluxo visual e tecnico:

1. Usuario escolhe arquivo ou finaliza gravacao.
2. Frontend valida MIME type e tamanho.
3. Frontend chama `POST /api/chat/attachments/upload-url`.
4. Frontend envia o arquivo ao Storage com `uploadToken`/signed URL retornado pelo backend.
5. Frontend chama `POST /api/chat/send-manual` com `content` opcional e `attachment`.
6. `useChat` refaz leitura por `GET /api/chat/leads/:leadId/messages`.

Payload de envio de anexo esperado:

```ts
{
  leadId: string;
  content?: string;
  instanceName?: string | null;
  attachment: {
    messageId: string;
    attachmentId: string;
    storagePath: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    kind: "image" | "audio" | "document";
  };
}
```

O frontend nao deve:

- Montar `storagePath` manualmente.
- Chamar Evolution diretamente.
- Persistir arquivo como base64.
- Guardar signed URL como estado permanente.

## 7. Lista e bolhas de mensagem

`MessageList` deve suportar mensagens antigas de texto puro e mensagens novas com anexos.

Contrato de mensagem vindo do backend:

```ts
type ChatMessageResponse = {
  id: string;
  leadId: string;
  content: string;
  direction: string;
  directionCode: number;
  sentAt: string;
  leadName: string;
  senderName: string | null;
  providerStatus?: string | null;
  attachments: Array<{
    id: string;
    kind: "image" | "audio" | "document";
    mimeType: string;
    fileName: string;
    fileSize: number;
    downloadUrl: string | null;
    expiresAt: string | null;
    storageDeletedAt: string | null;
  }>;
};
```

Renderizacao:

- Texto e anexos podem coexistir.
- Texto puro outbound pode manter bolha laranja atual.
- Mensagens com midia devem priorizar legibilidade do anexo; usar tile interno `surface-1/surface-2` quando o fundo laranja prejudicar audio/documento.
- Inbound: bolha `surface-1`, border default, shadow-sm.
- Outbound: acento primario claro, tail atual, timestamp legivel.
- Timestamps em mono/12px ou 10px, sem competir com o conteudo.

Anexos:

- Imagem: thumbnail clicavel, radius `var(--radius-xl)`, largura maxima 280px desktop e 220px mobile.
- Imagem expirada/deletada: tile com `ImageOff`, texto "Imagem expirada" e sem link quebrado.
- Audio: player nativo HTML5 com `preload="metadata"`, largura estavel e fallback quando URL expirar.
- Documento: tile compacto com `FileText`, nome truncado, tamanho, `ExternalLink`/`Download` quando houver URL.
- Arquivo sem URL: estado disabled com motivo curto.

Scroll:

- Ao carregar conversa, ir ao fim.
- Ao chegar mensagem nova, auto-scroll somente se usuario ja estava proximo do fim.
- Se usuario estiver lendo mensagens antigas, mostrar pill discreta "Novas mensagens" no rodape da lista.

## 8. Componentes e hooks sugeridos

Componentes:

- `src/components/chat/ConversationTags.tsx`
- `src/components/chat/AttachmentPreviewTray.tsx`
- `src/components/chat/MessageAttachment.tsx`
- `src/components/chat/AudioRecorderPanel.tsx` se o estado ficar grande.

Hooks:

- `src/hooks/useChat.ts`: leitura pelo endpoint backend com anexos; fallback texto puro se necessario.
- `src/hooks/useChatAttachments.ts`: upload-url, upload ao Storage, retry e cancelamento visual.
- `src/hooks/useAudioRecorder.ts`: MediaRecorder, timer, permissao, blob final.
- `src/hooks/useTagsCatalog.ts`: catalogo compartilhado de tags.
- `src/hooks/useLeadTags.ts`: tags atuais do lead e mutacoes.

Tipos:

- Criar `src/types/chat.ts` para anexos e mensagens novas.
- Evitar inflar `src/types/index.ts`.
- Mapear camelCase do backend para uma unica forma interna no hook, para nao espalhar `sentAt`/`sent_at` pelo UI.

## 9. Classes e tokens recomendados

Preferir classes existentes quando bastarem:

- `btn-solid`, `btn-outline`, `btn-ghost`
- `soft-input`
- `focus-ring`
- `shadow-sm`, `shadow-md`, `shadow-primary`, `shadow-focus`
- `card`, `section-label`

Classes novas podem ser adicionadas em `src/index.css` quando reduzirem repeticao real:

```css
.chat-tool-button {
  width: var(--height-input-md);
  height: var(--height-input-md);
  border-radius: var(--radius-lg);
}

.chat-tag-pill {
  border: var(--border-width-sm) solid var(--border-default);
  border-radius: var(--radius-full);
  background-color: var(--color-surface-3);
  color: var(--color-gray-700);
}

.chat-attachment-tile {
  border: var(--border-width-sm) solid var(--border-default);
  border-radius: var(--radius-xl);
  background-color: var(--color-surface-1);
  box-shadow: var(--shadow-sm);
}
```

Se criar CSS novo, usar apenas tokens e manter estados hover/focus/disabled.

## 10. Acessibilidade

- Todo botao icon-only precisa de `aria-label` e tooltip.
- `input[type=file]` oculto deve ser acionado por botao acessivel.
- `Mic` deve anunciar estados: "Iniciar gravacao", "Gravando", "Parar gravacao".
- Erros de permissao de microfone devem aparecer perto do controle que falhou.
- Focus visivel com `shadow-focus`.
- Popover de tags deve permitir busca e selecao por teclado.
- Nao esconder informacao critica apenas em hover.

## 11. Ordem de implementacao visual

1. Criar tipos em `src/types/chat.ts`.
2. Atualizar `useChat` para endpoint com anexos, mantendo texto puro.
3. Criar `MessageAttachment` e adaptar `MessageBubble`.
4. Criar upload de arquivo no `ChatInput` com tray e estados.
5. Criar `useAudioRecorder` e painel de gravacao.
6. Criar `useTagsCatalog`, `useLeadTags` e `ConversationTags`.
7. Ajustar responsividade do chat inteiro.
8. Rodar lint/build e teste visual desktop/mobile.

## 12. Checklist de aceite visual

- [ ] Texto antigo renderiza igual ou melhor.
- [ ] Anexo aparece com estado selecionado, uploading, enviado e erro.
- [ ] Audio grava, cancela e envia sem sobrepor controles.
- [ ] Documento longo trunca nome sem quebrar layout.
- [ ] Imagem expirada mostra fallback claro.
- [ ] Tags aparecem no header e podem ser editadas sem duplicar catalogo.
- [ ] Header nao quebra quando lead, instancia ou tags sao longos.
- [ ] Composer mantem botoes alinhados com textarea de varias linhas.
- [ ] Mobile 360px nao tem overflow horizontal incoerente.
- [ ] Todos os novos botoes tem tooltip, aria-label e focus visivel.
- [ ] Sem hex/shadow/radius hardcoded fora de `src/index.css`.
- [ ] `npm run lint` e `npm run build` passam ou as dividas existentes ficam registradas.
