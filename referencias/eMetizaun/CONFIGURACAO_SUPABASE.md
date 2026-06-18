# Configuração do Supabase

## ⚠️ IMPORTANTE: Projeto deve usar APENAS Supabase de Backend

Este projeto **NÃO deve usar** o Supabase do Lovable. Ele deve usar **APENAS** o Supabase de backend (projeto `hkqrgomafbohittsdnea`).

## Problema Identificado

Se você está recebendo erros como "No organizations found for user" ou não consegue criar tasks/leads, **o problema mais comum é que o frontend está conectado a um projeto Supabase diferente do banco de dados onde seus dados estão armazenados**.

### Como identificar o problema:

1. Abra o console do navegador (F12)
2. Procure por logs que começam com `useOrganizations: [DIAGNOSTIC]`
3. Se você ver:
   - `Connected to correct project: false` → Você está conectado ao projeto errado
   - `Current user ID matches expected: false` → O usuário autenticado não corresponde ao usuário no banco

**Solução:** Siga os passos abaixo para conectar ao projeto correto.

## Solução

### 1. Criar arquivo `.env.local`

Crie um arquivo `.env.local` na raiz do projeto com o seguinte conteúdo:

```env
# Supabase Configuration
# Projeto: hkqrgomafbohittsdnea
VITE_SUPABASE_URL=https://hkqrgomafbohittsdnea.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_Q7QBDFMNFtzZw9b3xfZJJQ_7SeUE7-q
```

**Nota:** Se a chave moderna não funcionar, use a legacy anon key:
```env
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrcXJnb21hZmJvaGl0dHNkbmVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzNjY1NjIsImV4cCI6MjA4NDk0MjU2Mn0.sZ2bYsyRmS_uR0rKQwiDS1gaF2NieE4oL4X3amFEi3c
```

### 2. Reiniciar o servidor de desenvolvimento

Após criar o arquivo `.env.local`, você precisa:

1. **Parar o servidor de desenvolvimento** (Ctrl+C)
2. **Reiniciar o servidor** (`npm run dev` ou `bun dev`)
3. **Fazer logout e login novamente** no aplicativo para autenticar no projeto correto

### 3. Verificar a conexão

Após fazer login, verifique o console do navegador. Você deve ver logs de diagnóstico como:

```
useOrganizations: [DIAGNOSTIC] Supabase URL: https://hkqrgomafboh...
useOrganizations: [DIAGNOSTIC] Expected URL: https://hkqrgomafbohittsdnea.supabase.co
useOrganizations: [DIAGNOSTIC] Connected to correct project: true
useOrganizations: [DIAGNOSTIC] Current user ID matches expected: true
```

**⚠️ IMPORTANTE:** Se você ver `Connected to correct project: false`, isso significa que:
- O arquivo `.env.local` não foi criado, OU
- O servidor não foi reiniciado após criar o arquivo, OU
- As credenciais no arquivo estão incorretas

**Solução:**
1. Verifique se o arquivo `.env.local` existe na raiz do projeto
2. Verifique se o conteúdo está correto (sem espaços extras, sem aspas)
3. **Pare completamente o servidor** (Ctrl+C)
4. **Inicie novamente** o servidor
5. **Limpe o cache do navegador** (Ctrl+Shift+Delete) ou use modo anônimo
6. **Faça logout e login novamente**

## Verificação Manual

Para verificar se está conectado ao projeto correto:

1. Abra o console do navegador (F12)
2. Procure por logs que começam com `useOrganizations: [DIAGNOSTIC]`
3. Verifique se a URL do Supabase está correta
4. Verifique se o ID do usuário corresponde ao esperado no banco de dados

## Troubleshooting

### Problema: Ainda não encontra organizações após configurar

**Solução:**
1. Limpe o cache do navegador e localStorage
2. Faça logout completo
3. Feche e reabra o navegador
4. Faça login novamente

### Problema: Erro de autenticação

**Solução:**
- Verifique se as credenciais no `.env.local` estão corretas
- Verifique se não há espaços extras nas variáveis
- Certifique-se de que o arquivo está na raiz do projeto

### Problema: Variáveis de ambiente não são carregadas

**Solução:**
- Certifique-se de que o arquivo se chama exatamente `.env.local` (com o ponto no início)
- Reinicie o servidor de desenvolvimento após criar/modificar o arquivo
- No Vite, variáveis devem começar com `VITE_` para serem expostas ao cliente
