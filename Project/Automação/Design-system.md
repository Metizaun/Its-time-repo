# Design System — Automação

> Referência visual e de interação para a página `Automação`. Este documento descreve apenas estrutura, hierarquia e comportamento do Kanban, sem definir cor.

---

## 1. Direção de interface

A página deve seguir a lógica visual da imagem de referência: um board horizontal, com colunas altas, cabeçalhos compactos e cartões empilhados que podem ser lidos rapidamente sem trocar de rota.

O módulo de automação não deve parecer uma tela de formulário tradicional. Ele deve funcionar como uma área operacional:

- leitura rápida das etapas do pipeline
- criação de automações a partir da própria coluna
- edição em modal, sem navegação
- visão resumida do que já está ativo em cada funil

---

## 2. Mapeamento visual do Kanban

Para respeitar o modelo já existente do repositório:

- cada **coluna** representa uma etapa já cadastrada em `pipeline_stages`
- cada **cartão** representa uma automação vinculada àquela etapa
- cada automação pode conter **mais de uma mensagem**

Na interface, o usuário enxerga primeiro o Kanban por etapa. A profundidade de cada automação fica no modal do cartão.

---

## 3. Estrutura da página

### 3.1 Cabeçalho

O topo da página deve ter três zonas:

- bloco esquerdo com título `Automação` e texto curto de apoio
- bloco central ou direito com a instância atualmente selecionada
- bloco de ações com:
  - `Configurar agente`
  - `Nova automação`

O botão `Configurar agente` abre a edição do agente de IA ligado à instância. Ele não compete visualmente com o board; funciona como uma ação de contexto da página.

### 3.2 Área do board

O board é a área principal da tela:

- rolagem horizontal obrigatória
- colunas com largura fixa e consistente
- alinhamento pelo topo
- altura suficiente para leitura contínua dos cartões
- colunas vazias continuam visíveis

A ordem das colunas deve seguir exatamente a ordem do pipeline do CRM.

---

## 4. Anatomia da coluna

Cada coluna deve repetir a mesma estrutura:

### 4.1 Header da coluna

- nome da etapa/funil
- contador de automações cadastradas
- ação rápida `+` para criar uma nova automação já presa àquela coluna

O header precisa ser curto e escaneável, como na imagem de referência.

### 4.2 Corpo da coluna

- lista vertical de cartões
- espaçamento constante entre cartões
- área clicável ampla
- possibilidade de rolagem interna apenas se a altura da coluna exigir

### 4.3 Rodapé da coluna

Ao final da lista, a coluna mantém uma ação persistente:

- `Adicionar automação`

Mesmo sem cartões, a coluna deve manter esse rodapé visível.

---

## 5. Anatomia do cartão de automação

O cartão precisa resumir a automação sem abrir todos os campos.

### 5.1 Faixa superior

- nome da automação
- status ativo/inativo
- atalho discreto para edição

### 5.2 Bloco de contexto

- instância usada no envio
- quantidade de mensagens configuradas
- resumo temporal da primeira mensagem da sequência

### 5.3 Prévia da sequência

Dentro do cartão, mostrar uma mini timeline das mensagens já cadastradas:

- no máximo 3 itens visíveis
- cada item mostra `quando` + início da mensagem
- se existirem mais mensagens, mostrar contador adicional (`+2 mensagens`)

### 5.4 Indicadores auxiliares

O cartão pode exibir marcadores simples para:

- existência de imagem anexada
- automação pausada
- instância sem agente configurado

O clique no cartão abre o modal completo da automação.

---

## 6. Comportamento do Kanban

### 6.1 Entrada principal

O usuário chega na página e já enxerga todas as etapas do pipeline como colunas.

### 6.2 Criar automação

Existem dois pontos de entrada:

- botão global `Nova automação`
- botão `+` dentro de uma coluna

Quando a criação começa pela coluna:

- a etapa já vem pré-selecionada
- a criação acontece dentro do contexto daquela etapa

### 6.3 Várias mensagens no mesmo funil

Uma automação pode conter várias mensagens. Esse encadeamento não precisa abrir uma nova página.

A gestão dessas mensagens acontece dentro do modal da automação, em formato de sequência vertical ordenada pelo tempo de envio.

### 6.4 Várias automações na mesma etapa

É permitido ter mais de uma automação na mesma coluna.

Deve existir um aviso de contexto no modal:

`Esta estrutura permite múltiplas automações na mesma etapa para uso futuro com tags. Tags não fazem parte desta implementação.`

---

## 7. Modal de edição do agente da instância

Esse modal é simples e focado.

### 7.1 Estrutura

- título com nome da instância
- subtítulo explicando que a configuração vale para o agente ligado àquela instância
- uma única área principal com `Textarea` grande
- rodapé com `Cancelar` e `Salvar`

### 7.2 Campo exibido

Nesta primeira entrega, o modal mostra apenas:

- prompt atual do agente

Nenhum outro ajuste de modelo, provider ou regras deve entrar aqui.

### 7.3 Comportamento

- abre como modal centralizado no desktop
- ocupa largura confortável para leitura de prompt
- no mobile pode assumir comportamento de tela cheia

---

## 8. Modal de criação e edição da automação

Esse modal concentra o fluxo real do produto.

### 8.1 Bloco de cabeçalho

- nome da automação
- etapa/funil selecionado
- instância responsável pelo envio
- toggle de ativo/inativo

### 8.2 Bloco de mensagens

As mensagens da automação aparecem como uma lista vertical ordenada:

- primeira mensagem no topo
- próximas mensagens abaixo
- cada item mostra tempo de envio e preview do texto
- ação de editar/remover em cada item
- ação final `Adicionar mensagem`

### 8.3 Formulário de mensagem

Ao criar ou editar uma mensagem, o formulário precisa conter:

- rótulo curto
- campo `Quando`
- campo de tempo em minutos
- textarea da mensagem
- upload opcional de imagem com preview

### 8.4 Regra visual do campo `Quando`

Para esta implementação, o campo `Quando` precisa ser simples:

- `Na entrada do funil`
- `Depois de`

Comportamento esperado:

- `Na entrada do funil` oculta ou desabilita o campo numérico e representa envio imediato
- `Depois de` exige um valor inteiro positivo em minutos

Isso mantém a interface compatível com o motor atual e evita cenários de horário no passado.

---

## 9. Ordenação e leitura

Dentro da automação, as mensagens devem ser exibidas em ordem crescente de envio:

- primeiro o envio imediato
- depois 5 minutos
- depois 15 minutos
- depois 1 hora

Essa ordem precisa aparecer tanto no modal quanto na prévia resumida do cartão.

---

## 10. Responsividade

### Desktop

- várias colunas visíveis ao mesmo tempo
- leitura panorâmica do board
- modais largos para edição

### Mobile

- board com swipe horizontal
- uma coluna por vez como foco principal
- ações principais sempre acessíveis
- modal da automação ocupando quase toda a tela

---

## 11. Componentes do repositório a reaproveitar

Para manter consistência com o projeto:

- `Card`
- `Button`
- `Badge`
- `Dialog`
- `Input`
- `Textarea`
- `Select`
- `Switch`
- `Separator`
- `Alert`
- `ScrollArea` se a coluna precisar de rolagem interna

O design da automação deve parecer uma evolução do repositório, não uma interface paralela.
