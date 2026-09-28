# Atacadão dos Óculos — Implantação

Escopo atual: **apenas Atacadão dos Óculos** (Optoclinic e Mais Visão ficam de fora por enquanto).

---

## 🔴 Pendências reais (falta coletar com o cliente)

### 1. Encaminhamento por assunto

Dentro do Atacadão, quais assuntos (reclamação, garantia, financeiro, comercial) vão para quais equipes ou pessoas.
O fluxo clínico já está resolvido: a IA não atende clínica, apenas encaminha para **(27) 99809-2427**.

---

### 2. Agenda

Definir:

* De onde vem a disponibilidade de datas/horários dos optometristas (qual sistema/API é consultado);
* Se o valor da consulta (R$ 49,90) é igual em todas as lojas ou varia por unidade.

Já sabido:

* Profissionais: optometristas;
* Horário: segunda a sábado, disponibilidade consultada dinamicamente (não fixa).

---

### 3. Pagamento — parcelamento

Já confirmado: Pix, dinheiro, cartão de débito, cartão de crédito.

Falta definir:

* Quantidade máxima de parcelas;
* Quantas parcelas são sem juros (os preços sugerem 12x, mas não está confirmado se é o teto nem se há juros);
* Se existe parcela mínima.

---

### 4. Cashback

Definir completamente a regra:

* Qual valor ou percentual;
* O que gera cashback e quando é gerado;
* Validade;
* Como o cliente consulta e utiliza;
* Valor mínimo e máximo;
* Produtos ou serviços que não participam;
* Qual sistema controla o cashback.

---

### 5. Cadência dos disparos (jornada pós-venda)

Jornada já identificada:

**Lead → Venda → Feedback → Cashback → Pós-venda → 6 meses → 1 ano**

Falta definir:

* Datas exatas (ex: D+1 feedback, D+7 cashback, D+30 pós-venda, 6 meses, 12 meses);
* Quando a automação começa e termina;
* Quando deve parar após resposta do cliente.

---

### 6. Tags

* Lista oficial definitiva (sugeridas até agora: cliente irritado, impaciente, ansioso — confirmar se ficam essas ou entram outras como Interessado, Orçamento, Garantia);
* Comportamento de cada tag: critério de aplicação, se é automática ou manual, se gera prioridade, encaminhamento ou automação.

---

### 7. Dados cadastrais

* CNPJ e razão social do Atacadão dos Óculos.

---

## ✅ Já confirmado / decidido

* **WhatsApp**: Free (API não oficial). Número principal: **(27) 99965-7979**.
* **IA Clínica**: não atende, apenas encaminha para **(27) 99809-2427**.
* **IA de cobrança**: RB (configuração feita depois).
* **Escolha de loja**: resolvida por padrão pela localização do cliente — não é uma pendência de regra de negócio.
* **Direcionamento/Encaminhamento**: a IA pode redirecionar atendimentos ativos para pessoas dentro e fora do app.
* **Disparo ativo**: haverá disparo ativo (detalhes de público/mensagem/frequência ficam fora do escopo por ora).
* **Cobertura de orçamento**: trabalhar exatamente com a política já informada — "cobre qualquer orçamento comprovado apresentado pelo cliente", sem regras adicionais de equivalência.
* **Preços por loja**: usar a tabela única já fornecida para toda a rede, sem diferenciação por cidade/unidade.
* **Promoções sazonais**: serão configuradas posteriormente, fora do escopo de coleta atual.
* **Consulta por CPF/telefone**: não existirá.
* **Óculos prontos (aviso de retirada)**: tratado por fora da IA, não entra no fluxo.
* **Disparo para novos leads**: fora de escopo por ora.

---

## 🏢 Sobre a marca

**Diferenciais**: armações e óculos de sol a partir de R$ 59,90, marca própria de armações (RayFay) e óculos de sol (Routti), marca própria de lentes, cobertura de qualquer orçamento comprovado, mais de 1.000 opções de armações (R$ 59,90 a R$ 200), manutenção gratuita.

**Missão**: democratizar o acesso aos óculos e às soluções ópticas, com produtos acessíveis, variedade e experiência de compra transparente e confiável.

**Valores**: acessibilidade, preço justo, variedade, transparência, qualidade, confiança.

**Cultura**: orientada a resultado, acessibilidade, simplicidade e proximidade com o cliente.

**Redes sociais / sites**:

* Instagram: @atacadaodosoculosbrasil
* Facebook: atacadaodosoculosbrasil
* Site: https://atacadaodosoculos.iaoticas.com.br/
* Linktree: https://linktr.ee/atacadaodosoculosbrasil

**Arquivos de referência recebidos**: Panfleto 2026 - Atacadão Óculos.pdf, Logo - Atacadão Óculos.pdf.

---

## 🏬 Lojas (18 unidades)

