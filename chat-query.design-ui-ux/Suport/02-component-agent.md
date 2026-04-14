# 02-component-agent — Componentes Visuais Dark Mode

## Papel
Definir a aparência dos componentes de interface do CRM.
Este agente instrui APENAS design. Nenhuma lógica de negócio é alterada.
Todos os valores de cor e espaço vêm exclusivamente de 01-token-agent.md.

## Componentes

### KPI Card (métricas do topo do dashboard)
Exibe um número grande com label e variação percentual.

```css
.kpi-card {
  background:    var(--color-bg-elevated);
  border-radius: var(--radius-md);
  border:        1px solid var(--color-border-subtle);
  padding:       var(--spacing-md) var(--spacing-lg);
}
.kpi-card__label {
  font-size: var(--font-size-label);
  color:     var(--color-text-secondary);
  margin-bottom: var(--spacing-xs);
}
.kpi-card__value {
  font-size:   var(--font-size-hero);
  font-weight: var(--font-weight-bold);
  color:       var(--color-text-primary);
  line-height: 1;
}
.kpi-card__delta {
  font-size: var(--font-size-label);
  margin-top: var(--spacing-xs);
}
.kpi-card__delta--positive { color: var(--color-success); }
.kpi-card__delta--negative { color: var(--color-danger); }
```

### Metric Side Card (flanqueia o funil)
Card menor usado ao lado de cada stage do funil.

```css
.metric-card {
  background:    var(--color-bg-elevated);
  border-radius: var(--radius-md);
  border:        1px solid var(--color-border-subtle);
  padding:       var(--spacing-sm) var(--spacing-md);
  min-width:     120px;
}
.metric-card__label { font-size: var(--font-size-label); color: var(--color-text-secondary); }
.metric-card__value { font-size: var(--font-size-title); font-weight: var(--font-weight-bold); color: var(--color-text-primary); }
.metric-card__delta { font-size: var(--font-size-label); }
.metric-card__delta--positive { color: var(--color-success); }
.metric-card__delta--negative { color: var(--color-danger); }
```

### Status Badge
Indica estado de um lead ou automação.

```css
.badge {
  display:       inline-flex;
  align-items:   center;
  border-radius: var(--radius-pill);
  padding:       2px var(--spacing-sm);
  font-size:     var(--font-size-label);
  font-weight:   var(--font-weight-bold);
}
.badge--active   { background: rgba(76, 175, 130, 0.15); color: var(--color-success); }
.badge--inactive { background: var(--color-accent-soft); color: var(--color-accent); }
.badge--neutral  { background: rgba(255,255,255,0.06);   color: var(--color-text-secondary); }
```

### Button primário
```css
.btn-primary {
  background:    var(--color-accent);
  color:         var(--color-text-primary);
  border:        none;
  border-radius: var(--radius-sm);
  padding:       var(--spacing-sm) var(--spacing-md);
  font-size:     var(--font-size-body);
  font-weight:   var(--font-weight-bold);
  cursor:        pointer;
}
.btn-primary:hover { background: #cc2f30; }
```

## Regras
- **Soft Neumorphism Invertido:** Utilizar drop-shadows macias para destacar componentes de UI principais do fundo (Ex: `0 8px 16px rgba(0,0,0,0.5)`).
- **Glow Controlado e Luz Interna:** Criar profundidade utilizando uma leve linha clara interna no topo dos blocks (`inset 0 1px 1px rgba(255,255,255,0.06)`).
- Hover: aplicar glow sutil ou refletir aumento de iluminação global do bloco com base na Accent Color se interativo.
- Focus: outline 2px var(--color-accent) com offset 2px
- Nunca usar cor clara como fundo, mesmo em hover
