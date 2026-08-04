# Norte Visual — Agente principal, Subagente e Ferramentas

## 1. Finalidade do documento

Este documento é a fonte de verdade visual para as telas de Agentes e Ferramentas do CRM Its Time. A implementação deve reproduzir estritamente a linguagem visual, a hierarquia e as proporções observadas nas imagens:

- `referencias/Novo design.png` — 1672 × 941 px;
- `referencias/Ferramentas.png` — 1672 × 941 px;
- Design System `White Minimalist SaaS — Soft UI Edition`, usado apenas para completar estados e acessibilidade que não aparecem nas imagens;
- decisão de produto de manter os agentes principais lado a lado;
- largura compacta já aprovada para o agente principal;
- separação obrigatória entre agente, ferramentas e subagentes.

Este norte substitui as orientações anteriores de animação contínua. Não deve existir flutuação automática, gradiente animado, pulsação, entrada com movimento ou deslocamento permanente.

### Precedência visual obrigatória

1. `Novo design.png` governa o agente principal, a relação vertical entre proprietário e recursos e o formato do subagente.
2. `Ferramentas.png` governa os cards, ícones, distribuição, conectores e aparência do conjunto de ferramentas.
3. As decisões explícitas do produto governam os pontos que os mocks não demonstram: agentes principais lado a lado, largura compacta atual preservada, no máximo dois subagentes e botão circular `+` no lugar do losango.
4. O Design System governa somente detalhes ausentes nas imagens, como foco, contraste, responsividade e tokens.
5. Nenhum componente genérico existente pode alterar a silhueta, a ordem, a proporção ou a separação mostrada nas referências.

O Receituário é tratado neste documento como uma especialização do card de **Ferramenta**. Ele não cria um quarto tipo de bloco na hierarquia.

## 2. Princípios inegociáveis

1. Agente principal, ferramentas e subagentes são blocos visualmente independentes, como nas imagens.
2. Ferramentas nunca ficam dentro do box do agente principal.
3. Subagentes nunca ficam dentro do box do agente principal ou dentro do agrupamento de ferramentas.
4. Ferramentas de um subagente aparecem somente abaixo do respectivo subagente.
5. O botão circular `+` substitui o losango central e restaura a ação de adicionar ferramenta.
6. Quando não houver ferramentas, não mostrar textos como “Nenhuma ferramenta ativa”. Mostrar apenas a estrutura e o botão `+`.
7. Cada agente principal pode possuir no máximo dois subagentes.
8. Um subagente é centralizado e permanece menor que o agente principal; dois subagentes ficam lado a lado e reduzem proporcionalmente.
9. Não renderizar ferramentas fictícias para reproduzir os mocks. Somente ferramentas realmente vinculadas aparecem.
10. A largura compacta atual do agente principal deve ser preservada; o redesign não pode voltar ao card horizontal que atravessa quase toda a página.
11. Não utilizar badges.
12. Não exibir o nome do modelo de IA nos cards.
13. Não utilizar roxo.
14. Não utilizar animação autônoma em nenhum elemento.
15. Não transformar o conjunto em um painel com seções internas, divisórias ou caixas cinzas.
16. Não inverter a ordem visual: ferramentas do principal vêm abaixo dele; subagentes vêm abaixo das ferramentas; ferramentas de um subagente vêm abaixo do respectivo subagente.

## 3. Estrutura visual obrigatória

Cada agente principal é o início de um agrupamento visual, mas não é o container dos seus descendentes.

| Elemento | Referência dominante | Escala relativa | Silhueta obrigatória |
|---|---|---|---|
| Agente principal | `Novo design.png` | Maior | Retângulo horizontal arredondado |
| Subagente | Ambas as imagens | Intermediária | Cápsula horizontal |
| Ferramenta | `Ferramentas.png` | Menor | Retângulo horizontal baixo e arredondado |

A escala relativa acima é obrigatória em todos os breakpoints em que os elementos estiverem na mesma coluna visual: `agente principal > subagente > ferramenta`.

```text
[ Agente principal ]
          │
    Ferramentas  [+]
     │    │    │
  [Tool][Tool][Tool]
     [Tool][Tool]
          │
      Subagentes
  [Subagente 1] [Subagente 2]
        │              │
  [Tools dele]    [Tools dele]
```

