# UI Guidelines — Parte 02: Espacial & Elevação
**White Minimalist SaaS — Soft UI Edition**

---

## 3. Geometria e Espaçamento (Spatial System)

### 3.1 Base Unit e Escala de Espaçamento

O sistema de espaçamento é baseado em múltiplos de **4px** (micro) e **8px** (macro). Toda margem, padding, gap e offset deve ser um múltiplo desses valores. Zero desvios permitidos.

```css
/* Spatial Scale — Base 4px */
--space-0:    0px;
--space-1:    4px;    /* Micro — gap entre ícone e label */
--space-2:    8px;    /* XS — padding interno de badge, tag */
--space-3:    12px;   /* SM — gap de itens inline */
--space-4:    16px;   /* MD — padding de input, gap padrão */
--space-5:    20px;   /* LG — gap entre elementos de form */
--space-6:    24px;   /* XL — padding de card */
--space-8:    32px;   /* 2XL — espaço entre seções */
--space-10:   40px;   /* 3XL — margin de página */
--space-12:   48px;   /* 4XL — hero padding vertical */
--space-16:   64px;   /* 5XL — separação de blocos */
--space-20:   80px;   /* 6XL — seções de landing */
--space-24:   96px;
--space-32:   128px;
```

**Regra mnemônica:**
- `--space-2` (8px): interior de chips/badges
- `--space-4` (16px): padding interno de inputs e botões
- `--space-6` (24px): padding interno de cards
- `--space-8` (32px): gap entre cards no grid
- `--space-10` (40px): margin vertical de seções dentro de page

---

### 3.2 Grid System

```css
/* Grid de 12 colunas — Layout Principal */
--grid-columns:      12;
--grid-gutter:       24px;   /* Gap entre colunas */
--grid-margin:       32px;   /* Margem lateral do container */
--grid-max-width:    1280px; /* Container máximo */

/* Breakpoints */
--bp-sm:   640px;   /* Mobile landscape */
--bp-md:   768px;   /* Tablet */
--bp-lg:   1024px;  /* Desktop small */
--bp-xl:   1280px;  /* Desktop */
--bp-2xl:  1536px;  /* Desktop large */
```

**Layout de SaaS — Estrutura de referência:**

```
┌─────────────────────────────────────────┐
│  Topbar  (height: 56px)                 │
├──────────┬──────────────────────────────┤
│ Sidebar  │  Main Content               │
│ (240px)  │  padding: 32px              │
│          │  max-width: 1040px          │
│          │                             │
└──────────┴──────────────────────────────┘
```

```css
/* Layout Tokens */
--layout-topbar-height:     56px;
--layout-sidebar-width:     240px;
--layout-sidebar-collapsed: 64px;
--layout-content-padding:   var(--space-8);   /* 32px */
--layout-content-max-width: 1040px;
--layout-section-gap:       var(--space-8);   /* 32px */
```

---

### 3.3 Border Radius — Regras Exatas de Geometria

Esta é a parte mais crítica para a estética Soft UI. As referências usam cantos arredondados generosos para criar a sensação de "flotação".

```css
/* Border Radius Scale */
--radius-none:   0px;
--radius-xs:     4px;    /* Tags inline, chips pequenos */
--radius-sm:     6px;    /* Badges, avatars quadrados */
--radius-md:     8px;    /* Inputs, selects, textareas */
--radius-lg:     12px;   /* Botões padrão, dropdowns, tooltips */
--radius-xl:     16px;   /* Cards padrão, panels */
--radius-2xl:    20px;   /* Cards de destaque, widget de KPI */
--radius-3xl:    24px;   /* Modais, sidepanels, drawers */
--radius-full:   9999px; /* Pills, badges redondos, toggles */
```

**Regras de aplicação por componente:**

| Componente | Radius | Justificativa |
|---|---|---|
| Input text, Select, Textarea | `--radius-md` (8px) | Suave mas preciso |
| Botão Small | `--radius-lg` (12px) | Proporcional ao height de 32px |
| Botão Medium (padrão) | `--radius-lg` (12px) | Height 40px |
| Botão Large | `--radius-xl` (16px) | Height 48px |
| Botão Pill (variante) | `--radius-full` | Estilo marketing/CTA |
| Card padrão | `--radius-xl` (16px) | Look Soft UI |
| Card KPI/Stat | `--radius-2xl` (20px) | Mais expressivo |
| Modal | `--radius-3xl` (24px) | Flutuação premium |
| Dropdown / Popover | `--radius-xl` (16px) | Consistente com cards |
| Tooltip | `--radius-lg` (12px) | Compacto |
| Badge / Tag | `--radius-xs` (4px) ou `--radius-full` | Depende do estilo |
| Avatar | `--radius-full` | Padrão |
| Sidebar nav item hover | `--radius-lg` (12px) | |
| Table row | `--radius-none` | Exceção — tabelas são retangulares |
| Progress bar track | `--radius-full` | |

