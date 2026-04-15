# 02-component-agent — Componentes Visuais Dark Mode

## Papel
Definir a aparência dos componentes de interface do CRM.
Este agente instrui APENAS design. Nenhuma lógica de negócio é alterada.
Todos os valores de cor e espaço vêm exclusivamente de 01-token-agent.md.

## Componentes

### KPI Card (métricas do topo do dashboard)
Exibe um número grande com label e variação percentual.

```css
.kpi-card, .dashboard-card {
  background:    transparent; /* Hollow Card (Cyberpunk Minimalista) */
  border-radius: 24px; 
  border:        1px solid rgba(255, 255, 255, 0.03); /* Borda fantasma tipo vidro */
  border-top:    2px solid var(--color-accent); /* Red Neon Top Glow */
  padding:       var(--spacing-md) var(--spacing-lg);
  box-shadow:    0 8px 32px rgba(229, 57, 58, 0.04), inset 0 30px 40px -20px rgba(255, 255, 255, 0.01); /* Levíssimo glow no topo acompanhando a cor */
}
.kpi-card__label {
  font-size: var(--font-size-label);
  color:     var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: var(--spacing-xs);
  font-weight: 600;
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
  font-weight: bold;
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
- **Dark Hollow Glow (Obrigatório em todos os Cards):** A interface abandona as caixas cinzas pesadas em favor do `bg-transparent` ou `bg-[#0a0a0a]`. As caixas "absorvem" o fundo e flutuam delicadamente através de sombreamentos e transparências. Use `box-shadow: 0 8px 32px rgba(229, 57, 58, 0.04)`.
- **Destaque Neon Top-bar:** Todo card de métrica e gráfico possui um discreto risco `border-t-2 border-[var(--color-accent)]` cintilante.
- **Moldura Vitral (Ghost Borders):** Ao invés de bordas sólidas pesadas, as marcações laterais e inferiores existem como um reflexo macio: `border border-[rgba(255,255,255,0.03)]`.
- **Backgrounds Puros:** O container principal usa fundo Absoluto Base `#0d0d0d` (`var(--color-bg-primary)`).
- **Tipografia nos KPIs:** Labels de blocos usam upper-case forte, tracking-widest e tamanho `10px` a `12px` cinza. Os Valores em si são gigantes, `font-bold` e brancos.
- Hover: aplicar sutil aumento de claridade na base da moldura vitral ou um glow na borda primária, ativando resposta à `Accent Color`.
- Focus: outline 2px var(--color-accent) com offset 2px.