Na página Agentes, até dois agrupamentos de agentes principais ficam lado a lado. Na página Ferramentas, o agrupamento selecionado pode ocupar uma área maior para exibir o catálogo e as relações com mais detalhe. A estrutura é uma árvore visual externa; não é um card principal com conteúdo aninhado.

---

# Agente principal — Design

## 4. Papel visual

O agente principal é o elemento de maior hierarquia dentro do agrupamento. Ele representa a entidade que possui canal e atende diretamente o cliente.

Ele não funciona como painel, modal ou container de ferramentas. Seu box termina imediatamente depois das informações do próprio agente.

## 5. Dimensões e limites

### Página Agentes — variante compacta aprovada

| Propriedade | Mínimo | Preferencial | Máximo |
|---|---:|---:|---:|
| Largura do agrupamento | 360 px | largura compacta atual | 520 px |
| Largura do card principal | 100% | 100% | 100% do agrupamento |
| Altura do card | 104 px | 112 px | 120 px |
| Padding horizontal | 20 px | 24 px | 24 px |
| Espaço entre ícone e texto | 12 px | 16 px | 16 px |

Regras:

- Não permitir que o card ultrapasse 520 px na página Agentes.
- Não reduzir o agrupamento abaixo de 360 px em desktop.
- A grade deve usar no máximo duas colunas.
- Só formar duas colunas quando cada agrupamento puder manter pelo menos 360 px e o gap definido.
- Abaixo desse espaço, usar uma coluna sem comprimir o conteúdo.
- Não permitir rolagem horizontal.
- A largura que já foi aprovada na tela atual é a referência de desktop. Os valores mínimo e máximo são apenas guardrails responsivos, não autorização para aumentar o card.

### Página Ferramentas — variante de leitura ampliada

O agente selecionado pode ocupar até 960 px, centralizado. Essa variante serve somente para explicar a relação entre agente, ferramentas e subagentes. Ela não substitui o tamanho compacto da página Agentes.

## 6. Geometria do card

- Formato: retângulo horizontal.
- Radius: `var(--radius-3xl)` — 24 px.
- Fundo: `var(--color-surface-1)` — `#FFFFFF`.
- Contorno: 1,5 px estático com degradê controlado.
- Sombra padrão: `var(--shadow-sm)`.
- Sombra no hover: `var(--shadow-md)`.
- Nenhum brilho externo colorido.
- Nenhum fundo em degradê.

### Fidelidade à imagem

- O card contém uma única linha principal: ícone à esquerda, identificação no centro e estado/ação à direita.
- Não existe cabeçalho interno, divisória, seção `Ferramentas`, seção `Subagentes` ou botão de adicionar dentro do contorno.
- O espaço interno é amplo, mas o card permanece compacto; nenhum dado pode aumentar sua altura acima de 120 px.
- Nome e instância truncam em uma linha. O card não cresce para acomodar texto longo.
- O contorno é fino e contínuo, com laranja no início e rosa no final, exatamente como em `Novo design.png`.
- O fundo branco, a sombra difusa e o contorno são estáticos.

### Degradê autorizado para os agentes

O contorno pode usar, como exceção editorial restrita:

```css
linear-gradient(
  90deg,
  #FF7A1A 0%,
  #FF4D5F 52%,
  #FF2D9A 100%
)
```

Esse valor deve ser registrado como token antes da implementação. É proibido repeti-lo diretamente nos componentes.

O degradê é sempre estático. Não usar `background-position`, `conic-gradient` rotativo ou qualquer keyframe.

## 7. Conteúdo interno

### Ícone

- Container: 56 × 56 px.
- Radius: 16 px.
- Fundo: `var(--color-surface-1)`.
- Borda: `var(--color-gray-100)`.
- Sombra: `var(--shadow-sm)`.
- Ícone de robô: 28 × 28 px.
- Traço: 2 a 2,25 px, cantos e terminações arredondados.
- Cor: degradê estático laranja → coral → rosa aplicado ao traço.
- Não utilizar emoji, ilustração 3D ou robô preenchido.

