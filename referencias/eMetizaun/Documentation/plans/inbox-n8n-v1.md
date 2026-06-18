# Inbox + n8n Contract (V1)

## Scope
- `n8n` writes directly to schema `inbox`.
- One workflow per organization (`organization_id` fixed per workflow).
- Idempotency for external messages via `inbox.messages.external_message_id`.

## Required Credentials
- Supabase URL: `https://hkqrgomafbohittsdnea.supabase.co`
- Service role key in n8n credentials (server-side only).

## 1) Upsert Conversation
Use when n8n needs a stable channel per external thread.

### Key
- `organization_id`
- `external_conversation_id` (unique per organization)

### Example Payload
```json
{
  "organization_id": "<org_uuid>",
  "type": "channel",
  "status": "open",
  "title": "Support - #12345",
  "external_conversation_id": "ext_thread_12345",
  "metadata": {
    "external_source": "whatsapp",
    "external_target": "n8n:webhook"
  }
}
```

### SQL Equivalent
```sql
insert into inbox.conversations (
  organization_id,
  type,
  status,
  title,
  external_conversation_id,
  metadata
)
values (
  :organization_id,
  :type,
  :status,
  :title,
  :external_conversation_id,
  :metadata::jsonb
)
on conflict (organization_id, external_conversation_id)
do update set
  title = excluded.title,
  status = excluded.status,
  metadata = excluded.metadata,
  updated_at = now()
returning id;
```

## 2) Insert Message (Idempotent)

### Rules
- `conversation_id` must belong to the same `organization_id`.
- Use:
  - `sender_kind = 'agent'` + `sender_agent_id` for AI replies, or
  - `sender_kind = 'external'` + `sender_external_id` for external origin.
- `external_message_id` must be stable from source system.

### SQL Equivalent
```sql
insert into inbox.messages (
  organization_id,
  conversation_id,
  sender_kind,
  sender_agent_id,
  sender_external_id,
  content,
  format,
  metadata,
  external_message_id
)
values (
  :organization_id,
  :conversation_id,
  :sender_kind,
  :sender_agent_id,
  :sender_external_id,
  :content,
  coalesce(:format, 'text'),
  coalesce(:metadata::jsonb, '{}'::jsonb),
  :external_message_id
)
on conflict (organization_id, external_message_id)
do update set
  content = excluded.content,
  metadata = excluded.metadata,
  updated_at = now()
returning id;
```

## 3) Optional: Outbound Queue for Dispatcher
When app user sends to AI/external, records can be queued in `inbox.outbound_events` for a dispatcher workflow.

Required fields:
- `organization_id`
- `conversation_id`
- `message_id`
- `event_type` (example: `message.created`)
- `target` (example: `n8n:webhook`)
- `payload` (json)

## 4) Realtime Expectation
- Frontend subscribes to:
  - `inbox.conversations`
  - `inbox.messages`
  - `inbox.mentions`
- New agent message inserted by n8n appears without manual refresh.

## 5) Safety Checklist
- Never mix tenants in a workflow.
- Always filter by fixed `organization_id`.
- Keep service role secret only in n8n backend.
