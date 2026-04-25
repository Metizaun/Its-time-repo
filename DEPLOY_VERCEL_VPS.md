# Guia de Deploy: Backend com Traefik

Cenario atual:
- Frontend ja publicado em `https://app.itstime.pro`
- Backend sera publicado em `https://api.itstime.pro`
- A VPS ja usa `Docker Swarm + Traefik`
- Supabase continua gerenciado externamente
- Evolution continua externa em `http://72.60.251.89:64970`

Este guia segue o stack real da VPS. Nao usa `Nginx` nem `PM2`.

## 1. Fluxo final

- O usuario acessa `https://app.itstime.pro`
- O frontend chama `https://api.itstime.pro`
- O Traefik recebe `api.itstime.pro` e encaminha para o container do backend
- O backend conversa com Supabase, Redis e Evolution
- A Evolution envia webhooks para `https://api.itstime.pro/api/webhook/evolution`

## 2. Arquivos prontos no repositorio

Arquivos principais:
- [Project/IA/Dockerfile](C:/Users/lucas/Downloads/Meu%20projeto/Proejto/chat-query/Project/IA/Dockerfile)
- [docker-stack.backend.yml](C:/Users/lucas/Downloads/Meu%20projeto/Proejto/chat-query/docker-stack.backend.yml)
- [scripts/setup-backend-vps.sh](C:/Users/lucas/Downloads/Meu%20projeto/Proejto/chat-query/scripts/setup-backend-vps.sh)
- [scripts/deploy-backend-vps.sh](C:/Users/lucas/Downloads/Meu%20projeto/Proejto/chat-query/scripts/deploy-backend-vps.sh)

Arquivos de migracao relevantes para o backend atual:
- `supabase/migrations/20260418090000_add_automation_logic_engine_v2.sql`
- `supabase/migrations/20260420110000_add_manual_ai_override_to_lead_state.sql`
- `supabase/migrations/20260420130000_add_humanized_automation_dispatch.sql`
- `supabase/migrations/20260423113000_fix_automation_progress_and_ai_echo_freeze.sql`

Importante:
- o deploy da VPS nao aplica migrations do Supabase
- o banco do Supabase e externo ao Docker Swarm
- o script de deploy agora valida o schema esperado antes de publicar a stack
- se a validacao falhar, primeiro aplique as migrations pendentes no Supabase e so depois rode o deploy novamente
- se faltar a migration `20260423113000`, o backend pode pausar a IA por falso `human_webhook` e perder o reparo de echo

## 3. O que precisa existir na VPS

- DNS de `api.itstime.pro` apontando para a VPS
- rede do Traefik existente no Swarm
- repositorio em `/opt/chat-query`
- arquivo `/opt/chat-query/.env.local`

No seu caso, o padrao esperado e:
- rede Traefik: `lukas_net`
- cert resolver do Traefik: `letsencryptresolver`
- Redis Docker: `evolution_redis`

## 4. `.env.local` na raiz do projeto

O backend le o `.env.local` da raiz do repositorio.

Arquivo esperado:
- `/opt/chat-query/.env.local`

Campos minimos importantes:

```env
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
GEMINI_API_KEY=...
GEMINI_FALLBACK_MODELS=gemini-2.5-flash-lite
GEMINI_MAX_RETRIES=3
GEMINI_RETRY_BASE_DELAY_MS=1000
REDIS_URL=redis://evolution_redis:6379
EVOLUTION_API_URL=http://72.60.251.89:64970
EVOLUTION_API_KEY=ivXKb3NJ7dw3t4CGWcZ4qjjW43yRjkR8
EVOLUTION_WEBHOOK_SECRET=
WEBHOOK_PUBLIC_BASE_URL=https://api.itstime.pro
CORS_ORIGINS=https://app.itstime.pro
PORT=3000
NODE_ENV=production
AUTOMATION_WORKER_ENABLED=true
AUTOMATION_WORKER_POLL_MS=300000
AUTOMATION_WORKER_BATCH_SIZE=50
```

Observacoes:
- `EVOLUTION_API_URL` fica sem `/manager`
- `EVOLUTION_WEBHOOK_SECRET` pode ficar vazio
- `GEMINI_FALLBACK_MODELS` define os modelos de fallback quando o primario retornar `429/500/503/504`
- `GEMINI_MAX_RETRIES` e `GEMINI_RETRY_BASE_DELAY_MS` controlam retry com backoff para falhas transitórias do Gemini
- `REDIS_URL` precisa apontar para o Redis do Docker, nao para `localhost`
- no seu servidor, o valor detectado foi `redis://evolution_redis:6379`
- se preferir, voce pode manter `REDIS_URL` na env local de desenvolvimento e usar `REDIS_URL_FOR_CONTAINER=redis://seu-redis:6379` so na VPS

Para descobrir o nome do Redis no Swarm:

```bash
docker service ls | grep redis
```

Se o Redis estiver como container comum:

```bash
docker ps --format '{{.Names}}' | grep redis
```

Se o `.env.local` da VPS ainda estiver com `redis://localhost:6379`, o script tenta corrigir automaticamente para `redis://evolution_redis:6379`.

## 5. Comando principal

Se o projeto ja esta em `/opt/chat-query` e o `.env.local` ja existe:

