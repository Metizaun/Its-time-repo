# 🎨 01 — Design Tokens
**White Minimalist SaaS — Soft UI Edition**

> Fonte única de verdade para todas as variáveis visuais do sistema.
> **Zero valores hardcoded fora de `src/index.css`.**

---

## 1. Cores — Backgrounds

```css
/* Backgrounds Globais */
--color-bg-base:       #F7F6F4;  /* App shell, page background */
--color-bg-subtle:     #F0EEE9;  /* Sidebar, nav lateral, zebra de tabelas */
--color-bg-muted:      #E8E5DF;  /* Dividers, empty states */
--color-bg-inverse:    #1A1A18;  /* Tooltips dark, badges escuros */
```

**Regras:**
- `--color-bg-base` é o **único** background permitido para a tela principal
- `--color-bg-subtle` nunca aparece no centro do viewport — apenas painéis laterais ou topo
- **Nunca use `#FFFFFF` puro como fundo de página** — branco absoluto causa fadiga visual

---

## 2. Cores — Superfícies (Cards e Containers)

```css
--color-surface-1:       #FFFFFF;               /* Card padrão, form container */
--color-surface-2:       #FAFAF8;               /* Card secundário, dropdown */
--color-surface-3:       #F3F1EC;               /* Input background, tag, chip */
--color-surface-overlay: rgba(255,255,255,0.85);/* Glassmorphism leve, modal backdrop */
```

**Regras de combinação:**
| Combinação | Uso |
|---|---|
| `surface-1` + `shadow-sm` | Card padrão |
| `surface-1` + `shadow-md` | Dropdown e popover |
| `surface-1` + `shadow-modal` + backdrop | Modal |

---

## 3. Cores — Primária (Laranja)

```css
--color-primary-50:   #FFF3EE;  /* Background tints, alertas suaves */
--color-primary-100:  #FFE2D0;
--color-primary-200:  #FFB896;
--color-primary-300:  #FF8A57;
--color-primary-400:  #F56225;
--color-primary-500:  #E8511A;  /* ← TOKEN PRINCIPAL — botão solid, links, CTAs */
--color-primary-600:  #C94010;  /* Hover state */
--color-primary-700:  #A83208;  /* Active/pressed state */
--color-primary-800:  #7A2204;
--color-primary-900:  #4D1502;
```

**Regras:**
- `--color-primary-500` é a **única** cor de ação para CTAs principais
- Nunca primária e secundária no mesmo componente funcional; gradientes editoriais são limitados aos usos documentados abaixo
- Nunca crie gradientes ad hoc fora dos quatro tokens autorizados

---

## 4. Cores — Secundária (Pink/Magenta)

```css
--color-secondary-50:   #FFF0F5;
--color-secondary-100:  #FFD6E5;
--color-secondary-300:  #F5718F;
--color-secondary-500:  #E83560;  /* ← TOKEN SECUNDÁRIO */
--color-secondary-600:  #C42550;
--color-secondary-700:  #9E1A3E;
```

**Uso exclusivo:** badges de destaque, indicadores de progresso avançado, tooltips de urgência.

### Gradientes editoriais

```css
--gradient-orange-coral: linear-gradient(135deg, #FF5A1F 0%, #FF6848 50%, #F0525D 100%);
--gradient-coral-pink: linear-gradient(135deg, #F45B42 0%, #F45362 52%, #EB3F78 100%);
--gradient-orange-pink-electric: linear-gradient(90deg, #FF4B16 0%, #FF534D 45%, #F52D73 100%);
--gradient-coral-pink-soft: linear-gradient(135deg, #FF8A6C 0%, #F68F89 48%, #F3A1B2 100%);
```

**Uso permitido:** ilustrações, arte de hero/empty state, barra de acento e suportes visuais de ícones editoriais. Os gradientes podem substituir badges decorativos de categoria quando o ícone e o contexto já comunicam a informação.

**Uso proibido:** botões, texto corrido, campos, formulários, cards completos, fundos de superfícies operacionais e qualquer elemento cujo contraste dependa de texto sobre o degradê.

