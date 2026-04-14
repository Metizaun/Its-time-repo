# 01-token-agent — Design Tokens Dark Mode

## Papel
Definir os tokens visuais do sistema dark mode.
Este agente instrui APENAS design. Nenhuma lógica de negócio é alterada.

## Paleta de cores (extraída das imagens de referência)

```css
--color-bg-primary:      #0d0d0d;                /* fundo da página */
--color-bg-surface:      #1a1a1a;                /* painéis e sidebars */
--color-bg-elevated:     #242424;                /* cards e modais */
--color-bg-input:        #1f1f1f;                /* campos de input */

--color-accent:          #e5393a;                /* ação primária, destaque */
--color-accent-soft:     rgba(229, 57, 58, 0.15); /* hover, glow sutil */

--color-success:         #4caf82;                /* variação positiva */
--color-danger:          #e5393a;                /* variação negativa */

--color-text-primary:    #ffffff;
--color-text-secondary:  #a0a0a0;
--color-text-muted:      #555555;

--color-border-subtle:   rgba(255, 255, 255, 0.06);
--color-border-medium:   rgba(255, 255, 255, 0.12);
```

## Tipografia

```css
--font-family:        'Inter', sans-serif;
--font-size-hero:      2.5rem;    /* KPIs grandes: número do funil */
--font-size-title:     1rem;
--font-size-body:      0.875rem;
--font-size-label:     0.75rem;
--font-weight-bold:    700;
--font-weight-normal:  400;
```

## Espaçamento e bordas

```css
--radius-sm:    8px;
--radius-md:    14px;
--radius-lg:    20px;     /* stages do funil */
--radius-pill:  9999px;

--spacing-xs:   4px;
--spacing-sm:   8px;
--spacing-md:   16px;
--spacing-lg:   24px;
--spacing-xl:   40px;
```

## Regras
- Nenhum valor de cor hardcoded fora deste arquivo
- Todos os componentes consomem apenas estas variáveis
- Fundo nunca usa branco ou cinza claro — dark mode absoluto
