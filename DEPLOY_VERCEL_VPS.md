# Guia de Deploy: Backend na VPS

Cenario atual:
- Frontend ja publicado em `https://app.itstime.pro`
- Backend sera publicado em `https://api.itstime.pro` na VPS
- Supabase continua gerenciado externamente
- Redis e Postgres ja existem na VPS
- Evolution continua externa em `http://72.60.251.89:64970`

Use os valores reais do arquivo local [DEPLOY_ENV_VPS.local.md](C:/Users/lucas/Downloads/Meu%20projeto/Proejto/chat-query/DEPLOY_ENV_VPS.local.md).

## 1. Fluxo final

- O usuario acessa `https://app.itstime.pro`
- O frontend chama `https://api.itstime.pro`
- O backend conversa com Supabase, Redis e Evolution
- A Evolution envia webhooks para `https://api.itstime.pro/api/webhook/evolution`

## 2. O que ainda precisa existir

- DNS de `api.itstime.pro` apontando para a VPS
- a pasta do projeto enviada para a VPS
- permissao para rodar `sudo`

O resto pode ser preparado pelo script principal.

## 3. Arquivo de ambiente ja pronto

Arquivo criado localmente:
- `.env.vps.local`

Se voce subir a pasta inteira do projeto para a VPS, esse arquivo vai junto e o script principal copia ele para `.env.local` automaticamente.

Se voce for usar `git clone` em vez de subir a pasta inteira:
- crie manualmente `/opt/chat-query/.env.local`
- ou copie o conteudo de [DEPLOY_ENV_VPS.local.md](C:/Users/lucas/Downloads/Meu%20projeto/Proejto/chat-query/DEPLOY_ENV_VPS.local.md)

## 4. Comando principal

Assumindo Ubuntu ou Debian.

Depois de enviar a pasta do projeto para a VPS, rode da raiz do projeto:

```bash
sudo LETSENCRYPT_EMAIL=seuemail@dominio.com bash scripts/setup-backend-vps.sh
```

Esse e o comando principal que faz tudo:
- instala `nginx`, `git`, `node` e `pm2`
- copia `.env.vps.local` para `.env.local`, se existir
- configura o `nginx` para `api.itstime.pro`
- executa o deploy do backend
- sobe ou reinicia no `PM2`
- tenta emitir SSL com `certbot`
- valida o healthcheck da API

Se quiser rodar sem tentar SSL no primeiro momento:

```bash
sudo ENABLE_SSL=false bash scripts/setup-backend-vps.sh
```

## 5. Se preferir clonar com Git na VPS

```bash
cd /opt
sudo git clone https://github.com/Metizaun/Its-time-repo.git chat-query
sudo chown -R $USER:$USER /opt/chat-query
cd /opt/chat-query
```

Depois disso, crie o `.env.local` manualmente ou envie tambem o `.env.vps.local`, e rode:

```bash
sudo LETSENCRYPT_EMAIL=seuemail@dominio.com bash scripts/setup-backend-vps.sh
```

## 6. Arquivo `.env.local` na VPS

Se voce nao for subir a pasta inteira, crie o arquivo na raiz do projeto:

```bash
cd /opt/chat-query
nano .env.local
```

Preencha com os valores do documento local. Para o backend, os pontos principais sao:

```env
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
GEMINI_API_KEY=...
REDIS_URL=redis://localhost:6379
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
- `EVOLUTION_API_URL` deve ficar sem `/manager`
- `EVOLUTION_WEBHOOK_SECRET` pode ficar vazio no cenario atual
- o backend em `Project/IA` le o `.env.local` da raiz automaticamente

## 7. Scripts prontos

Arquivos criados:
- [scripts/setup-backend-vps.sh](C:/Users/lucas/Downloads/Meu%20projeto/Proejto/chat-query/scripts/setup-backend-vps.sh)
- [scripts/deploy-backend-vps.sh](C:/Users/lucas/Downloads/Meu%20projeto/Proejto/chat-query/scripts/deploy-backend-vps.sh)

O `setup-backend-vps.sh` faz o setup completo da VPS.

O `deploy-backend-vps.sh` faz o deploy recorrente do backend:
- `git pull` do `main`
- `npm ci` do backend
- `npm run build` do backend
- sobe ou reinicia a API no `PM2`
- testa `http://127.0.0.1:3000/health`

## 8. Proximos deploys na VPS

Depois que a VPS estiver pronta, os proximos deploys ficam simples:

```bash
cd /opt/chat-query
bash scripts/deploy-backend-vps.sh
```

Se o projeto na VPS nao tiver `.git`, o script automaticamente ignora a etapa de `git pull`.

Se a sua porta local da API nao for `3000`, rode assim:

```bash
cd /opt/chat-query
API_PORT=3001 bash scripts/deploy-backend-vps.sh
```

## 9. Conferencias apos o comando principal

Depois do setup completo, confira:

```bash
pm2 status
pm2 logs itstime-api --lines 100
curl http://127.0.0.1:3000/health
```

Depois valide externamente:

```bash
curl https://api.itstime.pro/health
```

Esperado:

```json
{
  "ok": true,
  "service": "crm-ai-backend"
}
```

## 10. O que precisa estar certo no frontend

Como o frontend ja esta na Vercel, so confirme:

```env
VITE_CRM_BACKEND_URL=https://api.itstime.pro
```

## 11. Checklist final

- `app.itstime.pro` abrindo normalmente
- `api.itstime.pro` apontando para a VPS
- `sudo LETSENCRYPT_EMAIL=... bash scripts/setup-backend-vps.sh` executado com sucesso
- `pm2 status` mostrando `itstime-api` online
- `https://api.itstime.pro/health` respondendo
- `CORS_ORIGINS=https://app.itstime.pro`
- `WEBHOOK_PUBLIC_BASE_URL=https://api.itstime.pro`

## 12. Testes manuais

Faça estes testes:

1. Abrir `https://app.itstime.pro`
2. Fazer login
3. Verificar se dashboard e leads carregam
4. Verificar se chamadas para `https://api.itstime.pro` respondem
5. Criar ou listar instancias
6. Gerar QR code
7. Confirmar se a Evolution consegue chamar `https://api.itstime.pro/api/webhook/evolution`
8. Testar envio manual de mensagem

## 13. Troubleshooting rapido

Se o frontend abrir mas nada carregar:
- confira `VITE_CRM_BACKEND_URL` na Vercel
- confira `CORS_ORIGINS` na VPS
- confira `https://api.itstime.pro/health`

Se a API nao subir:
- confira `pm2 logs itstime-api`
- confira se `/opt/chat-query/.env.local` existe
- confira se `SUPABASE_SERVICE_ROLE_KEY` e `EVOLUTION_API_KEY` estao corretas

Se QR code ou mensagens nao funcionarem:
- confira `EVOLUTION_API_URL=http://72.60.251.89:64970`
- nao use `/manager`
- teste:

```bash
curl http://72.60.251.89:64970
```

## 14. Resumo curto

Se voce enviar a pasta inteira do projeto para a VPS, o fluxo fica:

```bash
cd /caminho/do/projeto
sudo LETSENCRYPT_EMAIL=seuemail@dominio.com bash scripts/setup-backend-vps.sh
```

Depois disso, os proximos deploys ficam:

```bash
cd /opt/chat-query
bash scripts/deploy-backend-vps.sh
```