### Nome

- Exemplo: `Silvana - Oticas Cardeal`.
- Fonte: Inter.
- Tamanho compacto: 18 px.
- Peso: 700.
- Cor: `var(--color-gray-900)`.
- Uma linha, com reticências quando necessário.
- Nunca reduzir abaixo de 16 px para fazer o texto caber.

### Instância

- Exemplo: `CARDEAL-LOCAL-TEST`.
- Tamanho: 12 px.
- Peso: 600.
- Cor: `var(--color-gray-500)`.
- Caixa alta somente na apresentação.
- Não exibir IDs internos ou modelo de IA.

### Status

- Texto: `Ativo` ou `Pausado`.
- Tamanho: 12 px.
- Peso: 600.
- Ativo: `var(--color-success-600)`.
- Círculo: 8 × 8 px, `var(--color-success-500)`.
- O círculo não pulsa.
- Estado pausado usa texto e círculo neutros, sem vermelho decorativo.

### Ação de configuração

- Ícone: `Settings2`, 16 px.
- Cor padrão: `var(--color-gray-500)`.
- Área clicável mínima: 40 × 40 px.
- Deve possuir `aria-label` explícito.

## 8. Hover e movimento

O agente principal é um dos únicos elementos que pode ter deslocamento no hover.

Estado permitido:

```text
Default: shadow-sm, translateY(0)
Hover: shadow-md, translateY(-2px)
Pressed: shadow-inset, translateY(0)
```

- Duração máxima: 160 ms.
- Curva: `ease-out` ou token existente equivalente.
- Não alterar largura, altura, padding ou posição dos elementos próximos.
- Não animar o degradê.
- Não aplicar flutuação quando o ponteiro não estiver sobre o agente.
- Em `prefers-reduced-motion: reduce`, remover o deslocamento e manter somente a alteração instantânea de sombra.

---

# Ferramentas — Estrutura compartilhada

## 9. Posição e separação

As ferramentas do agente principal começam abaixo do card principal, fora de sua borda. Deve existir entre o card e o agrupamento:

- espaço vertical de 20 a 24 px;
- label `Ferramentas`;
- linha conectora vertical e ramificações tracejadas, quando ajudarem a leitura;
- botão circular `+` no ponto central de distribuição.

O botão `+` substitui o losango das imagens. Ele não é uma ferramenta e não usa formato de card.

Na reprodução final de `Ferramentas.png`, manter rigorosamente:

- label `Ferramentas` centralizada;
- haste vertical partindo da label;
- círculo `+` no ponto de ramificação que, no mock, contém o losango;
- linha horizontal tracejada distribuindo os cards;
- pequenos círculos sólidos nas terminações sobre cada ferramenta;
- primeira fileira com até três cards;
- segunda fileira com até dois cards centralizados;
- subagente separado abaixo de todo o conjunto, sem moldura de seção envolvendo os elementos.

## 10. Botão circular de adicionar ferramenta

- Diâmetro visual: 32 px.
- Área clicável mínima: 40 × 40 px.
- Formato: círculo perfeito.
- Fundo: `var(--color-surface-1)`.
- Borda: 1 px `var(--color-primary-500)`.
- Ícone `Plus`: 16 px, `var(--color-primary-500)`.
- Sombra: `var(--shadow-sm)`.
- Sem animação e sem rotação.
- Hover permitido somente como estado funcional de botão: mudança de fundo para `var(--color-primary-50)`, sem deslocamento.
- Focus visível: `var(--shadow-focus)`.
- `aria-label`: `Adicionar ferramenta ao agente [nome]`.

Comportamento:

1. Abrir o catálogo de ferramentas disponíveis.
2. Identificar claramente o agente proprietário da nova ferramenta.
3. Não listar ferramentas já vinculadas quando duplicação não for permitida.
4. Vincular a ferramenta ao agente correto.
5. Abrir a configuração quando ela exigir dados adicionais.
6. Atualizar o agrupamento após salvar.

Quando não existirem ferramentas disponíveis para adicionar, manter o botão visível em estado desabilitado e explicar o motivo por tooltip acessível.

