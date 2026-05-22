# 📊 04 — Gráficos e Visualização de Dados
**White Minimalist SaaS — Soft UI Edition**

> Guia para mapeamento visual de gráficos nas dashboards.
> Renderização **minimalista e de imediata compreensão** sobre fundo cream quente.

---

## Princípios Gerais

1. **Fundo cream** — Gráficos vivem sobre `--color-bg-base` (`#F7F6F4`), dentro de `card-section` branco com `shadow-sm`
2. **Laranja como protagonista** — `--color-primary-500` (`#E8511A`) é a cor de destaque dos gráficos principais
3. **Paleta neutra expandida** — Para multi-séries: paleta diferenciada sem conflito com o laranja primário
4. **Sem molduras supérfluas** — O card já cria o container; não adicionar bordas extras em volta do gráfico
5. **Animação de entrada** — Nenhum gráfico renderiza bruscamente

---

## Paleta de Gráficos

### Série Principal (linha/área dominante)
```css
var(--color-primary-500)   /* #E8511A — laranja, destaque máximo */
```

### Séries Multi-linha
| Série | Cor | Hex |
|---|---|---|
| Série A | Laranja (primária) | `#E8511A` |
| Série B | Azul médio | `#3B82F6` |
| Série C | Verde suave | `#16A34A` |
| Série D | Roxo | `#7C3AED` |
| Série E | Cinza grafite | `#5C5C58` |

> Pink/Magenta (`#E83560`) **nunca** usado em séries de gráfico — reservado para badges e ilustrações.

---

## Containers de Gráfico

Todo gráfico vive dentro de um `card-section`:

```css
/* Container padrão */
.chart-container {
  background-color: var(--color-surface-1);  /* #FFFFFF */
  border-radius:    var(--radius-xl);
  border:           var(--border-width-sm) solid var(--border-default);
  box-shadow:       var(--shadow-sm);
  overflow:         hidden;
}

.chart-container__header {
  display:         flex;
  align-items:     center;
  justify-content: space-between;
  padding:         var(--space-5) var(--space-6);
  border-bottom:   var(--divider);
}

.chart-container__title {
  font-size:   var(--text-base);
  font-weight: var(--font-semibold);
  color:       var(--color-gray-900);
}

.chart-container__subtitle {
  font-size: var(--text-sm);
  color:     var(--color-gray-500);
}

.chart-container__body {
  padding: var(--space-6);
}
```

### Header de Seção de Gráfico
Usar o `section-label` para marcar blocos temáticos:
```html
<div class="section-label">
  <span class="section-label__text">Consolidado Geral</span>
</div>
```

---

## Gráfico de Área Linear

### Visual
Área abaixo da linha com fill gradient do laranja para transparente.

### Fill Gradient
```css
/* Gradient laranja → transparente */
linearGradient:
  stop offset="0%"   color="#E8511A" opacity="0.20"   /* próximo à linha */
  stop offset="100%" color="#E8511A" opacity="0.00"   /* base no fundo */
```

- Linha superior: `#E8511A` sólido, `stroke-width: 2px`, `stroke-linecap: round`
- Fill vai de **20% de opacidade** (proximidades da linha) para **0%** (base)
- Sobre fundo claro, o gradient é mais contido que no dark mode

### Eixos
```css
.chart-axis-label {
  font-family: var(--font-family-mono);
  font-size:   10px;
  fill:        var(--color-gray-400);
}

/* Gridlines horizontais — muito sutis */
.chart-gridline {
  stroke:         var(--color-gray-100);
  stroke-width:   1px;
  stroke-dasharray: 0;
}
```

---

## Gráfico de Múltiplas Linhas

### Visual
- **Pontos explícitos** (dots) nas dobras dos dados: `r: 4`, fill sólido, stroke `surface-1` 2px
- **Sem preenchimento sólido** abaixo das linhas (opacidade máxima 5%)
- Linhas suaves com `stroke-linecap: round`, `stroke-linejoin: round`

```css
.multi-line-dot {
  r:            4;
  fill:         currentColor;
  stroke:       var(--color-surface-1);
  stroke-width: 2;
}

.multi-line-path {
  fill:           none;
  stroke-width:   2;
  stroke-linecap: round;
}
```

