# UI Guidelines — Parte 01: Fundações de Design
**White Minimalist SaaS — Soft UI Edition**
*Engenharia reversa das referências visuais KP & Kromap*

---

## 0. Filosofia de Design

> "A ferramenta é a mesma. A direção muda tudo."

O sistema visual das referências é construído sobre **três pilares irredutíveis**:

1. **Contraste editorial**: Títulos ultra-pesados coexistem com whitespace generoso — a tensão cria hierarquia sem precisar de decoração.
2. **Acento cirúrgico**: Uma cor quente (laranja) e uma cor de tensão (pink/magenta) são os únicos cromáticos permitidos. Tudo o mais é neutro.
3. **Profundidade suave**: Sombras não demarcam — elas *elevam*. Interfaces Soft UI flutuam, não dividem.

Para o contexto SaaS, esses pilares se traduzem em: **Clean > Decorativo, Funcional > Expressivo, Sutil > Óbvio.**

---

## 1. Paleta de Cores (Design Tokens)

### 1.1 Backgrounds Globais

Nas referências, o fundo é um cream quente (`~#EDE9E3`). Para a interface SaaS White Minimalist, deslocamos para quase-branco mantendo o calor de temperatura de cor.

```css
/* CSS Custom Properties — Backgrounds */
--color-bg-base:       #F7F6F4;  /* App shell, page background */
--color-bg-subtle:     #F0EEE9;  /* Sidebar, nav lateral, zebra de tabelas */
--color-bg-muted:      #E8E5DF;  /* Dividers, estado vazio (empty state) */
--color-bg-inverse:    #1A1A18;  /* Tooltips dark, badges escuros */
```

**Regra de uso:**
- `--color-bg-base` é o único background permitido para a tela principal.
- `--color-bg-subtle` nunca aparece no centro do viewport — apenas em painéis laterais ou topo.
- Nunca use `#FFFFFF` puro. O branco absoluto causa fadiga visual em longas sessões de SaaS.

---

### 1.2 Superfícies (Cards e Containers)

```css
/* CSS Custom Properties — Surfaces */
--color-surface-1:     #FFFFFF;  /* Card padrão, form container */
--color-surface-2:     #FAFAF8;  /* Card elevado secundário, dropdown */
--color-surface-3:     #F3F1EC;  /* Input background, tag, chip */
--color-surface-overlay: rgba(255, 255, 255, 0.85); /* Glassmorphism leve, modal backdrop */
```

**Regra de uso:**
- `--color-surface-1` + sombra Nível 1 = card padrão.
- `--color-surface-1` + sombra Nível 2 = dropdown e popover.
- `--color-surface-1` + sombra Nível 3 + backdrop = modal.

---

### 1.3 Cores Primárias e Secundárias de Ação

Extraídas diretamente das referências: o laranja-tijolo dominante e o pink/magenta como acento de tensão.

```css
/* Primária — Laranja (ação principal, botões, links, progresso) */
--color-primary-50:    #FFF3EE;  /* Background tints, alertas suaves */
--color-primary-100:   #FFE2D0;
--color-primary-200:   #FFB896;
--color-primary-300:   #FF8A57;
--color-primary-400:   #F56225;
--color-primary-500:   #E8511A;  /* ← TOKEN PRINCIPAL — botão solid, links */
--color-primary-600:   #C94010;  /* Hover state */
--color-primary-700:   #A83208;  /* Active/pressed state */
--color-primary-800:   #7A2204;
--color-primary-900:   #4D1502;

/* Secundária — Pink/Magenta (acento, badges, status crítico positivo) */
--color-secondary-50:  #FFF0F5;
--color-secondary-100: #FFD6E5;
--color-secondary-300: #F5718F;
--color-secondary-500: #E83560;  /* ← TOKEN SECUNDÁRIO */
--color-secondary-600: #C42550;
--color-secondary-700: #9E1A3E;
```