## 11. Card de ferramenta

Ferramentas são menores e visualmente mais simples que qualquer agente.

### Variante compacta — página Agentes

| Propriedade | Valor |
|---|---:|
| Altura | 56 a 64 px |
| Largura | 150 a 220 px |
| Radius | 16 px |
| Padding horizontal | 12 a 16 px |
| Container do ícone | 36 a 40 px |
| Ícone | 20 a 22 px |
| Gap entre cards | 8 a 12 px |

Dentro do agrupamento compacto, usar até duas ferramentas por linha. O botão `+` permanece no conector central e não ocupa uma célula retangular.

### Variante ampliada — página Ferramentas

| Propriedade | Mínimo | Preferencial | Máximo |
|---|---:|---:|---:|
| Altura | 88 px | 104 px | 120 px |
| Largura | 280 px | 330 px | 390 px |
| Container do ícone | 48 px | 52 px | 56 px |
| Ícone | 24 px | 26 px | 28 px |

Distribuição desktop inspirada em `Ferramentas.png`:

- primeira linha: até três ferramentas;
- segunda linha: até duas ferramentas centralizadas;
- demais linhas repetem a grade sem criar buracos artificiais;
- o layout representa somente ferramentas reais.

### Acabamento

- Fundo: `var(--color-surface-1)`.
- Borda: 1 px em tom neutro quente e muito claro, equivalente visual a `var(--color-gray-100)`.
- Radius: `var(--radius-xl)` na versão compacta e `var(--radius-2xl)` na ampliada.
- Sombra: `var(--shadow-sm)`.
- Texto: `var(--color-gray-900)`, 14 px/600 no compacto e 16 px/700 no ampliado.
- Indicador ativo: círculo de 8 a 10 px em `var(--color-success-500)`.
- Indicador inativo: `var(--color-gray-300)`.
- Não usar borda em degradê no card da ferramenta.
- Não usar badges.
- Não aplicar hover com elevação ou deslocamento.
- Como indicação de clique, usar cursor e focus visível. Se necessário, o hover pode alterar apenas a borda de neutra para `var(--color-gray-200)`, sem animação espacial.

### Fidelidade do box à imagem

- Silhueta: retângulo horizontal baixo, com cantos bastante arredondados; não usar quadrado, card vertical ou cápsula completa.
- Proporção visual: largura entre 2,8 e 3,4 vezes a altura.
- Ordem interna fixa: suporte de ícone à esquerda, nome no centro e ponto de status no extremo direito.
- O suporte do ícone é branco, possui borda quente quase imperceptível e sombra menor que a do card.
- O nome permanece em uma linha e não recebe descrição auxiliar.
- O ponto verde é simples e estático; não recebe texto, halo, pulse ou badge.
- Ferramentas não usam seta, engrenagem ou menu no card-base mostrado nas referências.

## 12. Conectores

- Espessura: 1 px.
- Estilo: tracejado curto e regular.
- Cor: gradiente estático ou `var(--color-primary-300)` quando o gradiente prejudicar a legibilidade.
- Terminações sobre ferramentas: círculo sólido de 8 px.
- Não atravessar cards.
- Não cruzar linhas entre agentes diferentes.
- Não usar losango.
- Não animar linha, tracejado, círculos ou cor.

---

# Subagente — Design

## 13. Papel visual

O subagente é um agente completo vinculado ao principal. Ele deve ser reconhecido como agente, não como ferramenta.

Sua seção aparece depois de todas as ferramentas do agente principal. Ela é independente do agrupamento de ferramentas.

O card deve seguir a silhueta mostrada nas duas imagens: cápsula branca, contorno fino laranja–rosa, ícone de agente à esquerda, duas linhas de texto e chevron à direita. Não adaptar o subagente ao formato de uma ferramenta comum.

## 14. Limite e distribuição

