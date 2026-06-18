# Calendar + n8n V1 (Operacao)

Este documento descreve o contrato operacional para os workflows n8n que leem/escrevem em `public.calendar_events`.

## 1) Criacao de evento no n8n

- Tabela: `calendar_events`
- Operacao: `upsert`
- Chave de idempotencia: `(organization_id, external_event_id)`
- Campos minimos:
  - `organization_id`
  - `title`
  - `start_time`
  - `end_time`
  - `lead_id` **ou** `contact_id`
- Defaults recomendados:
  - `source = 'n8n'`
  - `status = 'scheduled'`
  - `followup_1h_enabled = true`

## 2) Polling follow-up (a cada 5 minutos)

### Buscar elegiveis

Filtro equivalente no Supabase node:
- `organization_id = <org do workflow>`
- `status IN ('scheduled','confirmed')`
- `deleted_at IS NULL`
- `followup_1h_enabled = true`
- `followup_1h_sent_at IS NULL`
- `start_time >= now() + interval '55 minutes'`
- `start_time < now() + interval '60 minutes'`

SQL de referencia:

```sql
select id, organization_id, title, start_time, end_time, lead_id, contact_id
from public.calendar_events
where organization_id = :organization_id
  and status in ('scheduled', 'confirmed')
  and deleted_at is null
  and followup_1h_enabled = true
  and followup_1h_sent_at is null
  and start_time >= now() + interval '55 minutes'
  and start_time < now() + interval '60 minutes'
order by start_time asc;
```

### Antes de enviar

```sql
update public.calendar_events
set followup_1h_status = 'processing',
    followup_1h_last_attempt_at = now(),
    followup_1h_error = null
where id = :event_id
  and organization_id = :organization_id;
```

### Sucesso de envio

```sql
update public.calendar_events
set followup_1h_status = 'sent',
    followup_1h_sent_at = now(),
    followup_1h_error = null
where id = :event_id
  and organization_id = :organization_id;
```

### Falha de envio

```sql
update public.calendar_events
set followup_1h_status = 'failed',
    followup_1h_error = :error_message,
    followup_1h_last_attempt_at = now()
where id = :event_id
  and organization_id = :organization_id;
```

## 3) Regras de seguranca

- 1 workflow por organizacao.
- Nao misturar `organization_id` no mesmo fluxo.
- Usar credencial Supabase com menor escopo possivel.
