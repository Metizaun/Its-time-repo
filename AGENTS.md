# Regras do repositório

## Supabase de produção

Quando o usuário disser **Supabase de prod**, **Supabase de produção** ou apenas
**Supabase** em um contexto de produção, o alvo canônico é o Supabase
self-hosted da VPS nova:

- SSH: `root@187.127.49.20`
- Container Docker do banco: `supabase-db`
- Banco PostgreSQL: `postgres`
- URL pública do stack Supabase: `https://supa.itstime.pro`

Este repositório (`chat-query`) é o repositório padrão associado a esse
ambiente.

### Como acessar

- Para SQL administrativo, preferir SSH até a VPS e `docker exec` no container
  `supabase-db`, usando `psql -U postgres -d postgres`.
- Antes de qualquer operação de escrita, confirmar o alvo com uma consulta de
  identidade (`current_database()`, `current_user` e versão do servidor) e
  verificar que o container esperado é `supabase-db`.
- Não expor a porta 5432 publicamente. Usar a conexão privada/SSH documentada
  pelos scripts em `ops/supabase-selfhost/`.
- Para migrations de produção, usar a URL privada do Postgres self-hosted em
  `SELFHOST_DB_URL` e os comandos com `--db-url`. Nunca usar `--linked` para
  esse ambiente.

### Segurança

- Nunca apontar produção para um projeto Supabase gerenciado, para o projeto
  remoto antigo ou para um banco local sem declarar explicitamente a mudança
  de ambiente.
- Nunca gravar senhas, `service_role`, `SUPABASE_DB_PASSWORD` ou URLs com
  credenciais neste arquivo, em commits ou em logs.
- Antes de mudanças destrutivas ou migrations em produção, seguir o runbook de
  release e executar os gates/backup previstos em
  `docs/releases/2026-09-14-production-runbook.md`.
- Em caso de ambiguidade sobre o ambiente, parar e confirmar o destino antes
  de executar SQL ou migrations.

Referências operacionais: `DEPLOY_VERCEL_VPS.md` e
`ops/supabase-selfhost/`.