- Máximo absoluto: dois subagentes por agente principal.
- O limite deve ser validado no frontend e no backend.
- Com zero subagentes: não renderizar cápsula vazia ou placeholder. A criação acontece pelo catálogo aberto no botão `+` de ferramentas do agente principal.
- Com um subagente: card ocupa de 62% a 72% da largura do agente principal e fica centralizado.
- Com dois subagentes: cards ficam lado a lado com gap de 12 a 16 px.
- Com menos de dois, o catálogo de ferramentas do agente principal oferece a ação `Subagente`.
- Ao atingir dois, remover essa ação do catálogo e manter a validação do limite no backend.
- Não criar um container externo com título `Subagentes`. Os próprios cards, a posição e os conectores expressam a relação.

### Dimensões na página Agentes

| Cenário | Largura | Altura |
|---|---:|---:|
| Um subagente | 62% a 72% do agente principal | 76 a 84 px |
| Dois subagentes | `calc(50% - gap/2)` | 76 a 84 px |
| Largura mínima individual | 168 px | — |

Em telas com menos de 480 px úteis, os dois subagentes podem empilhar para evitar corte de conteúdo. O limite lógico continua sendo dois.

## 15. Geometria e acabamento

- Formato: cápsula.
- Radius: `var(--radius-full)`.
- Fundo: `var(--color-surface-1)`.
- Contorno: 1,5 px com o mesmo degradê estático do agente principal.
- Sombra: `var(--shadow-sm)`.
- Nunca utilizar fundo cinza envolvendo o subagente.
- Nunca encaixar o subagente dentro do card principal.
- Nunca posicioná-lo como uma célula da grade de ferramentas.
- Não exibir ponto verde, texto de status, engrenagem ou badge no card-base. A referência mostra somente ícone, identificação e chevron.

## 16. Conteúdo

### Ícone

- Container: 44 a 48 px.
- Formato: quadrado arredondado, radius de 14 a 16 px.
- Ícone de robô: 22 a 24 px.
- Mesmo desenho-base do agente principal, em escala compacta.
- Degradê estático no traço.

### Texto

- Título: nome real configurado, por exemplo `Atendimento Clinico Cardeal`.
- Tamanho: 14 px em cards duplos; até 16 px em card único.
- Peso: 700.
- Cor: `var(--color-gray-900)`.
- Subtexto: `Atendimento especializado` ou descrição curta equivalente.
- Tamanho do subtexto: 12 px.
- Cor: `var(--color-gray-500)`.
- Máximo de uma linha por campo, com reticências.

### Ação

- Seta `ChevronRight`, 18 a 20 px.
- Cor: `var(--color-primary-500)`.
- Área clicável mínima do card inteiro.
- `aria-label`: `Configurar subagente [nome]`.

### Fidelidade do box à imagem

- Um subagente é obrigatoriamente menor que o agente principal e visivelmente maior que uma ferramenta.
- O formato é mais arredondado que o card principal e mais alongado que um card de ferramenta.
- Em card único, preservar a proporção horizontal da referência, com largura aproximada entre 3,8 e 5 vezes a altura.
- O ícone não encosta no contorno e possui seu próprio suporte branco com sombra suave.
- O título fica alinhado à esquerda e nunca usa o texto genérico `Subagente` quando já existe um nome configurado.
- A descrição `Atendimento especializado` é a segunda linha, curta e discreta.
- O chevron é o único elemento à direita.

## 17. Hover

O subagente é o segundo e último tipo de card que pode se deslocar no hover.

- Default: `shadow-sm`, `translateY(0)`.
- Hover: `shadow-md`, `translateY(-2px)`.
- Pressed: `shadow-inset`, `translateY(0)`.
- Duração máxima: 160 ms.
- Sem animação do contorno ou do ícone.
- `prefers-reduced-motion` remove o deslocamento.

## 18. Ferramentas pertencentes ao subagente

As ferramentas de um subagente aparecem abaixo do card dele, nunca acima e nunca dentro da cápsula.

Para cada subagente:

```text
[ Subagente ]
      │
     [+]
      │
[Tool][Tool]
```

Regras:

- Cada subagente possui seu próprio botão circular `+`.
- O seletor aberto pelo `+` recebe o ID do subagente como proprietário.
- Ferramentas de subagentes diferentes não podem ser misturadas na mesma linha visual sem identificação.
- Com dois subagentes, cada coluna renderiza somente suas próprias ferramentas.
- Em colunas estreitas, ferramentas ficam uma abaixo da outra.
- A ausência de ferramentas não gera caixa vazia nem mensagem explicativa.

