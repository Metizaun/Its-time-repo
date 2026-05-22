# ⚡ 06 — UX, Interação e Animações
**White Minimalist SaaS — Soft UI Edition**

> Controla a usabilidade e micro-animações. A interface Soft UI é **suave e responsiva** — nunca brusca, nunca pesada.

---

## State Machine — Soft UI

### Card Clicável
```
DEFAULT ──────► HOVER ──────► ACTIVE ──────► DEFAULT
[shadow-sm]   [shadow-md]  [shadow-inset]  [shadow-sm]
              [translateY  [translateY
               (-2px)]      (0px)]
```

### Input
```
DEFAULT ──────► FOCUS ──────► FILLED ──────► ERROR
[shadow-inset] [shadow-focus] [shadow-inset]  [shadow-inset]
               [border:        [border:        [border:
                primary-500]    default]        error-500]
```

---

## Tokens de Transição

```css
/* Easing curves */
--ease-default:  cubic-bezier(0.4, 0, 0.2, 1);       /* Standard */
--ease-out:      cubic-bezier(0, 0, 0.2, 1);          /* Entrar em tela */
--ease-in:       cubic-bezier(0.4, 0, 1, 1);          /* Sair de tela */
--ease-spring:   cubic-bezier(0.34, 1.56, 0.64, 1);  /* Micro-bounce */

/* Durations */
--duration-instant:  50ms;   /* Checkbox tick */
--duration-fast:     150ms;  /* Hover states, cores de botão */
--duration-default:  200ms;  /* Sombras, transforms */
--duration-slow:     300ms;  /* Modais, drawers */
--duration-slower:   400ms;  /* Page transitions */

/* Shorthands */
--transition-shadow:     box-shadow var(--duration-default) var(--ease-out);
--transition-transform:  transform var(--duration-default) var(--ease-out);
--transition-colors:     background-color var(--duration-fast) var(--ease-default),
                         color var(--duration-fast) var(--ease-default),
                         border-color var(--duration-fast) var(--ease-default);
--transition-all:        all var(--duration-default) var(--ease-out);
```

---

## Regras Críticas de Animação

1. **Nunca animate** `width`, `height` ou `padding` — prefira `transform: scale()`
2. **`box-shadow` pode ser animado** diretamente (sem custo alto de GPU como layout)
3. Use `transform: translateY(-2px)` + shadow maior para hover de cards — nunca mude tamanho
4. Respeite `prefers-reduced-motion` — ver seção abaixo

---

## Hover de Cards

```css
.card--interactive {
  transition: var(--transition-shadow),
              transform var(--duration-default) var(--ease-out);
  cursor: pointer;
}

.card--interactive:hover {
  box-shadow: var(--shadow-md);
  transform:  translateY(-2px);
}

.card--interactive:active {
  box-shadow: var(--shadow-inset);
  transform:  translateY(0);
}
```

---

## Hover de Botões

```css
/* Solid */
.btn-solid:hover {
  background-color: var(--color-primary-600);
  box-shadow:       var(--shadow-primary-hover);
  transform:        translateY(-1px);
}

.btn-solid:active {
  background-color: var(--color-primary-700);
  box-shadow:       var(--shadow-inset);
  transform:        translateY(0);
}

/* Outline */
.btn-outline:hover {
  background-color: var(--color-primary-50);
  box-shadow:       var(--shadow-md);
  transform:        translateY(-1px);
}

/* Ghost */
.btn-ghost:hover {
  background-color: var(--color-bg-subtle);
  box-shadow:       var(--shadow-sm);
}
```

---

## Hover em Tabela / Lista

```css
/* Iluminação suave — NÃO cor sólida pesada */
.table tr:hover td {
  background-color: var(--color-bg-subtle);  /* #F0EEE9 */
  transition:       background-color var(--duration-fast) var(--ease-default);
}

/* Item de lista */
.list-item:hover {
  background-color: var(--color-surface-2);
  border-radius:    var(--radius-lg);
  transition:       background-color var(--duration-fast) var(--ease-default);
}
```

---

## Focus States (Acessibilidade)

```css
/* Focus ring global — substituição do outline padrão */
:focus-visible {
  outline: none;
}

/* Foco em inputs */
.input:focus {
  border-color: var(--border-focus);   /* #E8511A */
  box-shadow:   var(--shadow-focus);
}

/* Foco em botões */
.btn-solid:focus-visible,
.btn-outline:focus-visible,
.btn-ghost:focus-visible {
  outline:    none;
  box-shadow: var(--shadow-focus);
}

/* Foco em nav items */
.nav-item:focus-visible {
  outline:        2px solid var(--color-primary-500);
  outline-offset: 2px;
}
```