```bash
cd /opt/chat-query
bash scripts/setup-backend-vps.sh
```

Esse comando faz:
- valida se o Swarm esta ativo
- valida se a rede `lukas_net` existe
- builda a imagem Docker do backend
- valida se o schema atual do Supabase esta compativel com esta versao do backend
- falha cedo se faltarem colunas ou RPCs esperadas
- publica a stack no Swarm
- registra a rota `api.itstime.pro` no Traefik
- tenta validar `https://api.itstime.pro/health`

Se o schema estiver atrasado, o deploy vai parar antes de publicar a stack. Nesse caso:
1. abra o SQL Editor do Supabase
2. aplique obrigatoriamente a migration `supabase/migrations/20260423113000_fix_automation_progress_and_ai_echo_freeze.sql`
2. aplique, nesta ordem:
   - `20260418090000_add_automation_logic_engine_v2.sql`
   - `20260420110000_add_manual_ai_override_to_lead_state.sql`
   - `20260420130000_add_humanized_automation_dispatch.sql`
3. rode novamente `bash scripts/setup-backend-vps.sh`

## 6. Se o nome da rede do Traefik mudar

Se a rede na sua VPS nao for `lukas_net`, rode assim:

```bash
cd /opt/chat-query
TRAEFIK_NETWORK=nome-da-sua-rede bash scripts/setup-backend-vps.sh
```

Se o nome do cert resolver nao for `letsencryptresolver`, rode assim:

```bash
cd /opt/chat-query
TRAEFIK_CERT_RESOLVER=nome-do-resolver bash scripts/setup-backend-vps.sh
```

## 7. Se quiser manter uma `REDIS_URL` diferente so no container

Isso e util quando seu `.env.local` ainda tem algo como `redis://localhost:6379`, mas o backend na VPS vai rodar em container.

Exemplo:

```bash
cd /opt/chat-query
REDIS_URL_FOR_CONTAINER=redis://evolution_redis:6379 bash scripts/setup-backend-vps.sh
```

## 8. Proximos deploys

Depois da primeira subida, os deploys seguintes ficam:

```bash
cd /opt/chat-query
bash scripts/deploy-backend-vps.sh
```

O script:
- faz `git pull` da `main` quando o repo tem `.git`
- rebuilda a imagem com uma tag nova
- valida o schema do Supabase dentro da imagem gerada
- reaplica a stack no Swarm
- espera o servico ficar saudavel

Se voce subir os arquivos manualmente e nao quiser `git pull`, rode:

```bash
cd /opt/chat-query
SKIP_GIT_PULL=true bash scripts/deploy-backend-vps.sh
```

## 9. Conferencias rapidas

Para conferir o deploy:

```bash
docker service ls
docker service ps itstime-api_api
docker service logs -f itstime-api_api
curl https://api.itstime.pro/health
```

Resposta esperada:

```json
{
  "ok": true,
  "service": "crm-ai-backend"
}
```

## 10. Checklist final

- `app.itstime.pro` abre normalmente
- `api.itstime.pro` aponta para a VPS
- `bash scripts/setup-backend-vps.sh` executa sem erro
- `docker service ls` mostra `itstime-api_api`
- `https://api.itstime.pro/health` responde
- `CORS_ORIGINS=https://app.itstime.pro`
- `WEBHOOK_PUBLIC_BASE_URL=https://api.itstime.pro`
- `REDIS_URL` ou `REDIS_URL_FOR_CONTAINER` apontam para o Redis Docker

## 11. Testes manuais

1. Abrir `https://app.itstime.pro`
2. Fazer login
3. Verificar dashboard e leads
4. Verificar chamadas para `https://api.itstime.pro`
5. Listar ou criar instancias
6. Gerar QR code
7. Confirmar webhook em `https://api.itstime.pro/api/webhook/evolution`
8. Testar envio manual de mensagem

## 12. Troubleshooting rapido

Se o deploy falhar:
- rode `docker service ps itstime-api_api --no-trunc`
- rode `docker service logs itstime-api_api --tail 100`
- se a falha mencionar `schema-preflight`, faltam migrations no Supabase

Se a URL publica nao responder:
- confira o DNS de `api.itstime.pro`
- confira se o Traefik esta na rede `lukas_net`
- confira se o cert resolver do Traefik se chama `letsencryptresolver`

Se o backend subir mas o frontend nao carregar dados:
- confira `VITE_CRM_BACKEND_URL=https://api.itstime.pro` na Vercel
- confira `CORS_ORIGINS=https://app.itstime.pro`
- confira `https://api.itstime.pro/health`
- confira se o deploy nao foi bloqueado pelo `schema-preflight`

Se QR code ou mensagens falharem:
- confira `EVOLUTION_API_URL=http://72.60.251.89:64970`
- teste:

```bash
curl http://72.60.251.89:64970
```

## 13. Resumo curto

Com o seu stack atual, o fluxo ficou:

```bash
cd /opt/chat-query
bash scripts/setup-backend-vps.sh
```

Se precisar informar um Redis Docker especifico:

```bash
cd /opt/chat-query
REDIS_URL_FOR_CONTAINER=redis://evolution_redis:6379 bash scripts/setup-backend-vps.sh
```

Depois, nos proximos deploys:

```bash
cd /opt/chat-query
bash scripts/deploy-backend-vps.sh
```