---

# Receituário — Design

## 19. Papel e nomenclatura

Receituário é uma ferramenta comum. Ela usa exatamente o mesmo box, dimensões, status e comportamento das demais ferramentas.

Texto visível obrigatório: `Receituário`, com acentuação correta.

Não usar os nomes `Documento`, `Receita`, `Leitor de receita` ou `Prescription` no card principal da interface.

## 20. Ícone do Receituário

O ícone deve ser próprio e imediatamente reconhecível em tamanho reduzido.

### Construção

- Silhueta frontal de uma folha vertical.
- Cantos arredondados.
- Pequena dobra no canto superior direito, sem exagero.
- Abreviação `Rx` central ou discretamente deslocada para a parte inferior.
- Opcionalmente, duas linhas curtas podem sugerir campos de OD e OE.
- Não usar cruz médica, estetoscópio, cápsula, prancheta ou documento genérico.

### Especificação SVG

- `viewBox`: 24 × 24.
- Tamanho compacto: 20 a 22 px.
- Tamanho ampliado: 24 a 28 px.
- Stroke: 2 a 2,25 px.
- `stroke-linecap`: `round`.
- `stroke-linejoin`: `round`.
- Sem preenchimento sólido no documento.
- Degradê estático aplicado ao traço da folha e do `Rx`.
- O `Rx` precisa permanecer legível a 20 px; evitar detalhes menores que 1,5 px.

## 21. Box do Receituário

### Compacto

- Altura: 56 a 64 px.
- Largura: 150 a 220 px.
- Ícone dentro de container de 36 a 40 px.
- Título: 14 px/600.
- Indicador ativo: 8 px.

### Ampliado

- Altura: 88 a 112 px.
- Largura: 280 a 390 px.
- Ícone dentro de container de 48 a 56 px.
- Título: 16 px/700.
- Indicador ativo: 10 px.

### Estados

- Ativo: círculo `var(--color-success-500)`.
- Inativo: círculo `var(--color-gray-300)`.
- Configuração incompleta: não usar amarelo apenas como decoração; a pendência deve ser explicada dentro do modal de configuração.
- Clique abre a configuração do Receituário.
- Focus visível obrigatório.
- Sem hover com deslocamento.
- Sem animação no ícone, status ou contorno.

---

# Validação dos ícones

## 22. Linguagem comum

Todos os ícones devem compartilhar:

- traço entre 2 e 2,25 px;
- terminações arredondadas;
- desenho frontal, simples e simétrico quando aplicável;
- leitura clara em 20 px;
- degradê estático somente no traço ou suporte visual;
- ausência de fundo preenchido colorido;
- mesma proporção óptica dentro dos containers.

| Elemento | Desenho obrigatório | Não utilizar |
|---|---|---|
| Agente principal | Robô frontal amigável, antena curta | Emoji, robô 3D, cérebro |
| Subagente | Mesmo robô em escala compacta | Ícone de ferramenta ou engrenagem |
| Calendário | Calendário frontal, argolas superiores e grade | Relógio isolado |
| Áudio | Onda sonora com barras verticais arredondadas | Microfone |
| Encaminhamento | Origem conectada a dois destinos/setas | Ícone genérico de compartilhar |
| Receituário | Folha arredondada com `Rx` | Documento genérico ou cruz médica |
| Visagismo | Óculos frontais simétricos | Rosto, olho ou câmera |
| Adicionar ferramenta | `Plus` dentro de círculo | Losango, card vazio ou texto solto |

## 23. Validação visual mínima dos ícones

Antes de aprovar um ícone:

1. Renderizar em 20 px, 24 px e 28 px.
2. Confirmar reconhecimento sem depender do texto.
3. Confirmar que o degradê não apaga trechos finos.
4. Verificar centralização óptica, não apenas matemática.
5. Comparar peso do traço com os demais ícones.
6. Verificar contraste mínimo de 3:1 para elementos gráficos relevantes.
7. Confirmar que nenhum detalhe vira ruído em telas de baixa densidade.

---

# Coloração e elevação