---

## Modal — Animação de Entrada

```css
@keyframes modal-enter {
  from {
    opacity:   0;
    transform: translateY(16px) scale(0.97);
  }
  to {
    opacity:   1;
    transform: translateY(0) scale(1);
  }
}

.modal {
  animation: modal-enter var(--duration-slow) var(--ease-spring);
}

/* Saída */
@keyframes modal-exit {
  from {
    opacity:   1;
    transform: translateY(0) scale(1);
  }
  to {
    opacity:   0;
    transform: translateY(8px) scale(0.98);
  }
}
```

---

## Fade-in de Conteúdo

```css
@keyframes fade-in {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}

.animate-fade-in {
  animation: fade-in var(--duration-default) var(--ease-out);
}

/* Escalonado para listas de cards */
.animate-fade-in--delay-1 { animation-delay: 50ms; }
.animate-fade-in--delay-2 { animation-delay: 100ms; }
.animate-fade-in--delay-3 { animation-delay: 150ms; }
```

---

## Skeleton Loading (Paleta Warm)

```css
@keyframes skeleton-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.5; }
}

.skeleton {
  background-color: var(--color-bg-muted);   /* #E8E5DF — warm */
  border-radius:    var(--radius-sm);
  animation:        skeleton-pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

/* Formas de skeleton */
.skeleton--text    { height: 14px; border-radius: var(--radius-xs); }
.skeleton--title   { height: 20px; border-radius: var(--radius-xs); }
.skeleton--avatar  { width: 40px; height: 40px; border-radius: var(--radius-full); }
.skeleton--card    { height: 120px; border-radius: var(--radius-xl); }
```

---

## Drag & Drop (Kanban)

```css
/* Placeholder de zona de drop */
.drag-placeholder {
  border:           2px dashed var(--color-primary-300);
  background-color: var(--color-primary-50);
  border-radius:    var(--radius-xl);
}

/* Item sendo arrastado */
.drag-item--dragging {
  opacity:   0.75;
  transform: scale(1.02);
  box-shadow: var(--shadow-md);
}
```

---

## Sidebar — Transição de Collapse

```css
.sidebar {
  transition: width var(--duration-slow) var(--ease-out);
  overflow:   hidden;
}

/* Labels de nav — desaparecem ao colapsar */
.nav-item__label {
  transition: opacity var(--duration-fast) var(--ease-default),
              width var(--duration-fast) var(--ease-default);
}

.sidebar--collapsed .nav-item__label {
  opacity: 0;
  width:   0;
}
```

---

## Accordion e Expansão de Seção

```css
@keyframes accordion-down {
  from { height: 0; opacity: 0; }
  to   { height: var(--radix-accordion-content-height); opacity: 1; }
}

@keyframes accordion-up {
  from { height: var(--radix-accordion-content-height); opacity: 1; }
  to   { height: 0; opacity: 0; }
}

[data-state="open"]  { animation: accordion-down var(--duration-default) var(--ease-out); }
[data-state="closed"] { animation: accordion-up var(--duration-fast) var(--ease-in); }
```

---

## Animações de Gráfico

### Gráficos de Linha (Draw)
```css
/* Via atributos SVG stroke-dasharray */
.chart-line-path {
  stroke-dasharray: 1000;
  stroke-dashoffset: 1000;
  animation: chart-draw 600ms var(--ease-out) forwards;
}

@keyframes chart-draw {
  to { stroke-dashoffset: 0; }
}
```

### Barras (Rise)
```css
.chart-bar {
  transform-origin: bottom;
  animation: bar-rise 400ms var(--ease-out) forwards;
}

@keyframes bar-rise {
  from { transform: scaleY(0); }
  to   { transform: scaleY(1); }
}
```

---

## Prefers Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration:        0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration:       0.01ms !important;
  }
}
```

---

## Heurísticas de UX — Interface Light

### Contraste Consciente
- **Texto em tabelas longas**: usar `--color-gray-700` (não preto total) — reduz fadiga
- **KPIs e valores-chave**: `--color-gray-900` — destaque máximo legível
- **Labels e metadados**: `--color-gray-500` — hierarquia clara sem peso

### Varredura Visual
- Section labels mono + barra laranja permitem varredura rápida sem leitura
- Ícones Lucide line-art em 20px ao lado de títulos de painel
- Valores numéricos em `font-extrabold` criam pontos de fixação natural

### Posicionamento de Informação
- Área principal (funil, gráfico) → **centro do viewport**
- Métricas derivadas → **laterais** do elemento principal
- Ações secundárias → **rodapé ou direita** do container
