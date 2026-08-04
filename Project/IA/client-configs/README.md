# Configuracoes versionadas de clientes

Esta pasta contem somente configuracao por cliente: manifesto, prompts e permissoes declarativas. O suporte generico para agentes internos fica no codigo do backend e nas migrations.

O aplicador e idempotente por `aces_id`, `instance_name`, `aces_id + cnpj`, `parent_agent_id` e `agent_key`. Ele nunca cria numero ou instancia de WhatsApp. Empresas declaradas no manifesto sao criadas ou atualizadas com seus dados cadastrais; profissionais continuam nas estruturas operacionais de Profissionais/Agenda.

Antes de aplicar, execute a migration e o `schema:check`. Para validar sem gravar:

```bash
npm run client-config:apply -- --config client-configs/cardeal/manifest.json --aces-id <ACES_ID> --instance <INSTANCE_NAME> --dry-run
```

Para aplicar, repita sem `--dry-run`. As variaveis `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` devem apontar para o ambiente desejado.