| Token | Papel visual |
|---|---|
| `--gradient-orange-coral` | início, ação, velocidade ou transformação |
| `--gradient-coral-pink` | tecnologia humana, intensidade e modernidade |
| `--gradient-orange-pink-electric` | indicador editorial de maior impacto |
| `--gradient-coral-pink-soft` | profundidade visual secundária e destaques suaves |

---

## 5. Cores — Escala de Cinzas (Tipografia)

```css
--color-gray-900:  #111110;  /* Títulos H1, H2 — texto principal */
--color-gray-800:  #2A2A28;  /* H3, body bold */
--color-gray-700:  #3D3D3A;  /* Body regular, texto de form */
--color-gray-600:  #5C5C58;  /* Labels de input, helper text */
--color-gray-500:  #7A7A74;  /* Placeholder text */
--color-gray-400:  #9E9E96;  /* Texto desabilitado */
--color-gray-300:  #C2C2BA;  /* Borders padrão, dividers */
--color-gray-200:  #D8D8D0;  /* Borders de input inativo */
--color-gray-100:  #ECEAE4;  /* Borders muito sutis */
--color-gray-50:   #F5F4F0;  /* Background alternate rows */
```

**Hierarquia obrigatória:**
| Elemento | Token |
|---|---|
| Título de página (H1) | `--color-gray-900` |
| Título de seção (H2/H3) | `--color-gray-800` |
| Corpo de texto | `--color-gray-700` |
| Labels e metadados | `--color-gray-600` |
| Placeholder | `--color-gray-500` |
| Disabled | `--color-gray-400` |

---

## 6. Cores — Semânticas de Feedback

```css
/* Sucesso */
--color-success-50:     #F0FDF4;
--color-success-500:    #22C55E;
--color-success-600:    #16A34A;
--color-success-bg:     #DCFCE7;
--color-success-border: #BBF7D0;

/* Erro */
--color-error-50:       #FFF1F2;
--color-error-500:      #EF4444;
--color-error-600:      #DC2626;
--color-error-bg:       #FFE4E6;
--color-error-border:   #FECDD3;

/* Aviso */
--color-warning-50:     #FFFBEB;
--color-warning-500:    #F59E0B;
--color-warning-600:    #D97706;
--color-warning-bg:     #FEF3C7;
--color-warning-border: #FDE68A;

/* Informação (usa primária com opacidade) */
--color-info-50:        #FFF3EE;
--color-info-500:       #E8511A;
--color-info-bg:        #FFE2D0;
--color-info-border:    #FFB896;
```

> ⚠️ Cores semânticas **nunca** são usadas para decoração. Verde = operação bem-sucedida. Vermelho = erro. Amarelo = aviso não bloqueante.

---

## 7. Tipografia

