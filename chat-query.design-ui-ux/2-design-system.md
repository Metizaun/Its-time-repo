# Design System

## 📌 Contexto
Este arquivo unifica as regras visuais brutas e tokens para os agentes reponsáveis por cor, tipografia, espaçamento e estilo. A estética se baseia em um *Flat Dark*, focado em contraste legível e imersão em um ambiente escuro livre de sombras estruturais.

---

## 🎨 Color System Agent
**Missão**: Controlar uso de cores.
**Objetivo**: Garantir consistência, contraste e foco (CTA).

### Paleta Dark Mode Premium
- **Background Principal (App):** `var(--color-bg-primary)` (`#0d0d0d`).
- **Background de Elementos (Cards, Funil):** `var(--color-bg-elevated)` (`#242424`) ou `var(--color-bg-surface)` (`#1a1a1a`) com reflexos leves. Para criar a profundidade no Neumorfismo Invertido, usa-se a dualidade entre inner-shadows (luz) brilhantes e drop-shadows densas (sombra).
- **Títulos e Valores Principais:** Branco puro `#ffffff` (`var(--color-text-primary)`).
- **Textos Secundários / Labels (Headers das colunas):** Cinza médio `#a0a0a0` (`var(--color-text-secondary)`).
- **Primary / Accent Color (Ação e Destaque):** Vermelho Intenso (`var(--color-accent)` -> `#e5393a`), usado para gráficos lineares, botão de ação, e estados acionados.
- **Success & Danger (Variações e Status):**
  - **Positivo Alta / Confirmação:** Verde (`var(--color-success)` -> `#4caf82`). O verde está restrito APENAS a confirmações e status OK.
  - **Negativo / Queda:** Vermelho (`var(--color-danger)` -> `#e5393a`).
- **Cores Gráficas de Painéis Múltiplos:** Para não poluir, utilizar uma trilogia de tons elétricos (Amarelo, Azul, e Verde) em gráficos como Rastreamento, garantindo bom contraste sem roubar o vermelho primário do sistema.

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
A "Identidade Visual de Funil" das imagens demonstra relevos macios combinados a um glow primário no Dark Mode:
- **Border Radius:** Abundante em botões, cartões, e barras e checkpoints (Ex: `border-radius: 8px` até `16px`).
- **Inner Shadows e Drop Shadows (Neumorfismo):**
  - O Funil e componentes utilizam um efeito de profundidade semelhante a botões saltados. O topo de uma interface bloqueada ilumina suavemente (como se banhada de luz vinda de cima) e a base escurece forte.
  - Para criar este volume, integram-se:
    1. Uma luz reflexiva de topo (`inset 0 1px 1px rgba(255,255,255,0.06)`).
    2. Uma base escurecida de projeção (Ex: `0 8px 16px rgba(0,0,0,0.5)`).
- **Linhas das KPIs Funil:** As linhas conectoras das etapas são super dinâmicas e fracas (`rgba(255,255,255,0.1)`) para interagir com a ambientação tridimensional macia.
