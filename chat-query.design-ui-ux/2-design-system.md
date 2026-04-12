# Design System

## 📌 Contexto
Este arquivo unifica as regras visuais brutas e tokens para os agentes reponsáveis por cor, tipografia, espaçamento e estilo. A estética se baseia em um *Dark Mode Premium* com elementos glassmórficos/neumórficos focados em contraste legível e imersão.

---

## 🎨 Color System Agent
**Missão**: Controlar uso de cores.
**Objetivo**: Garantir consistência, contraste e foco (CTA).

### Paleta Dark Mode Premium
- **Background Principal (App):** `#0b0b0b` a `#121212` (Quase preto a cinza profundo).
- **Background de Elementos (Cards, Funil):** `#1a1a1a` com reflexos leves. Para elevação/profundidade no Funil, use gradiantes ou luz direcional.
- **Títulos e Valores Principais:** Branco puro `#ffffff` ou cinza-gelo `#f5f5f5` para contraste estrito e leitura veloz.
- **Textos Secundários / Labels (Headers das colunas):** Cinza médio `#a3a3a3` ou `#888888`.
- **Primary / Accent Color (Ação e Destaque):** Vermelho sangue intenso / Carmesim (`#ff3b3b` ou similar), usado para gráficos, botão de adicionar, checkbox marcado e destaque principal do Progresso.
- **Success & Danger (Variações no Funil):**
  - **Positivo Alta:** Verde limão escuro / Esmeralda (`#4caf50` ou similar).
  - **Negativo / Queda:** Vermelho (`#f44336` ou similar).
- **Cores Gráficas de Painéis Múltiplos:** Para não poluir, utilizar uma trilogia de tons elétricos contra o fundo escuro: Verde-água/Lima, Azul Cobalto e Amarelo Dourado (Observado nos gráficos do Rastreamento).

---

## 🔠 Typography Agent
**Missão**: Definir hierarquia textual.
**Objetivo**: Garantir legibilidade e escaneabilidade.

### Regras de Fonte
- **Família:** Fontes Modernas, Geométricas e limpas (*Inter*, *SF Pro*, *Roboto* ou *Outfit*).
- **Peso das Medidas / KPIs (Números Gigantes):** `font-weight: 600` ou `700`. Evitar pesos fracos que borram no dark mode.
- **Peso de Labels Menores:** `font-weight: 400` ou `500`. Deve estar legível no brilho cinza.
- **Espaçamento (Letter-spacing):** Em títulos pequenos e tags (como `%` das variações), aplique um track muito suave (`0.02em` a `0.05em`).

---

## 📏 Spacing Agent
**Missão**: Padronizar espaçamento.
**Objetivo**: Criar ritmo visual consistente.

### Tokens Sugestivos (Layout Padronizado 4px/8px)
- **Interno dos Cards do Funil:** Paddings de `16px 24px` a `24px 32px` dependendo da etapa do funil.
- **Gap entre métricas de tabela:** Espaçamentos grandes (`gap-6`, `gap-8`) para gerar espaço vazio no escuro ("respiro"). O fundo preto por padrão exige respiro não muito denso para não ficar opressivo.
- **Grid de Hábitos:** Colunas adjacentes extremamente unidas de checkboxes sem espaçamento lateral (`gap-x: 1` a `gap-x: 2`) mas consistentes.

---

## 🕶️ Style Agent
**Missão**: Definir identidade visual geral.
**Objetivo**: Aplicar bordas, sombras e estilo (clean, moderno, etc).

### Glows e Soft Neumorphism Invertido
A "Identidade Visual de Funil" das imagens demonstra relevos macios:
- **Border Radius:** Abundante em botões, cartões, e barras e checkpoints (Ex: `border-radius: 8px` até `16px`).
- **Inner Shadows e Drop Shadows:**
  - O Funil utiliza um efeito de profundidade semelhante a botões saltados. O topo ilumina suavemente e a base escurece.
  - Para criar este volume, combine:
    1. Uma `box-shadow` suave interna direcional branca com muita transparência (Ex: `inset 0 1px 1px rgba(255,255,255,0.06)`).
    2. Uma `box-shadow` escura grande (Ex: `0 8px 16px rgba(0,0,0,0.5)`).
- **Linhas das KPIs Funil:** As linhas pontilhadas cinzas que apontam para as etapas são super dinâmicas e fracas (brancas com opacidade de 10-15%). Uso de border-dashed em um tom `#333`.