### Famílias
```css
--font-family-sans:   'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif;
--font-family-mono:   'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
--font-family-system: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

> **Alternativa premium:** `Space Grotesk` + `Space Mono` (Google Fonts) — mais fiel às referências visuais KP & Kromap.

### Escala de Tamanhos
```css
--text-xs:   0.75rem;   /* 12px — Micro labels, badges, tooltips */
--text-sm:   0.875rem;  /* 14px — Body small, helper text, table cells */
--text-base: 1rem;      /* 16px — Body padrão, inputs */
--text-lg:   1.125rem;  /* 18px — Body grande, card titles */
--text-xl:   1.25rem;   /* 20px — H4 / subtítulos de seção */
--text-2xl:  1.5rem;    /* 24px — H3 */
--text-3xl:  1.875rem;  /* 30px — H2 */
--text-4xl:  2.25rem;   /* 36px — H1 de página */
--text-5xl:  3rem;      /* 48px — Display / Hero */
--text-6xl:  3.75rem;   /* 60px — Display XL / Landing page */
```

### Line Heights
```css
--leading-none:    1;
--leading-tight:   1.2;   /* Títulos grandes (H1, Display) */
--leading-snug:    1.35;  /* H2, H3 */
--leading-normal:  1.5;   /* Body padrão */
--leading-relaxed: 1.65;  /* Body longo, artigos */
```

### Letter Spacing
```css
--tracking-tight:  -0.025em;  /* Títulos grandes */
--tracking-normal:  0em;
--tracking-wide:    0.05em;   /* Labels monospace, all-caps */
--tracking-wider:   0.1em;    /* Micro labels, badges */
```

### Pesos
```css
--font-regular:   400;
--font-medium:    500;
--font-semibold:  600;
--font-bold:      700;
--font-extrabold: 800;  /* Títulos de impacto */
--font-black:     900;  /* Display/Hero apenas */
```

### Hierarquia Completa
| Nível | Tamanho | Peso | Line-height | Letter-spacing | Uso |
|---|---|---|---|---|---|
| **Display** | `--text-6xl/5xl` | 900 | `leading-none` | `tracking-tight` | Hero, onboarding |
| **H1** | `--text-4xl` | 800 | `leading-tight` | `tracking-tight` | Título de página |
| **H2** | `--text-3xl` | 700 | `leading-tight` | `-0.015em` | Seção principal |
| **H3** | `--text-2xl` | 700 | `leading-snug` | `0` | Card title |
| **H4** | `--text-xl` | 600 | `leading-snug` | `0` | Widget title |
| **Body Large** | `--text-lg` | 400 | `leading-normal` | `0` | Descrições |
| **Body** | `--text-base` | 400 | `leading-normal` | `0` | Conteúdo |
| **Body Medium** | `--text-base` | 500 | `leading-normal` | `0` | Destaque inline |
| **Small** | `--text-sm` | 400 | `leading-relaxed` | `0` | Helper, meta |
| **Label** | `--text-xs` | 600 | `1` | `tracking-wide` | Form labels |
| **Micro** | `--text-xs` | 500 | `1` | `tracking-wider` | Badges (UPPERCASE) |
| **Mono Label** | `--text-xs/sm` | 500 | `1` | `tracking-wide` | IDs, timestamps |

> **Regra crítica:** Labels de seção (ex: "NEGÓCIO", "SÍNTESE") → `font-family-mono`, `text-xs`, `weight 500`, `tracking-wider`, `uppercase`, `color primary-500`, com retângulo `2px × 20px` na cor primária acima via `::before`.

---

## 8. Espaçamento (Base 4px)

```css
--space-0:   0px;
--space-1:   4px;    /* Micro — gap entre ícone e label */
--space-2:   8px;    /* XS — padding de badge, tag */
--space-3:   12px;   /* SM — gap de itens inline */
--space-4:   16px;   /* MD — padding de input, gap padrão */
--space-5:   20px;   /* LG — gap entre elementos de form */
--space-6:   24px;   /* XL — padding de card */
--space-8:   32px;   /* 2XL — espaço entre seções */
--space-10:  40px;   /* 3XL — margin de página */
--space-12:  48px;   /* 4XL — hero padding vertical */
--space-16:  64px;   /* 5XL — separação de blocos */
--space-20:  80px;   /* 6XL — seções de landing */
--space-24:  96px;
--space-32:  128px;
```

**Mnemônica:**
- `space-2` (8px) → interior de chips/badges
- `space-4` (16px) → padding interno de inputs e botões
- `space-6` (24px) → padding interno de cards
- `space-8` (32px) → gap entre cards no grid
- `space-10` (40px) → margin vertical entre seções

---

## 9. Border Radius

```css
--radius-none:  0px;
--radius-xs:    4px;     /* Tags inline, chips pequenos */
--radius-sm:    6px;     /* Badges, avatars quadrados */
--radius-md:    8px;     /* Inputs, selects, textareas */
--radius-lg:    12px;    /* Botões padrão, dropdowns, tooltips */
--radius-xl:    16px;    /* Cards padrão, panels */
--radius-2xl:   20px;    /* Cards de destaque, widget KPI */
--radius-3xl:   24px;    /* Modais, sidepanels, drawers */
--radius-full:  9999px;  /* Pills, badges redondos, toggles */
```

**Tabela de aplicação:**
| Componente | Radius |
|---|---|
| Input, Select, Textarea | `--radius-md` (8px) |
| Botão SM | `--radius-lg` (12px) |
| Botão MD (padrão) | `--radius-lg` (12px) |
| Botão LG | `--radius-xl` (16px) |
| Botão Pill | `--radius-full` |
| Card padrão | `--radius-xl` (16px) |
| Card KPI/Stat | `--radius-2xl` (20px) |
| Modal | `--radius-3xl` (24px) |
| Dropdown / Popover | `--radius-xl` (16px) |
| Tooltip | `--radius-lg` (12px) |
| Badge/Tag | `--radius-xs` (4px) ou `--radius-full` |
| Avatar | `--radius-full` |
| Sidebar nav item hover | `--radius-lg` (12px) |
| Table row | `--radius-none` (exceção) |
| Progress bar track | `--radius-full` |

---

## 10. Alturas de Componentes Interativos

```css
--height-input-sm:  32px;
--height-input-md:  40px;   /* Padrão */
--height-input-lg:  48px;
--height-input-xl:  56px;   /* Hero forms */