---

## Donut Charts (Rosca de Categorias)

### Visual
- Buraco central **generoso** (65–70% do raio) — pode exibir métrica principal
- Máximo 4 segmentos por rosca
- Bordas entre segmentos: `2px` de `--color-bg-base` (cria separação sem stroke)

### Cores dos Segmentos
```css
/* Usar paleta sem conflito com a primária */
var(--color-primary-500)  /* #E8511A — segmento de destaque */
#3B82F6                   /* Azul */
#16A34A                   /* Verde */
#7C3AED                   /* Roxo */
```

### Label Central
```css
.donut-center-value {
  font-size:   var(--text-3xl);
  font-weight: var(--font-extrabold);
  fill:        var(--color-gray-900);
  text-anchor: middle;
}

.donut-center-label {
  font-family: var(--font-family-mono);
  font-size:   var(--text-xs);
  fill:        var(--color-gray-500);
  text-anchor: middle;
  text-transform: uppercase;
}
```

---

## Bar Charts

### Visual
- Barras com `border-radius` no topo: `6px` (top-left e top-right)
- Cor padrão: `--color-primary-500` para métrica principal
- Espaçamento entre barras: `gap: 4px` a `8px`
- Labels abaixo: mono, 10px, `color-gray-400`

```css
.bar {
  fill:         var(--color-primary-500);
  border-radius: 6px 6px 0 0;
  transition:   opacity var(--duration-fast) var(--ease-default);
}

.bar:hover {
  opacity: 0.80;
}
```

---

## Tooltips de Gráfico

```css
.chart-tooltip {
  background-color: var(--color-bg-inverse);   /* #1A1A18 — dark */
  border-radius:    var(--radius-lg);           /* 12px */
  padding:          var(--space-2) var(--space-3);
  box-shadow:       var(--shadow-md);
  color:            #FFFFFF;
  font-size:        var(--text-xs);
  font-family:      var(--font-family-mono);
  white-space:      nowrap;
}
```

> Tooltip usa `bg-inverse` (dark) sobre interface light — cria contraste editorial consistente com os pilares de design.

---

## Legenda de Gráfico

```css
.chart-legend {
  display:    flex;
  flex-wrap:  wrap;
  gap:        var(--space-4);
  margin-top: var(--space-4);
}

.chart-legend__item {
  display:     flex;
  align-items: center;
  gap:         var(--space-2);
  font-size:   var(--text-xs);
  font-family: var(--font-family-mono);
  color:       var(--color-gray-600);
}

.chart-legend__dot {
  width:         8px;
  height:        8px;
  border-radius: var(--radius-full);
  flex-shrink:   0;
}
```

---

## Dashboard Modular (Grid de Gráficos)

```css
/* Gráficos grandes — 100% da coluna */
.chart-full { grid-column: 1 / -1; }

/* Grid 2-col para gráficos menores */
.chart-grid-2 {
  display:               grid;
  grid-template-columns: 1fr 1fr;
  gap:                   var(--space-6);
}

/* Grid 3-col para KPI cards de gráfico */
.chart-grid-3 {
  display:               grid;
  grid-template-columns: repeat(3, 1fr);
  gap:                   var(--space-6);
}
```

---

## Animações de Entrada

1. **Gráficos de linha/área** → `stroke-dasharray` animado (draw da esquerda para a direita), 600ms, `ease-out`
2. **Barras** → `scaleY` de 0 para 1 a partir da base, 400ms, `ease-out`
3. **Donuts** → rotação de `stroke-dashoffset`, 500ms, `ease-out`
4. **KPI cards** → `fade-in` + `translateY(10px → 0)`, 200ms, escalonado

```css
@keyframes chart-draw {
  from { stroke-dashoffset: 100%; }
  to   { stroke-dashoffset: 0%; }
}

@keyframes bar-rise {
  from { transform: scaleY(0); transform-origin: bottom; }
  to   { transform: scaleY(1); transform-origin: bottom; }
}
```

---

## Regras de Performance

- Preferir `transform` e `opacity` nas animações (GPU-accelerated)
- Recharts com `isAnimationActive={false}` quando há re-renders muito frequentes
- Evitar re-render do gráfico inteiro para atualizações pontuais de dados