**Regra de uso:**
- `--color-primary-500` é a **única** cor de ação permitida para CTAs principais.
- `--color-secondary-500` serve exclusivamente para: badges de destaque, indicadores de progresso avançado, tooltips de urgência.
- Nunca use primária e secundária no mesmo componente simultaneamente (exceto gradientes controlados — ver Seção de Efeitos).
- **Gradient autorizado**: `linear-gradient(135deg, #E8511A 0%, #E83560 100%)` — uso restrito a ilustrações, banners de hero, empty states visuais.

---

### 1.4 Escala de Cinzas para Tipografia

```css
/* Escala de grays — Tipografia */
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

### 1.5 Cores Semânticas de Feedback

```css
/* Sucesso */
--color-success-50:  #F0FDF4;
--color-success-500: #22C55E;
--color-success-600: #16A34A;
--color-success-bg:  #DCFCE7;  /* Background de alert success */
--color-success-border: #BBF7D0;

/* Erro */
--color-error-50:   #FFF1F2;
--color-error-500:  #EF4444;
--color-error-600:  #DC2626;
--color-error-bg:   #FFE4E6;
--color-error-border: #FECDD3;

/* Aviso */
--color-warning-50:   #FFFBEB;
--color-warning-500:  #F59E0B;
--color-warning-600:  #D97706;
--color-warning-bg:   #FEF3C7;
--color-warning-border: #FDE68A;

/* Informação (usa a primária com opacidade) */
--color-info-50:    #FFF3EE;
--color-info-500:   #E8511A;
--color-info-bg:    #FFE2D0;
--color-info-border: #FFB896;
```

**Regra crítica:** As cores semânticas nunca são usadas para decoração. Verde = operação bem-sucedida. Vermelho = erro que requer ação do usuário. Amarelo = aviso que não bloqueia. Nunca use verde para destacar features ou vermelho para deletar sem confirmação modal.

---

## 2. Tipografia e Hierarquia

### 2.1 Família Tipográfica

A análise das referências revela **duas famílias em uso combinado**:

1. **Grotesque Bold para headlines** — nas referências parece ser Inter ExtraBold/Black ou similar (alto contraste de peso, x-height elevado).
2. **Monospace para labels e metadados técnicos** — usado nos rótulos de seção (SÍNTESE, NEGÓCIO, KROMAP/INSIGHT) e dados técnicos.

**Stack recomendado para SaaS:**

```css
/* Primária — Corpo e Títulos */
--font-family-sans: 'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif;

/* Monospace — Labels técnicos, código, badges de versão, IDs */
--font-family-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;

/* Fallback system */
--font-family-system: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

**Alternativa premium (mais fiel às referências):**
- `Space Grotesk` (Google Fonts, gratuita) — x-height alto, excelente legibilidade, personalidade editorial similar às referências.
- `Space Mono` para os labels — irmã tipográfica, garante coesão.

---

### 2.2 Escala Tipográfica

Sistema modular baseado em razão de 1.250 (Major Third), com ajustes para SaaS.

```css
/* Font Sizes */
--text-xs:    0.75rem;   /* 12px — Micro labels, badges, tooltips */
--text-sm:    0.875rem;  /* 14px — Body small, helper text, table cells */
--text-base:  1rem;      /* 16px — Body padrão, inputs */
--text-lg:    1.125rem;  /* 18px — Body grande, card titles */
--text-xl:    1.25rem;   /* 20px — H4 / subtítulos de seção */
--text-2xl:   1.5rem;    /* 24px — H3 */
--text-3xl:   1.875rem;  /* 30px — H2 */
--text-4xl:   2.25rem;   /* 36px — H1 de página */
--text-5xl:   3rem;      /* 48px — Display / Hero */
--text-6xl:   3.75rem;   /* 60px — Display XL / Landing page */

/* Line Heights */
--leading-none:    1;
--leading-tight:   1.2;   /* Títulos grandes (H1, Display) */
--leading-snug:    1.35;  /* H2, H3 */
--leading-normal:  1.5;   /* Body padrão */
--leading-relaxed: 1.65;  /* Body longo, artigos */

/* Letter Spacing */
--tracking-tight:  -0.025em;  /* Títulos grandes */
--tracking-normal:  0em;
--tracking-wide:    0.05em;   /* Labels monospace, all-caps */
--tracking-wider:   0.1em;    /* Micro labels, badges */
```