/* Paddings internos de inputs */
--input-px-sm:  12px;
--input-px-md:  16px;
--input-px-lg:  20px;

/* Paddings de botões */
--btn-py-sm:  6px;   --btn-px-sm:  12px;
--btn-py-md:  10px;  --btn-px-md:  16px;
--btn-py-lg:  14px;  --btn-px-lg:  24px;
--btn-py-xl:  18px;  --btn-px-xl:  32px;
```

---

## 11. Sombras Soft UI

### Cores base das sombras
```css
--shadow-dark-rgb:  26, 24, 20;     /* Derivado de gray-900 */
--shadow-light-rgb: 255, 255, 253;  /* Quase-branco quente */
```

### Tokens de Elevação
```css
/* Elevação 0 — Inset / Pressed (inputs, wells) */
--shadow-inset:
  inset 2px 2px 5px rgba(26, 24, 20, 0.08),
  inset -2px -2px 5px rgba(255, 255, 253, 0.90);

/* Elevação 1 — Baixa (cards estáticos, list items) */
--shadow-sm:
  4px 4px 10px rgba(26, 24, 20, 0.06),
  -4px -4px 10px rgba(255, 255, 253, 0.85);

/* Elevação 1 — Variante warm (fundos não-brancos) */
--shadow-sm-warm:
  4px 4px 12px rgba(26, 24, 20, 0.07),
  -4px -4px 12px rgba(255, 253, 248, 0.88);

/* Elevação 2 — Média (hover de cards, dropdowns, popovers) */
--shadow-md:
  6px 6px 16px rgba(26, 24, 20, 0.10),
  -6px -6px 16px rgba(255, 255, 253, 0.90);

/* Elevação 3 — Alta (modais, drawers, sheets) */
--shadow-lg:
  10px 10px 30px rgba(26, 24, 20, 0.14),
  -10px -10px 30px rgba(255, 255, 253, 0.92);

/* Modal sobre backdrop escuro */
--shadow-modal:
  0px 20px 60px rgba(26, 24, 20, 0.25),
  0px 8px 24px rgba(26, 24, 20, 0.12);

/* Botão primário sólido */
--shadow-primary:
  4px 4px 12px rgba(232, 81, 26, 0.25),
  -2px -2px 8px rgba(255, 255, 253, 0.80);

/* Hover do botão primário */
--shadow-primary-hover:
  6px 6px 18px rgba(232, 81, 26, 0.35),
  -3px -3px 10px rgba(255, 255, 253, 0.85);

/* Focus ring de acessibilidade */
--shadow-focus:
  0 0 0 3px rgba(232, 81, 26, 0.20),
  4px 4px 10px rgba(26, 24, 20, 0.06),
  -4px -4px 10px rgba(255, 255, 253, 0.85);