| Loja | Endereço | Cidade/UF | CEP |
|---|---|---|---|
| 01 | R. Santana do Iapó, n° 30, Muquiçaba | Guarapari/ES | 29215-020 |
| 02 | Av. Davinos Mattos, n° 457, Centro | Guarapari/ES | 29200-430 |
| 06 | Av. Dr. Roberto Calmom, n° 164, Centro | Guarapari/ES | 29200-340 |
| 07 | Av. Afonso Claudio, n° 01, Loja 02, Terra Vermelha | Vila Velha/ES | 29100-000 |
| 08 | Av. Vitória, Loja 2, Quadra 34, n° 13, Marcílio de Noronha | Viana/ES | 29100-000 |
| 09 | Av. Padre José de Anchieta, n° 1541, Aeroporto | Guarapari/ES | 29216-705 |
| 10 | R. Barra de São Francisco, Loja anexa loteria, Show center, Terra Vermelha | Vila Velha/ES | 29124-376 |
| 14 | Av. Carlos Lindenberg, n° 2339, Nossa Senhora da Penha | Vila Velha/ES | 29110-175 |
| 18 | Av. Professora Francelina Carneiro Setubal, n° 2001, Itapoa | Vila Velha/ES | 29101-641 |
| 19 | Rod. Jones dos Santos Neves, n° 799, Várzea Nova | Guarapari/ES | 29211-630 |
| 22 | R. João de Barros, n° 11, Ed. Irmã Deolinda, Porto Canoa | Serra/ES | 29168-680 |
| 24 | Av. Central, n° 1131, Parque Res. Laranjeiras | Serra/ES | 29165-130 |
| 27 | Rod. Jones dos Santos Neves, n° 02, Muquiçaba | Guarapari/ES | 29215-002 |
| 28 | Av. Jerônimo Monteiro, n° 1395, Centro | Vila Velha/ES | 29107-036 |
| 29 | Av. Dr. Roberto Calmom, n° 101, Centro | Guarapari/ES | 29200-340 |
| 32 | Av. Jerônimo Monteiro, n° 1326 – Letra A, Centro | Vila Velha/ES | 29100-400 |
| 33 | Av. Expedito Garcia, Quadra 7, n° 188, Campo Grande | Cariacica/ES | 29146-200 |

---

## 🛍️ Produtos e serviços

**Coleções**: óculos solar marca Routti; armações de grau marca RayFay.

**Tipos de lentes e tecnologias**: monofocais digitais, multifocais digitais Freeform, asféricas, antirreflexo (AR), Blue Control / filtro de luz azul, fotocromáticas (Transitions), proteção UV.

**Serviços prestados**: atendimento e consultoria óptica, venda de óculos de grau e sol, montagem de óculos, confecção de lentes de grau, ajuste e regulagem de armações, leitura e interpretação de receitas, orçamento personalizado, pós-venda e assistência ao cliente.

---

## 💰 Preços

**Ofertas fixas**:

* Armações: a partir de R$ 59,90
* Óculos de sol: a partir de R$ 59,90
* Óculos completo monofocal (armação + lente + AR): a partir de 12x de R$ 20,82
* Óculos completo monofocal com filtro azul (armação + lente + filtro azul + AR): a partir de 12x de R$ 32,07
* Óculos multifocal (armação + lente): a partir de 12x de R$ 30,40
* Óculos completo multifocal (armação + lente + AR): a partir de 12x de R$ 42,90

**Consulta**: a partir de R$ 49,90.

**Formas de pagamento**: dinheiro, cartão de crédito, cartão de débito, Pix.

**Valores das lentes — Monofocais / Visão Simples**:

1. Visão simples sem antirreflexo: a partir de R$ 92
2. Policarbonato visão simples: a partir de R$ 105
3. Visão simples com antirreflexo: a partir de R$ 170
4. Policarbonato com antirreflexo: a partir de R$ 185
5. Visão simples com AR + filtro azul: a partir de R$ 305
6. Visão simples com AR + fotocromático: a partir de R$ 336
7. Policarbonato com AR + filtro azul: a partir de R$ 370
8. Visão simples com AR + filtro azul + fotocromático: a partir de R$ 434
9. Esférica com antirreflexo: a partir de R$ 463
10. Esférica com AR + filtro azul: a partir de R$ 602
11. Lente Mil View: a partir de R$ 1.563

**Valores das lentes — Multifocais**:

1. Multifocal sem antirreflexo: a partir de R$ 285
2. Multifocal com antirreflexo: a partir de R$ 435
3. Multifocal com AR + fotocromático: a partir de R$ 622
4. Multifocal com AR + filtro azul: a partir de R$ 717

---

## 🛡️ Política de troca/garantia

* Armações: 3 meses de garantia contra defeitos de fabricação;
* Lentes sem antirreflexo: 1 ano;
* Lentes com antirreflexo de 3 camadas: 3 meses;
* Lentes com antirreflexo de 13 ou mais camadas: 1 ano.

Garantia válida exclusivamente para defeitos de fabricação — não cobre mau uso, acidentes, riscos, quebras ou uso inadequado.

---

## ⚪ Evolução futura / fora do escopo atual

* **Histórico de produtos comprados pelo cliente** — filtro solicitado, mas atualmente essa informação não está disponível para consulta pela IA. Registrado como funcionalidade desejada / evolução futura, não disponível na implantação atual.
* Estrutura Atacadão × Optoclinic × Mais Visão — fora de escopo por enquanto.
* Regras de preço por unidade/cidade — fora de escopo, usar tabela única.
* Promoções sazonais — configuração futura.
* Consulta por CPF/telefone — não existirá.
* Aviso de óculos prontos — tratado por fora da IA.
* Disparo para novos leads (público/mensagem/frequência) — fora de escopo por ora.
