# Régua Multifoco — combinações de tags e disparos de mensagem

> Guia de referência para montar, na tela **Automação**, 8 combinações prontas de
> funil (tag + etapa + tempo) com o texto de mensagem já escrito. Nenhuma delas usa
> recurso novo — todas nascem do mesmo motor de regras que a tela já tem hoje.

---

## 1. Como toda combinação é montada

Todo funil da tela Automação (`crm.automation_funnels` + `crm.automation_steps`) é
montado encaixando quatro peças:

| # | Peça | O que define | Exemplos |
|---|---|---|---|
| 1 | **Etapa do funil** (`stage_is` / `stage_in`) | Quem entra na régua | Novo, Em atendimento, Orçamento, Remarketing |
| 2 | **Tag do lead** (`tag_has`) | Filtro fino dentro da etapa | Multifocal, Lente Simples, Homem, Mulher… |
| 3 | **Âncora + tempo** (`anchor_event` + `delay_minutes`) | Quando dispara | Ao entrar na etapa, depois da minha última mensagem, ou depois da resposta do lead |
| 4 | **Condição de saída** (`exit_rule`) | O que encerra a régua | Quase sempre: *o lead respondeu* |

Tags são cadastradas livremente em `Crm.tags` (sem categoria fixa — só nome), então
o mesmo mecanismo serve para qualquer segmentação futura, não só as deste guia.

Essa estrutura já existe em produção: a migration
`supabase/migrations/20260818150202_create_cobranca_opaulo_pipeline.sql` cria uma
tag e um `automation_funnel` nesse exato formato (etapa + instância + regra de
saída) para a régua de cobrança da Óticas Paula — foi usada como referência real
para montar as combinações abaixo.

---

## 2. Tags para criar

Bastam cinco tags novas em `Crm.tags` para cobrir as oito combinações. O mesmo
cadastro pode ser reaproveitado depois para qualquer outra segmentação (tipo de
armação, cidade, ticket médio, etc.).

| Tag | Quando marcar | Usada em |
|---|---|---|
| `Multifocal` | Lead pediu ou recebeu orçamento de lente multifocal | Nutrição — Multifocal |
| `Lente Simples` | Lead pediu ou recebeu orçamento de lente de grau simples | Nutrição — Lente Simples |
| `Bifocal` | Lead pediu ou recebeu orçamento de lente bifocal | Nutrição — Bifocal |
| `Homem` | Lead identificado como público masculino | Segmentação — Masculino |
| `Mulher` | Lead identificado como público feminino | Segmentação — Feminino |

---

## 3. Nutrição por tipo de lente (3 mensagens)

**Condição comum:** etapa `Em atendimento` **ou** `Orçamento` + a tag do tipo de
lente. **Dispara:** 3 dias após a última resposta do lead (âncora = última
resposta), e cancela sozinha assim que ele responder de novo.

### 3.1 Nutrição — Multifocal
- Etapa: Em atendimento ou Orçamento
- Tag: `#Multifocal`
- Âncora: última resposta do lead + 3 dias · Encerra: lead respondeu

> Oi {nome}! Passando para lembrar que a lente multifocal elimina a necessidade de
> ficar trocando de óculos pra perto e pra longe — e a adaptação costuma levar só
> alguns dias com o acompanhamento certo. Posso separar um horário pra você
> experimentar e tirar suas dúvidas com o óptico?

### 3.2 Nutrição — Lente Simples
- Etapa: Em atendimento ou Orçamento
- Tag: `#Lente Simples`
- Âncora: última resposta do lead + 3 dias · Encerra: lead respondeu

> Oi {nome}, tudo bem? A lente de grau simples que conversamos já resolve certinho
> o seu dia a dia, com entrega rápida e o melhor custo-benefício da loja. Posso
> confirmar os dados da sua receita pra deixar tudo pronto?

### 3.3 Nutrição — Bifocal
- Etapa: Em atendimento ou Orçamento
- Tag: `#Bifocal`
- Âncora: última resposta do lead + 3 dias · Encerra: lead respondeu