```

### Tabela de uso por contexto
| Contexto | Token | Estado |
|---|---|---|
| Card padrão (estático) | `--shadow-sm` | Default |
| Card clicável (hover) | `--shadow-md` | Hover |
| Card clicável (pressed) | `--shadow-inset` | Active |
| Input | `--shadow-inset` | Default |
| Input (focus) | `--shadow-focus` | Focus |
| Botão primário | `--shadow-primary` | Default |
| Botão primário (hover) | `--shadow-primary-hover` | Hover |
| Botão primário (pressed) | `--shadow-inset` | Active |
| Dropdown / Popover | `--shadow-md` | Visible |
| Modal / Dialog | `--shadow-modal` | Visible |
| Sidebar flutuante | `--shadow-lg` | Default |
| Tooltip | `--shadow-sm` | Visible |
| Badge | `none` | Default |

---

## 12. Bordas

```css
--border-width-sm:  1px;
--border-width-md:  1.5px;
--border-width-lg:  2px;

--border-default:  rgba(26, 24, 20, 0.08);   /* Cards, containers */
--border-input:    rgba(26, 24, 20, 0.12);   /* Inputs inativos */
--border-focus:    #E8511A;                  /* Input em focus */
--border-error:    #EF4444;                  /* Input com erro */
--border-strong:   rgba(26, 24, 20, 0.20);  /* Divisores de seção */
--border-subtle:   rgba(26, 24, 20, 0.05);  /* Divisores internos de card */

--divider: 1px solid var(--border-default);
```

> Em superfícies brancas (`surface-1`), a sombra Soft UI já cria separação. A borda existe apenas como fallback de acessibilidade.

---

## 13. Transições e Micro-animações

```css
/* Easing curves */
--ease-default:  cubic-bezier(0.4, 0, 0.2, 1);      /* Padrão */
--ease-out:      cubic-bezier(0, 0, 0.2, 1);         /* Entrar na tela */
--ease-in:       cubic-bezier(0.4, 0, 1, 1);         /* Sair da tela */
--ease-spring:   cubic-bezier(0.34, 1.56, 0.64, 1); /* Micro-bounce (modais) */

/* Durations */
--duration-instant:  50ms;   /* Feedback imediato (checkbox) */
--duration-fast:     150ms;  /* Hover states, cor de botão */
--duration-default:  200ms;  /* Sombras, transforms de card */
--duration-slow:     300ms;  /* Modais entrando, drawers */
--duration-slower:   400ms;  /* Page transitions */

/* Shorthands */
--transition-shadow:    box-shadow var(--duration-default) var(--ease-out);
--transition-transform: transform var(--duration-default) var(--ease-out);
--transition-colors:    background-color var(--duration-fast) var(--ease-default),
                        color var(--duration-fast) var(--ease-default),
                        border-color var(--duration-fast) var(--ease-default);
--transition-all:       all var(--duration-default) var(--ease-out);
```

---

## 14. Layout Tokens

```css
--layout-topbar-height:      56px;
--layout-sidebar-width:      240px;
--layout-sidebar-collapsed:  64px;
--layout-content-padding:    32px;  /* var(--space-8) */
--layout-content-max-width:  1040px;
--layout-section-gap:        32px;  /* var(--space-8) */

--grid-columns:   12;
--grid-gutter:    24px;
--grid-margin:    32px;
--grid-max-width: 1280px;
```

---

## 15. Regra de Implementação

### `src/index.css`
Todos os tokens vivem em CSS Custom Properties dentro de:
- `:root { }` → valores padrão (light mode, que é o modo principal)
- `.dark { }` → adaptação dark se necessária

### `tailwind.config.ts`
Tokens Tailwind (`--primary`, `--background`, etc.) consumidos via `hsl(var(--xxx))` devem mapear para os custom tokens.

### Regra Absoluta
> 🚫 Zero ocorrências de cor hexadecimal hardcoded fora de `index.css`.