## 24. Paleta operacional

| Papel | Token | Valor de referência |
|---|---|---|
| Fundo da página | `--color-bg-base` | `#F7F6F4` |
| Superfície dos cards | `--color-surface-1` | `#FFFFFF` |
| Superfície secundária | `--color-surface-2` | `#FAFAF8` |
| Título | `--color-gray-900` | `#111110` |
| Corpo | `--color-gray-700` | `#3D3D3A` |
| Metadado | `--color-gray-500` | `#7A7A74` |
| Borda neutra | `--color-gray-100` | `#ECEAE4` |
| Ação principal | `--color-primary-500` | `#E8511A` |
| Ação hover | `--color-primary-600` | `#C94010` |
| Status ativo | `--color-success-600` | `#16A34A` |
| Degradê estático | novo token restrito | `#FF7A1A → #FF4D5F → #FF2D9A` |

## 25. Limites do degradê

Permitido:

- contorno estático do agente principal;
- contorno estático do subagente;
- traços dos ícones especializados;
- conectores editoriais quando houver contraste suficiente.

Proibido:

- fundo completo dos cards;
- botões;
- textos;
- inputs e modais;
- status ativo;
- animação do contorno;
- sombras coloridas;
- cards de ferramentas.

## 26. Sombras

- Cards estáticos: `var(--shadow-sm)`.
- Hover de agente e subagente: `var(--shadow-md)`.
- Pressed de agente e subagente: `var(--shadow-inset)`.
- Modal: `var(--shadow-modal)`.
- Não usar sombras rosas, laranjas ou glow.
- A aparência elevada deve vir da Soft UI, não de movimento contínuo.

---

# Responsividade

## 27. Breakpoints de comportamento

### Área útil igual ou superior a 880 px

- Dois agrupamentos de agentes principais lado a lado.
- Cada agrupamento mantém entre 420 e 520 px.
- Ferramentas compactas em até duas colunas dentro de cada agrupamento.
- Dois subagentes lado a lado.

### Área útil entre 480 e 879 px

- Um agrupamento de agente por linha.
- Largura máxima de 520 px.
- Ferramentas em até duas colunas.
- Dois subagentes podem permanecer lado a lado quando cada um mantiver pelo menos 196 px.

### Área útil abaixo de 480 px

- Um agrupamento por linha, largura de 100%.
- Ferramentas empilhadas quando não couberem com 150 px mínimos.
- Subagentes empilhados.
- Conectores simplificados para uma linha vertical.
- Nenhum texto importante pode depender de truncamento excessivo.
- Zero rolagem horizontal.

### Página Ferramentas

- Desktop amplo: três ferramentas por linha.
- Tablet: duas ferramentas por linha.
- Mobile: uma ferramenta por linha.
- A segunda linha deve ser centralizada quando possuir menos cards que a primeira.

---

# Interações, acessibilidade e estados

## 28. Movimento permitido

| Elemento | Movimento automático | Hover com deslocamento | Transição de cor/sombra |
|---|---|---|---|
| Agente principal | Proibido | Até -2 px | Permitida, até 160 ms |
| Subagente | Proibido | Até -2 px | Permitida, até 160 ms |
| Ferramenta | Proibido | Proibido | Somente estado funcional discreto |
| Botão `+` | Proibido | Proibido | Cor/focus permitido |
| Conectores | Proibido | Proibido | Proibida |
| Status | Proibido | Proibido | Proibida |
| Ícones | Proibido | Proibido | Proibida |

São expressamente proibidos:

- `float` contínuo;
- pulsação do status;
- gradiente em movimento;
- rotação do botão `+`;
- cards entrando com deslocamento;
- parallax;
- bounce;
- animação de linha tracejada.

## 29. Teclado e leitor de tela

- Todo card clicável deve ser `button` ou possuir semântica e teclado equivalentes.
- Focus visível não pode depender apenas de cor.
- Área mínima de controles: 40 × 40 px; preferencialmente 44 × 44 px em mobile.
- O status deve possuir texto acessível além do círculo.
- O botão `+` precisa informar o agente proprietário no `aria-label`.
- Reticências visuais devem preservar o nome completo por `title`, tooltip acessível ou nome computado.
- Os conectores são decorativos e devem usar `aria-hidden="true"`.