---

### 2.3 Pesos e Hierarquia Completa

```css
/* Font Weights */
--font-regular:    400;
--font-medium:     500;
--font-semibold:   600;
--font-bold:       700;
--font-extrabold:  800;  /* Títulos de impacto — fiel às referências */
--font-black:      900;  /* Display/Hero apenas */
```

| Nível | Tamanho | Peso | Line-height | Letter-spacing | Uso |
|---|---|---|---|---|---|
| **Display** | `--text-6xl` / `--text-5xl` | `900` (Black) | `--leading-none` | `--tracking-tight` | Hero, landing, onboarding splash |
| **H1** | `--text-4xl` | `800` (ExtraBold) | `--leading-tight` | `--tracking-tight` | Título de página principal |
| **H2** | `--text-3xl` | `700` (Bold) | `--leading-tight` | `-0.015em` | Seção principal, sidebar title |
| **H3** | `--text-2xl` | `700` (Bold) | `--leading-snug` | `0` | Card title, subseção |
| **H4** | `--text-xl` | `600` (SemiBold) | `--leading-snug` | `0` | Widget title, panel header |
| **Body Large** | `--text-lg` | `400` (Regular) | `--leading-normal` | `0` | Descrições de feature |
| **Body** | `--text-base` | `400` (Regular) | `--leading-normal` | `0` | Texto de conteúdo padrão |
| **Body Medium** | `--text-base` | `500` (Medium) | `--leading-normal` | `0` | Texto de destaque inline |
| **Small** | `--text-sm` | `400` (Regular) | `--leading-relaxed` | `0` | Helper text, metadados |
| **Label** | `--text-xs` | `600` (SemiBold) | `1` | `--tracking-wide` | Form labels, column headers |
| **Micro** | `--text-xs` | `500` (Medium) | `1` | `--tracking-wider` | Badges, status tags (UPPERCASE) |
| **Mono Label** | `--text-xs` / `--text-sm` | `500` | `1` | `--tracking-wide` | IDs, versões, timestamps técnicos |

**Regra crítica — fiel às referências:**
Labels de categoria de seção (ex: "NEGÓCIO", "SÍNTESE") devem ser renderizados em `font-family-mono`, `--text-xs`, `font-weight: 500`, `letter-spacing: --tracking-wider`, `text-transform: uppercase`, cor `--color-primary-500`. Um retângulo de `2px × 16px` na cor primária deve aparecer imediatamente acima, como visto nos slides.

---

## 3. Tokens Consolidados (JSON para Design Tools)

```json
{
  "color": {
    "bg": {
      "base":    { "value": "#F7F6F4" },
      "subtle":  { "value": "#F0EEE9" },
      "muted":   { "value": "#E8E5DF" },
      "inverse": { "value": "#1A1A18" }
    },
    "surface": {
      "1": { "value": "#FFFFFF" },
      "2": { "value": "#FAFAF8" },
      "3": { "value": "#F3F1EC" }
    },
    "primary": {
      "500": { "value": "#E8511A" },
      "600": { "value": "#C94010" },
      "700": { "value": "#A83208" }
    },
    "secondary": {
      "500": { "value": "#E83560" },
      "600": { "value": "#C42550" }
    },
    "gray": {
      "900": { "value": "#111110" },
      "700": { "value": "#3D3D3A" },
      "500": { "value": "#7A7A74" },
      "300": { "value": "#C2C2BA" },
      "100": { "value": "#ECEAE4" }
    }
  },
  "typography": {
    "fontFamily": {
      "sans": { "value": "'Inter', -apple-system, sans-serif" },
      "mono": { "value": "'JetBrains Mono', monospace" }
    }
  }
}
```

---

*Próximo arquivo: `ui-guidelines-02-spatial-elevation.md` — Espaçamento, Grid e Sombras Soft UI*
