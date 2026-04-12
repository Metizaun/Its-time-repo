# PRD — Feature: Buscar Leads
> Integração com Apify Google Maps Scraper para prospecção de leads direto no CRM

---

## Contexto

O CRM já possui a tabela `crm.leads` com os campos necessários. Esta feature adiciona uma tela de busca que consulta a API Apify (Google Maps Scraper), exibe os resultados em mapa interativo, e insere os leads encontrados com `status = 'Novo'` na base de dados, ignorando duplicatas.

---

## Objetivo

Permitir que o usuário busque empresas/negócios no Google Maps via Apify, visualize os resultados em mapa, e importe-os como leads novos com um clique.

---

## Schema relevante

```sql
-- Tabela destino
crm.leads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name varchar(255) NOT NULL,
  contact_phone varchar(50) NOT NULL,
  status varchar(50) DEFAULT 'Novo',
  email text,
  last_city varchar(100),
  last_region varchar(100),
  last_country varchar(10),
  Fonte text,
  Plataform text,
  instancia varchar,  -- FK crm.instance.instancia
  aces_id integer,    -- FK accounts.id
  created_at timestamptz DEFAULT now()
)

-- Unicidade: (contact_phone, aces_id)
-- Duplicatas devem ser silenciosamente ignoradas (INSERT ... ON CONFLICT DO NOTHING)
```

---

## Design

O design usa a mesma linguagem visual do app (flat, sem gradientes, superfícies brancas, bordas 0.5px). Referência exata do protótipo aprovado:

- Layout em duas colunas: formulário à esquerda, mapa + resultados à direita
- Mapa interativo (Google Maps JS API ou Mapbox) centralizado na cidade/região digitada, com círculo de raio animado
- Sliders para raio, avaliação mínima e máximo de resultados
- Chips clicáveis para selecionar dados a coletar (toggle visual: fundo `#E6F1FB`, texto `#185FA5`)
- Resultados aparecem como cards compactos com nome, estrelas, telefone e badge "Novo"
- Barra de progresso durante o scraping
- Contador mensal no topo da tela (ver abaixo)

### Contador mensal de scraps

Exibir no topo da tela, em destaque, o total de leads buscados via Apify no mês corrente. Buscar via `COUNT(*)` na `crm.leads` onde `Fonte = 'Apify'` e `created_at >= início do mês ativo` e `aces_id = aces_id do usuário logado`.

```
┌─────────────────────────────────────────┐
│  Buscas este mês   [  142 leads ]        │
└─────────────────────────────────────────┘
```

---

## Inputs do formulário (mapeados ao Apify input schema)

| Campo UI | Parâmetro Apify | Tipo | Observação |
|---|---|---|---|
| Termos de busca | `searchStringsArray` | `string[]` | Split por vírgula |
| Cidade / Região | `locationQuery` | `string` | Ex: "São Paulo, SP" |
| País | `country` | `string` | Código ISO: BR, PT, US |
| Raio de busca | `radiusKm` | `number` | Slider 1–50km |
| Avaliação mínima | `minimumStars` | `number` | Slider 1.0–5.0, step 0.5 |
| Máximo de resultados | `maxCrawledPlacesPerSearch` | `number` | Slider 10–500, step 10 |
| Idioma | `language` | `string` | pt, en, es |
| Dados a coletar | Campos do output | `boolean[]` | telefone, website, email, horários, reviews, fotos, preços |
| Instância | `instancia` | `string` | FK para `crm.instance` |

---

## Fluxo de implementação

### 1. Rota de backend: `POST /api/leads/buscar`

```typescript
// Payload recebido do frontend
{
  searchStrings: string[],
  locationQuery: string,
  country: string,
  radiusKm: number,
  minimumStars: number,
  maxResults: number,
  language: string,
  fields: string[],      // campos selecionados pelos chips
  instancia: string,
  aces_id: number
}
```

**Passos internos:**