> Oi {nome}! Sobre a lente bifocal: ela é uma ótima porta de entrada pra quem ainda
> não usou multifocal, com investimento menor. Se preferir, também mostro a versão
> multifocal, sem linha divisória aparente. Qual faz mais sentido pra você?

---

## 4. Funil de remarketing — reativação (2 mensagens)

Um único funil, disparado ao entrar na etapa `Remarketing`, com **dois passos na
mesma régua**. Se o lead cair em Remarketing de novo depois de reativado, o prazo
reinicia do zero (reentrada: reinicia o prazo).

### 4.1 Passo 1 — 15 dias depois de entrar na etapa
- Etapa: `Remarketing` · Âncora: entrou na etapa
- Encerra: lead respondeu · Reentrada: reinicia o prazo

> Oi {nome}! Faz um tempinho que a gente não se fala. Ainda está de olho em um
> óculos novo? Se quiser, te mando as novidades de armação e lente que chegaram
> por aqui.

### 4.2 Passo 2 — 60 dias depois de entrar na etapa (reativação / nova abertura)
- Etapa: `Remarketing` · Âncora: entrou na etapa
- Encerra: lead respondeu · Reentrada: reinicia o prazo

> Oi {nome}! Temos novidade por aqui: renovamos o estoque de armações e estamos
> com condições especiais de reabertura essa semana. Bora aproveitar pra fechar
> aquele óculos que você queria?

---

## 5. Follow-up de orçamento (1 mensagem)

Dispara sozinho, sem depender de tag — qualquer lead que entra na etapa
`Orçamento` recebe este toque rápido.

- Etapa: `Orçamento` · Âncora: entrou na etapa + 20 minutos
- Encerra: lead respondeu · Reentrada: reinicia o prazo

> Oi {nome}! Ficou alguma dúvida sobre o orçamento que te passei agora? Consigo
> detalhar as formas de pagamento ou ver uma condição especial pra você fechar
> hoje — é só me chamar.

---

## 6. Segmentação por público (2 mensagens)

**Condição comum:** etapa `Novo` **ou** `Em atendimento` + tag de gênero. Dispara
**na hora** em que a tag é marcada no lead — sem tempo de espera.

### 6.1 Segmentação — Masculino
- Etapa: Novo ou Em atendimento
- Tag: `#Homem`
- Âncora: imediato · Encerra: lead respondeu

> Oi {nome}! Aqui na loja temos armações com acabamento mais discreto e
> resistente, ideais pra quem usa óculos o dia inteiro, no trabalho ou dirigindo.
> Quer que eu separe algumas opções nesse estilo pra você ver?

### 6.2 Segmentação — Feminino
- Etapa: Novo ou Em atendimento
- Tag: `#Mulher`
- Âncora: imediato · Encerra: lead respondeu

> Oi {nome}! Chegaram armações novas com cores e formatos bem variados, do
> clássico ao mais moderno — dá pra combinar com o seu estilo do dia a dia. Quer
> que eu te mande fotos das novidades?

---

## 7. As tags se somam

Cada combinação acima usa uma tag por vez para ficar simples de montar. Mas o
motor aceita quantas condições você quiser no mesmo grupo (`operator: "all"`) —
dá pra cruzar tipo de lente com público no mesmo disparo sem criar nada novo no
sistema. Exemplo:

```
Etapa: Orçamento
  E  #Multifocal
  E  #Mulher
  →  mensagem só para quem pediu multifocal e é público feminino
```

---

## 8. Próximo passo

Cadastre as cinco tags em `Crm.tags` e monte cada seção acima como um funil na
tela Automação, usando a etapa e a âncora indicadas — o texto de cada mensagem já
está pronto para colar. Se preferir, também dá pra gerar isso direto como
migration SQL, no mesmo formato usado para a régua de cobrança da Óticas Paula
(`20260818150202_create_cobranca_opaulo_pipeline.sql`).