**Regra de consistência:** Nunca misture `--radius-md` e `--radius-xl` em componentes adjacentes sem hierarquia visual clara. Componentes menores dentro de containers maiores podem ter radius menor.

---

### 3.4 Proporções de Componentes

```css
/* Heights dos componentes interativos */
--height-input-sm:  32px;
--height-input-md:  40px;   /* Padrão */
--height-input-lg:  48px;
--height-input-xl:  56px;   /* Hero forms, checkout */

/* Paddings internos dos inputs */
--input-px-sm:  var(--space-3);  /* 12px */
--input-px-md:  var(--space-4);  /* 16px */
--input-px-lg:  var(--space-5);  /* 20px */

/* Paddings dos botões */
--btn-py-sm:    6px;
--btn-px-sm:    var(--space-3);   /* 12px */
--btn-py-md:    10px;
--btn-px-md:    var(--space-4);   /* 16px */
--btn-py-lg:    14px;
--btn-px-lg:    var(--space-6);   /* 24px */
--btn-py-xl:    18px;
--btn-px-xl:    var(--space-8);   /* 32px */
```

---

## 4. Profundidade e Sombras (Elevação Soft UI)

### 4.1 Filosofia de Elevação

A elevação no Soft UI é radicalmente diferente de Material Design. Não é sobre sombras escuras que projetam formas — é sobre **luz difusa que cria a ilusão de volume**.

O sistema usa **dois tipos de sombra simultâneos**:
- **Sombra escura** (embaixo/direita): simula a ausência de luz.
- **Sombra clara** (acima/esquerda): simula reflexo de luz ambiente.

Resultado: o componente parece emergir suavemente da superfície, não flutuar dramaticamente sobre ela.

```
Fórmula base:
box-shadow: 
  [X+ Y+ blur spread] rgba(escuro, opacidade),   /* sombra natural */
  [X- Y- blur spread] rgba(claro, opacidade);    /* reflexo de luz */
```

---

### 4.2 Variáveis de Sombra Base

```css
/* Shadow color tokens */
--shadow-dark-rgb:  26, 24, 20;    /* Derivado de --color-gray-900 */
--shadow-light-rgb: 255, 255, 253; /* Quase branco com toque quente */
```

---

### 4.3 Níveis de Elevação (3 + extras)

#### **Elevação 0 — Embutido (Inset / Pressed)**
Usado em: inputs inativos, wells, áreas de conteúdo "dentro da superfície".

```css
--shadow-inset: inset 2px 2px 5px rgba(var(--shadow-dark-rgb), 0.08),
                inset -2px -2px 5px rgba(var(--shadow-light-rgb), 0.9);
```

#### **Elevação 1 — Baixa (Card padrão, itens de lista)**
Usado em: cards normais, list items, table rows hover, sidebar items.

```css
--shadow-sm: 
  4px 4px 10px rgba(var(--shadow-dark-rgb), 0.06),
  -4px -4px 10px rgba(var(--shadow-light-rgb), 0.85);

/* Alternativa para backgrounds não-brancos */
--shadow-sm-warm:
  4px 4px 12px rgba(26, 24, 20, 0.07),
  -4px -4px 12px rgba(255, 253, 248, 0.88);
```

#### **Elevação 2 — Média (Cards de destaque, hover states, dropdowns)**
Usado em: cards KPI, cards clicáveis em hover, popovers, dropdowns, tags.

```css
--shadow-md:
  6px 6px 16px rgba(var(--shadow-dark-rgb), 0.10),
  -6px -6px 16px rgba(var(--shadow-light-rgb), 0.90);
```

#### **Elevação 3 — Alta (Modais, drawers, sheets)**
Usado em: modais de dialog, sidepanel drawers, bottom sheets.

```css
--shadow-lg:
  10px 10px 30px rgba(var(--shadow-dark-rgb), 0.14),
  -10px -10px 30px rgba(var(--shadow-light-rgb), 0.92);

/* Para modais sobre backdrop escuro, versão simplificada: */
--shadow-modal:
  0px 20px 60px rgba(var(--shadow-dark-rgb), 0.25),
  0px 8px 24px rgba(var(--shadow-dark-rgb), 0.12);
```

#### **Elevação Primária (Botão solid ativo, accent cards)**
Usado em: botão primário sólido, cards com acento de cor.

```css
--shadow-primary:
  4px 4px 12px rgba(232, 81, 26, 0.25),
  -2px -2px 8px rgba(255, 255, 253, 0.80);

/* Hover do botão primário */
--shadow-primary-hover:
  6px 6px 18px rgba(232, 81, 26, 0.35),
  -3px -3px 10px rgba(255, 255, 253, 0.85);
```

