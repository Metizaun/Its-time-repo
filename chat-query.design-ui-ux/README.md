# 📋 CRM Its Time — Design System v2.1
**White Minimalist SaaS — Soft UI Edition**

> Sistema de design unificado baseado nas referências visuais KP & Kromap.
> Estética: **Soft UI bilateral + Contraste Editorial + Acento Cirúrgico Laranja**.

---

## 📂 Índice de Documentos

| # | Arquivo | Conteúdo |
|---|---|---|
| 00 | [00-manifesto.md](./00-manifesto.md) | Visão, 3 pilares e filosofia |
| 01 | [01-tokens.md](./01-tokens.md) | Cores, tipo, espaçamento, sombras, transições |
| 02 | [02-componentes.md](./02-componentes.md) | Inputs, botões, cards, nav, badges, modal, tabelas |
| 03 | [03-funil.md](./03-funil.md) | Funil de conversão — Soft UI |
| 04 | [04-graficos-dados.md](./04-graficos-dados.md) | Charts com paleta warm neutral |
| 05 | [05-layout-responsividade.md](./05-layout-responsividade.md) | Grid 12-col, SaaS layout, breakpoints |
| 06 | [06-ux-animacoes.md](./06-ux-animacoes.md) | State machine Soft UI, transições, micro-animações |
| 07 | [07-governanca.md](./07-governanca.md) | 8 antipatterns + consistência + contribuição |
| 08 | [08-auditoria.md](./08-auditoria.md) | Checklist pré-deploy (40+ itens) |

---

## ⚡ Quick Reference — Tokens Mais Usados

### Cores
```css
/* Backgrounds */
var(--color-bg-base)        /* #F7F6F4 — fundo da página */
var(--color-bg-subtle)      /* #F0EEE9 — sidebar, nav */
var(--color-bg-muted)       /* #E8E5DF — dividers, empty states */
var(--color-bg-inverse)     /* #1A1A18 — tooltips dark */

/* Superfícies */
var(--color-surface-1)      /* #FFFFFF — cards, modais */
var(--color-surface-2)      /* #FAFAF8 — dropdowns */
var(--color-surface-3)      /* #F3F1EC — inputs, chips */

/* Primária (Laranja — ação) */
var(--color-primary-500)    /* #E8511A — CTA principal */
var(--color-primary-600)    /* #C94010 — hover */
var(--color-primary-700)    /* #A83208 — pressed */
var(--color-primary-50)     /* #FFF3EE — tint de badge/bg */

/* Secundária (Pink — tensão) */
var(--color-secondary-500)  /* #E83560 — uso restrito */

/* Texto */
var(--color-gray-900)       /* #111110 — títulos */
var(--color-gray-700)       /* #3D3D3A — corpo */
var(--color-gray-600)       /* #5C5C58 — labels */
var(--color-gray-500)       /* #7A7A74 — placeholder, mono */
var(--color-gray-400)       /* #9E9E96 — disabled */

/* Semânticas */
var(--color-success-600)    /* #16A34A — delta positivo */
var(--color-error-600)      /* #DC2626 — delta negativo */
```

### Sombras Soft UI
```css
var(--shadow-inset)          /* Elevação 0 — inputs, pressed */
var(--shadow-sm)             /* Elevação 1 — cards estáticos */
var(--shadow-md)             /* Elevação 2 — hover, dropdowns */
var(--shadow-lg)             /* Elevação 3 — modais, drawers */
var(--shadow-modal)          /* Modal sobre backdrop */
var(--shadow-primary)        /* Botão solid default */
var(--shadow-primary-hover)  /* Botão solid hover */
var(--shadow-focus)          /* Focus ring + shadow */
```

### Gradientes editoriais
```css
var(--gradient-orange-coral)
var(--gradient-coral-pink)
var(--gradient-orange-pink-electric)
var(--gradient-coral-pink-soft)
```

Uso restrito a ilustrações, barras de acento e suportes visuais de ícones grandes. Em releases, essa linguagem substitui badges decorativos de categoria.

### Tipografia
```css
var(--text-xs)      /* 12px — labels, badges, mono */
var(--text-sm)      /* 14px — body small, tabelas */
var(--text-base)    /* 16px — body padrão */
var(--text-lg)      /* 18px — body grande */
var(--text-xl)      /* 20px — H4 */
var(--text-2xl)     /* 24px — H3 */
var(--text-3xl)     /* 30px — H2 / KPI value */
var(--text-4xl)     /* 36px — H1 */

var(--font-regular)   /* 400 */
var(--font-medium)    /* 500 */
var(--font-semibold)  /* 600 */
var(--font-bold)      /* 700 */
var(--font-extrabold) /* 800 — KPIs, H1 */
var(--font-black)     /* 900 — Display/Hero */
```

### Border Radius
```css
var(--radius-md)    /* 8px  — inputs */
var(--radius-lg)    /* 12px — botões, nav items */
var(--radius-xl)    /* 16px — cards */
var(--radius-2xl)   /* 20px — KPI cards */
var(--radius-3xl)   /* 24px — modais */
var(--radius-full)  /* 9999px — pills, badges */
```

### Espaçamento
```css
var(--space-2)   /* 8px  — badges, chips */
var(--space-4)   /* 16px — inputs, botões */
var(--space-6)   /* 24px — cards */
var(--space-8)   /* 32px — seções, grid gap */
var(--space-10)  /* 40px — margin de página */
```

---

## 🔑 Regras de Ouro (3)

1. **Fundo da página = `#F7F6F4`** — nunca branco puro
2. **CTA = `#E8511A` sólido** — única cor de ação principal, sem exceção
3. **Elevação = Soft UI bilateral** — toda sombra tem componente escuro + claro

### Quiet luxury operacional

- Uma decisão principal e um editor por superfície.
- Hierarquia, alinhamento e progressive disclosure substituem caixas explicativas.
- Laranja indica ação, foco ou seleção; nunca serve como fundo decorativo para formulários.
- Fluxos mutuamente exclusivos trocam o conteúdo da superfície, sem empilhar experiências concorrentes.

---

## 🔗 Arquivos de Implementação

| Arquivo | Localização | Conteúdo |
|---|---|---|
| CSS Tokens | `src/index.css` | CSS Custom Properties (`:root` e `.dark`) |
| Tailwind Config | `tailwind.config.ts` | Mapeamento HSL → tokens |
| Cores Kanban | `src/lib/colors.ts` | Mapa de cores por instância |

---

## 🚀 Workflow para Mudanças de Design

1. **Leia** `00-manifesto.md` → entenda os 3 pilares
2. **Consulte** `01-tokens.md` → use apenas tokens definidos
3. **Siga** `02-componentes.md` → aplique CSS copiar-colar
4. **Verifique** `07-governanca.md` → evite os 8 antipatterns
5. **Audite** `08-auditoria.md` → passe no checklist antes de commitar

---

*Design System v2.0 — White Minimalist SaaS / Soft UI Edition*
*Baseado em: ui-guidelines-01-foundations + ui-guidelines-02-spatial-elevation + ui-guidelines-03-components*
*Refatoração: Maio 2026*
