# 📐 05 — Layout e Responsividade
**White Minimalist SaaS — Soft UI Edition**

> Define grid, estrutura de página e adaptações responsivas para todas as telas.

---

## Estrutura de Página SaaS

```
┌─────────────────────────────────────────┐
│  Topbar  (height: 56px, surface-1)      │
├──────────┬──────────────────────────────┤
│ Sidebar  │  Main Content               │
│ (240px)  │  padding: 32px              │
│ bg-subtle│  max-width: 1040px          │
│          │  background: bg-base        │
└──────────┴──────────────────────────────┘
```

### Layout Tokens
```css
--layout-topbar-height:      56px;
--layout-sidebar-width:      240px;
--layout-sidebar-collapsed:  64px;
--layout-content-padding:    32px;   /* var(--space-8) */
--layout-content-max-width:  1040px;
--layout-section-gap:        32px;   /* var(--space-8) */
```

---

## Grid System (12 Colunas)

```css
--grid-columns:    12;
--grid-gutter:     24px;   /* Gap entre colunas */
--grid-margin:     32px;   /* Margem lateral do container */
--grid-max-width:  1280px; /* Container máximo */
```

### Breakpoints
```css
--bp-sm:   640px;   /* Mobile landscape */
--bp-md:   768px;   /* Tablet */
--bp-lg:   1024px;  /* Desktop small */
--bp-xl:   1280px;  /* Desktop */
--bp-2xl:  1536px;  /* Desktop large */
```

---

## Topbar

```css
.topbar {
  height:           var(--layout-topbar-height);  /* 56px */
  background-color: var(--color-surface-1);       /* #FFFFFF */
  border-bottom:    var(--border-width-sm) solid var(--border-default);
  box-shadow:       0 1px 0 var(--border-default), var(--shadow-sm);
  display:          flex;
  align-items:      center;
  padding:          0 var(--space-6);
  gap:              var(--space-4);
  position:         sticky;
  top:              0;
  z-index:          100;
}
```

---

## Sidebar

```css
.sidebar {
  width:            var(--layout-sidebar-width);   /* 240px */
  height:           100vh;
  background-color: var(--color-bg-subtle);        /* #F0EEE9 */
  border-right:     var(--border-width-sm) solid var(--border-default);
  display:          flex;
  flex-direction:   column;
  padding:          var(--space-4) var(--space-3);
  overflow-y:       auto;
  position:         sticky;
  top:              0;
  transition:       width var(--duration-slow) var(--ease-out);
}

/* Colapsada */
.sidebar--collapsed {
  width: var(--layout-sidebar-collapsed);  /* 64px */
}

/* Lock de scroll em mobile com sidebar aberta */
body.sidebar-mobile-open {
  overflow: hidden;
}
```

---

## Content Area

```css
.content-area {
  flex:       1;
  min-width:  0;
  background: var(--color-bg-base);    /* #F7F6F4 */
  padding:    var(--layout-content-padding);
}

.content-inner {
  max-width: var(--layout-content-max-width);   /* 1040px */
  margin:    0 auto;
}

/* Gap entre seções dentro da página */
.content-section + .content-section {
  margin-top: var(--layout-section-gap);        /* 32px */
}
```

---

## Agrupamento de Conteúdo (Information Architecture)

### Experiencia Operacional Sofisticada

Telas de produto devem se comportar como ferramentas de trabalho, nao como apresentacoes. A referencia visual e o calendario: uma superficie continua, modular e silenciosa, com informacao densa mas respiravel.

- Header compacto: label, titulo, descricao curta e filtros.
- Secoes sao faixas de conteudo com `section-label`; nao usar blocos heroicos para explicar a narrativa.
- A ordem da tela deve criar leitura progressiva: pulso, movimento, conversa, instancia, detalhe opcional.
- Em desktop, priorize leitura em grid; em mobile, preserve a mesma ordem sem esconder metricas principais.
- Evite grandes espacos vazios decorativos. Whitespace deve melhorar escaneabilidade, nao dramatizar a tela.

### Blocos Temáticos com Section Label
Cada bloco analítico começa com um `section-label` (barra laranja + label mono uppercase):

```html
<!-- Exemplo de bloco de dashboard -->
<div class="content-section">
  <div class="section-label">
    <span class="section-label__text">Consolidado Geral</span>
  </div>

  <div class="chart-grid-3" style="margin-top: var(--space-4)">
    <div class="card-kpi">...</div>
    <div class="card-kpi">...</div>
    <div class="card-kpi">...</div>
  </div>
</div>
```