1. Montar o input para a Apify API:
```typescript
const apifyInput = {
  searchStringsArray: payload.searchStrings,
  locationQuery: payload.locationQuery,
  country: payload.country,
  radiusKm: payload.radiusKm,
  minimumStars: payload.minimumStars,
  maxCrawledPlacesPerSearch: payload.maxResults,
  language: payload.language,
  includeWebResults: false,
}
```

2. Chamar a Apify API (actor `compass/crawler-google-places`):
```typescript
const APIFY_TOKEN = process.env.APIFY_API_TOKEN
const ACTOR_ID = 'nwua9Gu5YrADL7ZDj'

const runRes = await fetch(
  `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(apifyInput)
  }
)
const places = await runRes.json() // array de lugares
```

3. Para cada lugar retornado, mapear para o schema de leads:
```typescript
const leadsToInsert = places
  .filter(p => p.phone) // só inserir se tiver telefone
  .map(p => ({
    name: p.title,
    contact_phone: p.phone,
    email: p.email ?? null,
    last_city: p.city ?? null,
    last_region: p.state ?? null,
    last_country: payload.country,
    status: 'Novo',
    Fonte: 'Apify',
    Plataform: 'Google Maps',
    instancia: payload.instancia,
    aces_id: payload.aces_id,
  }))
```

4. Inserir ignorando duplicatas:
```sql
INSERT INTO crm.leads (name, contact_phone, email, last_city, last_region,
  last_country, status, "Fonte", "Plataform", instancia, aces_id)
VALUES (...)
ON CONFLICT (contact_phone, aces_id) DO NOTHING
RETURNING id, name, contact_phone, status;
```

5. Retornar ao frontend: lista de leads inseridos + total ignorados por duplicata.

### 2. Variáveis de ambiente necessárias

```env
APIFY_API_TOKEN=apify_api_xxxxxxxxxx
```

### 3. Rota de backend: `GET /api/leads/buscar/contador`

```typescript
// Retorna o total de leads importados via Apify no mês corrente
SELECT COUNT(*) as total
FROM crm.leads
WHERE "Fonte" = 'Apify'
  AND aces_id = :aces_id
  AND created_at >= date_trunc('month', now())
```

---

## Instruções para o Codex

> Leia estas instruções antes de qualquer implementação.

1. **Não altere nenhuma tabela existente.** A inserção usa `ON CONFLICT DO NOTHING` sobre a constraint única `(contact_phone, aces_id)`. Se essa constraint não existir, adicione-a via migration:
   ```sql
   ALTER TABLE crm.leads
   ADD CONSTRAINT leads_phone_account_unique UNIQUE (contact_phone, aces_id);
   ```

2. **Não crie novos schemas ou tabelas.** Tudo vai em `crm.leads`.

3. **O token Apify nunca deve ser exposto no frontend.** A chamada à API Apify é feita exclusivamente no backend.

4. **Siga o padrão de autenticação existente no projeto** — use o middleware de `aces_id` e autenticação que já existe nas outras rotas do CRM.

5. **Para o mapa**, use a biblioteca já instalada no projeto. Se não houver nenhuma, preferir `react-leaflet` com `leaflet` (open source, sem custo). Não instale Google Maps SDK sem confirmar com o time (tem custo).

6. **O frontend deve fazer polling ou usar SSE** para atualizar a barra de progresso enquanto o Apify processa — a chamada `run-sync` pode demorar minutos. Alternativa: usar `run` (assíncrono) e depois `GET /dataset/{datasetId}/items`.

7. **Teste de duplicata obrigatório**: antes de fazer o PR, rode um teste que insira o mesmo telefone duas vezes e confirme que apenas 1 registro é criado.

---

## Critérios de aceite

- [ ] Formulário funcional com todos os campos mapeados ao Apify
- [ ] Mapa exibe a região buscada com círculo de raio
- [ ] Resultados aparecem como cards após scraping
- [ ] Leads inseridos em `crm.leads` com `status = 'Novo'` e `Fonte = 'Apify'`
- [ ] Duplicatas ignoradas silenciosamente
- [ ] Contador do mês exibido no topo
- [ ] Token Apify nunca exposto no frontend
- [ ] Funciona com o `aces_id` do usuário logado
