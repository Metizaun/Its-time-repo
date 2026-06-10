# Sprint 3 - Refatoracao Front-end do Chat

## 1. Contexto

Sprint focada em transformar a experiencia do chat de texto puro em uma interface multimidia com audio, documentos e tags de conversa.

Tarefas de referencia:

- 3.1 Interface e logica de gravacao/envio de audio.
- 3.2 Envio de arquivos PDF, documentos e TXT conectado ao Storage.
- 3.3 Recurso de adicao de tags diretamente nas conversas do chat.

## 2. Diagnostico do codigo atual

### O que ja existe

- `src/pages/Chat.tsx` seleciona um lead e compoe sidebar, header, lista e input.
- `src/hooks/useChat.ts` busca mensagens via `rpc_get_chat`, assina realtime em `crm.message_history` e envia texto por `sendToWebhook`.
- `src/components/chat/ChatInput.tsx` possui textarea e botao de envio.
- `src/components/chat/MessageBubble.tsx` renderiza apenas texto.
- `src/components/chat/MessageList.tsx` agrupa mensagens por data.
- `src/components/leads/LeadSidebar.tsx` lista conversas/leads.
- Tags ja existem no schema (`crm.tags`, `crm.lead_tags`) e aparecem em catalogos de automacao.

### Lacunas

- Sem upload de arquivo no chat.
- Sem gravador de audio.
- Sem preview/progresso de upload.
- Sem renderizacao de anexo em bolha de mensagem.
- Sem tag visual por conversa dentro da tela de chat.
- Tipos `ChatMessage` nao modelam `attachments`.

## 3. Arquivos provaveis

| Arquivo | Motivo | Risco |
|---|---|---|
| `src/hooks/useChat.ts` | Expandir leitura/envio para anexos | Alto |
| `src/pages/Chat.tsx` | Passar handlers e estado de anexos/tags | Medio |
| `src/components/chat/ChatInput.tsx` | Botoes de anexo, audio e estados de upload | Alto |
| `src/components/chat/MessageBubble.tsx` | Renderizar audio, imagem e documento | Alto |
| `src/components/chat/MessageList.tsx` | Passar anexos e manter scroll correto | Medio |
| `src/services/webhookService.ts` | Enviar payload novo para backend | Medio |
| `src/types/index.ts` ou novo `src/types/chat.ts` | Tipos de mensagens/anexos | Baixo |
| `src/components/leads/LeadSidebar.tsx` | Exibir tags/resumo quando necessario | Medio |

## 4. Proposta tecnica

### Tipos de UI

Adicionar tipo especifico de chat, preferencialmente em novo arquivo `src/types/chat.ts` para evitar inflar `src/types/index.ts`.

```ts
export type ChatAttachmentKind = "image" | "audio" | "document";

export interface ChatAttachment {
  id: string;
  kind: ChatAttachmentKind;
  mimeType: string;
  fileName: string | null;
  fileSize: number | null;
  url: string | null;
  expiresAt: string | null;
}

export interface ChatMessageWithAttachments {
  id: string;
  lead_id: string;
  content: string;
  direction: string;
  direction_code: number;
  sent_at: string;
  lead_name: string;
  sender_name: string | null;
  attachments: ChatAttachment[];
}
```

### Entrada de mensagem

- `ChatInput` deve manter envio de texto.
- Adicionar botao de anexo com `<input type="file">` escondido.
- Tipos aceitos v1: imagens seguras, PDF, TXT e formatos comuns de documento.
- Adicionar gravacao via MediaRecorder API sem dependencia externa.
- Exibir estados: gravando, processando, enviando, erro de permissao de microfone e upload em andamento.

### Upload

- Upload deve usar contrato definido na Sprint 2.
- O frontend nao deve receber `service_role`.
- Para bucket privado, usar fluxo seguro definido na Sprint 2: signed upload URL, endpoint backend ou policy restrita por usuario.

### Renderizacao

- Imagem: thumbnail clicavel com fallback "imagem expirada" quando URL nula/expirada.
- Audio: player nativo HTML5 com duracao quando disponivel.
- Documento: card compacto com icone, nome, tamanho e acao de abrir/baixar se URL existir.
- Texto e anexos podem coexistir na mesma bolha.

### Tags no chat

- Reaproveitar `crm.tags` e `crm.lead_tags`.
- UI recomendada: area compacta no `ChatHeader` com tags atuais e botao para adicionar/remover.
- Nao duplicar catalogo de tags; criar hook reutilizavel se nao houver hook especifico.

## 5. Ordem de execucao

1. Confirmar que Sprint 2 entregou contrato de anexos e leitura.
2. Criar tipos de chat com anexos.
3. Atualizar `useChat` para consumir mensagens com anexos mantendo fallback para texto puro.
4. Adicionar upload de arquivo ao `ChatInput`.
5. Criar hook `useAudioRecorder` se a logica ficar grande.
6. Atualizar `MessageBubble` para renderizar anexos.
7. Integrar tags no `ChatHeader` ou componente dedicado.
8. Validar realtime com novas mensagens e anexos.

## 6. Criterios de aceite

- Usuario envia mensagem de texto como antes.
- Usuario grava audio, cancela antes de enviar e envia audio com sucesso.
- Usuario anexa PDF/TXT/documento e ve estado de upload/envio.
- Mensagens com anexos aparecem corretamente na lista.
- Imagens expiradas mostram fallback claro sem quebrar a conversa.
- Tags podem ser adicionadas/removidas no contexto do lead/conversa.
- UI funciona em desktop e mobile sem sobreposicao de controles.

## 7. Riscos e mitigacoes

| Risco | Probabilidade | Mitigacao |
|---|---|---|
| MediaRecorder indisponivel | Media | Detectar suporte e mostrar fallback |
| Upload lento travar input | Media | Estado de progresso, disable parcial e retry |
| Arquivo grande quebrar UX | Media | Limite de tamanho antes do upload |
| Tags ficarem inconsistentes | Media | Usar tabelas existentes e refetch/realtime |
| Signed URL expirar durante uso | Media | Renovar URL ao abrir/anexar quando necessario |

## 8. Testes

- `npm run lint`
- `npm run build`
- Testar Chrome, Edge e mobile para gravacao.
- Testar permissao negada de microfone.
- Testar envio de arquivo permitido e bloqueio de arquivo nao permitido.
- Testar conversa com texto puro antigo.
- Testar tags em lead com e sem tags existentes.

## 9. Pontos de atencao

- Nao enviar base64 grande diretamente pelo frontend para persistencia final.
- Nao renderizar HTML de documentos/textos; tratar como download/preview seguro.
- Garantir que textarea, botoes e previews nao redimensionem a barra inferior de forma instavel.