### Hierarquia do Funil
O funil deve estar **centralizado horizontalmente** em sua seção, com métricas laterais (custos à esquerda, taxas à direita).

---

## Grid de KPI Cards

```css
/* Desktop: 3-4 colunas */
.kpi-grid {
  display:               grid;
  grid-template-columns: repeat(4, 1fr);
  gap:                   var(--space-6);   /* 24px */
}

/* Tablet */
@media (max-width: 1024px) {
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
}

/* Mobile */
@media (max-width: 640px) {
  .kpi-grid { grid-template-columns: 1fr; }
}
```

---

## Adaptações Responsivas por Componente

### Formulários Compostos

- Agrupe campos pela tarefa percebida, como `Nome` e `Agendamento`, em vez de distribuir controles independentes pela grade.
- Controles que formam uma frase operacional permanecem juntos no mesmo grupo visual.
- Não use colunas vazias, placeholders de layout ou grids assimétricos apenas para preencher a linha.
- Em desktop, grupos podem dividir a linha; abaixo de 768px, cada grupo empilha mantendo sua ordem interna.
- Textareas ocupam a largura útil do editor ativo, mas sua altura inicial deve ser proporcional ao conteúdo esperado.

### Funil (Mobile < 768px)
- Larguras decrescentes mantidas proporcionalmente até 768px
- Abaixo de 768px: stages ocupam **100% da largura**, empilhados
- Metric cards laterais migram para **abaixo** do stage correspondente
- Gap entre stage e sua métrica: `var(--space-3)`

### Tabelas Financeiras (Mobile)
```css
/* Mobile: converte linhas em cards empilhados */
@media (max-width: 640px) {
  .table thead { display: none; }

  .table tr {
    display:          block;
    background-color: var(--color-surface-1);
    border-radius:    var(--radius-xl);
    border:           var(--border-width-sm) solid var(--border-default);
    box-shadow:       var(--shadow-sm);
    padding:          var(--space-4);
    margin-bottom:    var(--space-3);
  }

  .table td {
    display:   flex;
    gap:       var(--space-2);
    border:    none;
    padding:   var(--space-1) 0;
  }

  .table td::before {
    content:     attr(data-label);
    font-family: var(--font-family-mono);
    font-size:   var(--text-xs);
    font-weight: var(--font-semibold);
    color:       var(--color-gray-500);
    text-transform: uppercase;
    flex-shrink: 0;
    min-width:   120px;
  }
}
```

### Trackers Horizontais (Hábitos)
```css
.tracker-wrapper {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.tracker-wrapper::-webkit-scrollbar {
  display: none;
}

/* Coluna de nome fixa */
.tracker-name-col {
  position:         sticky;
  left:             0;
  z-index:          2;
  background-color: var(--color-surface-1);  /* mesma cor do card pai */
}
```

### Gráficos (Mobile)
- Container de área: mantém aspect-ratio, reduza altura mínima para `200px`
- Donut: tamanho mínimo `180px` de diâmetro
- Labels de eixo X: `font-size: 9px` em telas < 640px
- Legenda migra para abaixo do gráfico em mobile

### Sidebar (Mobile)
```css
/* Mobile: sidebar vira overlay */
@media (max-width: 768px) {
  .sidebar {
    position:    fixed;
    left:        0;
    top:         0;
    z-index:     300;
    transform:   translateX(-100%);
    transition:  transform var(--duration-slow) var(--ease-out);
    box-shadow:  var(--shadow-lg);
  }

  .sidebar--open {
    transform: translateX(0);
  }
}
```

---

## Responsividade de Texto (clamp)

```css
/* Valores numéricos em cards — fluido */
.stat-value {
  font-size: clamp(1.25rem, 2.5vw, 1.875rem);  /* 20px → 30px */
}

/* Títulos de hero */
.hero-title {
  font-size: clamp(2.25rem, 5vw, 3.75rem);  /* 36px → 60px */
}
```

---

## Checklist de Layout

- [ ] Topbar fixo com `z-index: 100`
- [ ] Sidebar usa `bg-subtle`, nunca `bg-base` ou `surface-1`
- [ ] Content area usa `bg-base` (`#F7F6F4`)
- [ ] Cards usam `surface-1` (`#FFFFFF`) + `shadow-sm`
- [ ] Gaps e paddings são múltiplos do sistema 4px/8px
- [ ] Section labels precedem cada bloco temático
- [ ] Grid de KPI responde a breakpoints corretamente
- [ ] Sidebar colapsa em mobile com overlay e lock de scroll