#### **Elevação Focus (Ring de acessibilidade)**
Substitui o outline padrão do browser. Nunca remova sem substituir.

```css
--shadow-focus:
  0 0 0 3px rgba(232, 81, 26, 0.20),
  4px 4px 10px rgba(var(--shadow-dark-rgb), 0.06),
  -4px -4px 10px rgba(var(--shadow-light-rgb), 0.85);
```

---

### 4.4 Tabela de Uso por Contexto

| Contexto | Shadow Token | Estado |
|---|---|---|
| Card padrão (estático) | `--shadow-sm` | Default |
| Card clicável (hover) | `--shadow-md` | Hover |
| Card clicável (pressed) | `--shadow-inset` | Active |
| Input texto | `--shadow-inset` | Default |
| Input texto (focus) | `--shadow-focus` | Focus |
| Botão primário (solid) | `--shadow-primary` | Default |
| Botão primário (hover) | `--shadow-primary-hover` | Hover |
| Botão primário (pressed) | `--shadow-inset` + tint | Active |
| Dropdown / Popover | `--shadow-md` | Visible |
| Modal / Dialog | `--shadow-modal` | Visible |
| Sidebar (flutuante) | `--shadow-lg` | Default |
| Tooltip | `--shadow-sm` | Visible |
| Badge (flat, sem sombra) | `none` | Default |

---

### 4.5 Borders e Linhas Divisórias

No Soft UI, borders são quase invisíveis. Eles existem para acessibilidade, não para decoração.

```css
/* Border tokens */
--border-width-sm:  1px;
--border-width-md:  1.5px;
--border-width-lg:  2px;

/* Border colors */
--border-default:   rgba(26, 24, 20, 0.08);   /* Cards, containers */
--border-input:     rgba(26, 24, 20, 0.12);   /* Inputs inativos */
--border-focus:     #E8511A;                  /* Input em focus */
--border-error:     #EF4444;                  /* Input com erro */
--border-strong:    rgba(26, 24, 20, 0.20);   /* Divisores de seção */
--border-subtle:    rgba(26, 24, 20, 0.05);   /* Divisores internos de card */

/* Divider line */
--divider: 1px solid var(--border-default);
```

**Regra:** Em superfícies brancas (`--color-surface-1`), use `--border-default`. A sombra Soft UI já cria separação suficiente — a borda serve apenas como fallback de acessibilidade para usuários com alto contraste ativado.

---

### 4.6 Transições e Micro-animações

```css
/* Easing curves */
--ease-default:   cubic-bezier(0.4, 0, 0.2, 1);  /* Material standard */
--ease-out:       cubic-bezier(0, 0, 0.2, 1);     /* Entrar em tela */
--ease-in:        cubic-bezier(0.4, 0, 1, 1);     /* Sair de tela */
--ease-spring:    cubic-bezier(0.34, 1.56, 0.64, 1); /* Micro-bounce (modais) */

/* Durations */
--duration-instant: 50ms;   /* Feedback visual imediato (checkbox tick) */
--duration-fast:    150ms;  /* Hover states, cor de botão */
--duration-default: 200ms;  /* Sombras, transforms de card */
--duration-slow:    300ms;  /* Modais entrando, drawers */
--duration-slower:  400ms;  /* Page transitions */

/* Transition shorthands */
--transition-shadow:     box-shadow var(--duration-default) var(--ease-out);
--transition-transform:  transform var(--duration-default) var(--ease-out);
--transition-colors:     background-color var(--duration-fast) var(--ease-default),
                         color var(--duration-fast) var(--ease-default),
                         border-color var(--duration-fast) var(--ease-default);
--transition-all:        all var(--duration-default) var(--ease-out);
```

**Regras críticas de animação:**
1. Nunca anime `width`, `height` ou `padding` — sempre prefira `transform: scale()`.
2. `box-shadow` pode ser animado diretamente (sem custo de GPU alto como layout).
3. Use `transform: translateY(-2px)` + sombra maior para hover de cards — não mude tamanho.
4. Respeite `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

### 4.7 Estados de Interação (Estado Machine de Sombras)

```
Card Clicável:

DEFAULT ──────► HOVER ──────► ACTIVE ──────► DEFAULT
[shadow-sm]  [shadow-md]  [shadow-inset] [shadow-sm]
             [translateY  [translateY
              (-2px)]      (0px)]

Input:

DEFAULT ──────► FOCUS ──────► FILLED ──────► ERROR
[inset]     [focus ring]   [inset]       [inset]
            [border:       [border:      [border:
             primary]       default]      error]
```

---

*Próximo arquivo: `ui-guidelines-03-components.md` — Inputs, Botões, Cards, Navegação*
