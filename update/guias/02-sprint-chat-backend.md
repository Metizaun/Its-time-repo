# Sprint 2 - Core do Backend de Chat

## 1. Contexto

Sprint focada em preparar o backend do chat para cache, midias e limpeza automatizada. Esta sprint deve criar os contratos que a Sprint 3 usara no frontend.

Tarefas de referencia:

- 2.1 Implementar salvamento/cache de mensagens novas.
- 2.2 Desenvolver rotina para salvar imagens enviadas no chat no ambiente de cache/storage.
- 2.3 Criar rotina automatizada para apagar imagens do cache apos 7 dias corridos.

## 2. Diagnostico do codigo atual

### O que ja existe

- `Project/IA/api-server.ts` expoe `/api/chat/send-manual` e autentica usuarios com `AgentManager.authenticate`.
- `Project/IA/sdr-agent-gemini.ts` tem `sendManualMessage`, `saveMessage`, normalizacao de midia recebida, Redis para buffer e dedupe.
- `Project/IA/outbound-echo-registry.ts` usa Redis e Postgres para reconhecer ecos outbound.
- `Project/IA/package.json` ja inclui `ioredis`, `openai`, `@supabase/supabase-js` e `axios`.
- `crm.message_history` existe e e consumida por `rpc_get_chat`.
- `supabase/migrations/20260521205000_add_meta_whatsapp_foundation.sql` adiciona provider/status ao historico.

### Lacunas

- `sendManualMessage` aceita apenas texto.
- `saveMessage` grava apenas `content` e metadados basicos.
- `rpc_get_chat` retorna apenas campos textuais.
- Nao ha tabela de anexos, bucket/policies, signed URLs ou TTL de imagens.
- Redis atual e usado para buffer/echo, nao como cache de leitura de mensagens.

## 3. Arquivos provaveis

| Arquivo | Motivo | Risco |
|---|---|---|
| `Project/IA/api-server.ts` | Expandir endpoints de chat e validar payloads | Alto |
| `Project/IA/sdr-agent-gemini.ts` | Envio manual, persistencia e provider | Alto |
| `Project/IA/schema-preflight.ts` | Exigir novas tabelas/colunas em runtime | Medio |
| `Project/IA/whatsapp-provider.ts` | Formalizar envio de midia se necessario | Medio |
| `Project/IA/evolution-whatsapp-provider.ts` | Suporte a endpoint de midia Evolution | Alto |
| `supabase/migrations/*` | Tabelas/RPCs/policies de anexos e TTL | Alto |
| `src/hooks/useChat.ts` | Apenas se precisar adaptar contrato minimo para testes | Medio |

## 4. Proposta tecnica

### Contrato de persistencia

Criar uma tabela dedicada para anexos de mensagem, em vez de misturar JSON solto em `message_history`.

Contrato minimo recomendado:

```sql
crm.message_attachments (
  id uuid primary key,
  message_id uuid not null references crm.message_history(id) on delete cascade,
  aces_id integer not null,
  kind text not null check (kind in ('image', 'audio', 'document', 'text')),
  mime_type text not null,
  storage_bucket text not null,
  storage_path text not null,
  file_name text,
  file_size bigint,
  expires_at timestamptz,
  created_at timestamptz not null default now()
)
```

### Storage

- Usar Supabase Storage v1 com bucket privado `chat-attachments`.
- Caminho recomendado: `<aces_id>/<lead_id>/<message_id>/<attachment_id>-<safe-file-name>`.
- Imagens enviadas pelo chat devem ter `expires_at = now() + interval '7 days'`.
- Audio e documentos podem ter `expires_at` nulo inicialmente, salvo decisao posterior de retencao.

### API backend

- Manter `/api/chat/send-manual` compativel com texto.
- Criar caminho novo ou payload versionado para anexos, por exemplo:

```ts
{
  leadId: string;
  content?: string;
  instanceName?: string | null;
  attachments?: Array<{
    kind: "image" | "audio" | "document";
    mimeType: string;
    fileName: string;
    storagePath: string;
    fileSize: number;
  }>;
}
```

- Validar permissao do lead/instancia antes de associar qualquer anexo.
- Registrar mensagem e anexos em transacao logica: se envio externo falhar, nao deixar anexo como mensagem enviada sem estado claro.

### Cache

- Cache de leitura deve ser opt-in e invalidado por lead.
- Chave sugerida: `crm-chat:messages:<acesId>:<leadId>`.
- TTL curto para lista de mensagens, por exemplo 30 a 120 segundos.
- Insercoes novas devem invalidar o cache do lead.

### Limpeza automatizada

- Implementar rotina de limpeza de imagens expiradas com RPC/worker.
- A limpeza deve remover objeto do Storage e registro de anexo expirado.
- Nunca apagar `crm.message_history`; manter historico textual e substituir UI por estado "imagem expirada" quando necessario.

## 5. Ordem de execucao

1. Criar migration para `crm.message_attachments`, indices, grants e RLS.
2. Criar/validar bucket privado `chat-attachments` e policies.
3. Atualizar `schema-preflight.ts` para bloquear backend sem contrato novo.
4. Adicionar servico backend de anexos: validar path, inserir registro, gerar signed URL quando necessario.
5. Expandir leitura do chat via RPC nova ou endpoint backend com anexos.
6. Implementar cache Redis de leitura por lead com invalidacao.
7. Implementar rotina de limpeza de imagens expiradas.
8. Adicionar logs estruturados para envio, cache hit/miss e limpeza.

## 6. Criterios de aceite

- Mensagens de texto continuam funcionando sem mudanca de payload.
- Backend consegue associar anexo a mensagem existente ou nova com escopo por `aces_id`.
- `rpc_get_chat` permanece compativel ou ha RPC/endpoint novo documentado.
- Cache Redis acelera leitura sem servir dados de outro tenant.
- Imagens expiradas apos 7 dias sao removidas do Storage/anexos sem apagar historico textual.
- Falhas de Storage/provider retornam erro claro ao frontend.

## 7. Riscos e mitigacoes

| Risco | Probabilidade | Mitigacao |
|---|---|---|
| Quebrar envio manual atual | Media | Manter contrato textual compativel e cobrir teste manual |
| Vazamento de anexo entre contas | Alta | Escopo por `aces_id`, RLS, path isolado e signed URL |
| Cache servir dados obsoletos | Media | TTL curto e invalidacao apos insert |
| Limpeza apagar historico | Baixa | Limpeza atua apenas em Storage/anexos expirados |
| Evolution/Meta terem contratos de midia diferentes | Alta | Criar camada provider antes de expor UI |

## 8. Testes

- `npm --prefix Project/IA run build`
- `npm --prefix Project/IA run schema:check`
- Teste SQL/RPC para leitura de mensagens com e sem anexos.
- Teste de RLS com usuarios de contas diferentes.
- Teste de cache: primeira leitura miss, segunda hit, insert invalida cache.
- Teste de limpeza com anexo expirado e anexo nao expirado.

## 9. Pontos de atencao

- Antes de implementar Supabase Storage, consultar documentacao/changelog atual.
- Nao colocar `service_role` no frontend.
- Nao usar base64 grande como persistencia primaria; persistir no Storage.
- So liberar Sprint 3 quando o contrato de anexo estiver estavel.