---

# Critérios de aceite visual

## 30. Checklist obrigatório

### Agente principal

- [ ] Largura entre 420 e 520 px na página Agentes.
- [ ] Altura máxima de 120 px.
- [ ] Não contém ferramentas ou subagentes dentro de sua borda.
- [ ] Não exibe o modelo de IA.
- [ ] Contorno em degradê estático.
- [ ] Único movimento é hover de até -2 px.

### Ferramentas

- [ ] Ficam abaixo e fora do agente proprietário.
- [ ] O estado vazio não exibe caixa ou mensagem.
- [ ] Existe botão circular `+` funcional.
- [ ] O `+` substitui todos os losangos de adição.
- [ ] Cards usam borda neutra, não degradê.
- [ ] Não possuem flutuação ou hover com deslocamento.
- [ ] A página Ferramentas distribui 3 cards na primeira linha e até 2 centralizados na segunda quando houver cinco.

### Subagentes

- [ ] Ficam abaixo do bloco de ferramentas do principal.
- [ ] Nunca ficam dentro do agente principal.
- [ ] São sempre menores que o agente principal e maiores que as ferramentas.
- [ ] Um ocupa de 62% a 72% da largura do principal e fica centralizado; dois ficam lado a lado.
- [ ] O sistema impede um terceiro subagente.
- [ ] Ferramentas próprias aparecem somente abaixo do respectivo subagente.
- [ ] Cada subagente possui seu próprio botão `+` para ferramentas.
- [ ] Único movimento é hover de até -2 px.

### Receituário

- [ ] Usa o mesmo card-base das ferramentas.
- [ ] Ícone mostra folha e `Rx`.
- [ ] Não usa documento genérico.
- [ ] Texto possui acentuação correta.
- [ ] Indicador ativo é estático.
- [ ] Abre sua configuração ao clicar.

### Sistema visual

- [ ] Fundo da página usa `#F7F6F4`, não branco puro.
- [ ] Cards usam superfície branca.
- [ ] Não existem badges.
- [ ] Não existe roxo.
- [ ] Não existe animação autônoma.
- [ ] Não existe rolagem horizontal.
- [ ] Cores, sombras, radius e gradiente são tokens.
- [ ] Contraste atende WCAG AA.

---

# Ordem recomendada de implementação futura

## 31. Código de produto

1. Remover classes e keyframes de flutuação.
2. Separar o componente do agente principal de seus descendentes.
3. Criar o agrupamento externo de ferramentas por proprietário.
4. Restaurar a ação circular de adicionar ferramenta.
5. Criar o agrupamento independente de subagentes.
6. Renderizar ferramentas do subagente abaixo do respectivo card.
7. Aplicar limite genérico de dois subagentes no frontend e backend.
8. Implementar as variantes compacta e ampliada do card de ferramenta.
9. Implementar ou validar os SVGs especializados.
10. Auditar responsividade, teclado, contraste e ausência de movimento automático.

## 32. Configuração do cliente

1. Exibir apenas ferramentas realmente vinculadas à Cardeal.
2. Manter Agenda vinculada ao subagente clínico quando essa for a configuração vigente.
3. Não adicionar Calendário, Áudio, Encaminhamento, Receituário ou Visagismo apenas para reproduzir o mock.
4. Preservar o agente principal e os subagentes existentes durante o redesign.

---

# Decisão final

A referência deve ser interpretada como uma árvore de propriedade, e não como um card que contém outros cards:

- agente principal possui ferramentas;
- agente principal possui até dois subagentes;
- cada subagente pode possuir suas próprias ferramentas;
- a hierarquia de tamanho é sempre `agente principal > subagente > ferramenta`;
- cada elemento aparece fora do box de seu proprietário, conectado visualmente e identificado pela proximidade;
- a interface parece elevada pela Soft UI, mas permanece completamente estática fora de interações diretas.

Este documento é o norte para os próximos ajustes. Em caso de conflito com mock intermediário, prevalecem a separação estrutural, os limites dimensionais e as regras de movimento definidos aqui.
