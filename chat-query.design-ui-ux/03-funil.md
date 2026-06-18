# 🔻 03 — Funil de Conversão
**White Minimalist SaaS — Soft UI Edition**

> Peça central da dashboard do CRM. Define geometria, layout e regras visuais obrigatórias.
> **Apenas aparência muda. Nomes de etapas, estrutura de dados e lógica de negócio permanecem intactos.**

---

## Estrutura Visual — Pirâmide Invertida Vertical

O funil é exibido **verticalmente**, com largura **proporcional ao volume real de leads** de cada etapa. A maior etapa visível ocupa 100%; as demais escalam em relação a ela com mínimo visual para não desaparecerem. Cada stage é um card branco com elevação Soft UI.

> O desenho abaixo e apenas esquematico. A geometria real do produto nunca deve ser fixa por posicao; ela vem de `--funnel-stage-width`.

```
┌─────────────────────────────────────────────┐   ← 100% de largura
│              Impressões                      │
└─────────────────────────────────────────────┘
          ┌──────────────────────────┐            ← 80%
          │         Cliques          │
          └──────────────────────────┘
              ┌──────────────────┐                ← 65%
              │      Leads       │
              └──────────────────┘
                ┌──────────────┐                  ← 55%
                │  Agendaram   │
                └──────────────┘
                  ┌──────────┐                    ← 45%
                  │ Vendidos │
                  └──────────┘
```

---

## Anatomia de Cada Stage Block

```
┌──────────────────────────────────────┐
│  LABEL DA ETAPA                      │  ← mono, text-xs, tracking-wider, uppercase, gray-500
│                                      │
│       VALOR NUMÉRICO GRANDE          │  ← text-3xl (30px), 800, gray-900, tracking-tight
│                                      │
│  +17,1% ↑                           │  ← text-sm, semibold, success-600 / error-600
└──────────────────────────────────────┘
```

### CSS do Stage Block

```css
.funnel-stage {
  background-color: var(--color-surface-1);   /* #FFFFFF */
  border-radius:    var(--radius-xl);          /* 16px */
  border:           var(--border-width-sm) solid var(--border-default);
  margin:           0 auto;
  padding:          var(--space-5) var(--space-6); /* 20px 24px */
  text-align:       center;

  /* Soft UI — Elevação 1 */
  box-shadow: var(--shadow-sm);

  transition: var(--transition-shadow);
}

/* Largura orientada por dado real */
.funnel-stage {
  width: clamp(164px, var(--funnel-stage-width), 100%);
}

/* Label da etapa */
.funnel-stage__label {
  font-family:    var(--font-family-mono);
  font-size:      var(--text-xs);
  font-weight:    var(--font-medium);
  letter-spacing: var(--tracking-wider);
  text-transform: uppercase;
  color:          var(--color-gray-500);
  margin-bottom:  var(--space-1);
}

/* Valor numérico principal */
.funnel-stage__value {
  font-size:      var(--text-3xl);           /* 30px */
  font-weight:    var(--font-extrabold);     /* 800 */
  color:          var(--color-gray-900);
  letter-spacing: var(--tracking-tight);
  line-height:    var(--leading-none);
}

/* Deltas condicionais */
.funnel-stage__delta--positive {
  color:       var(--color-success-600);
  font-size:   var(--text-sm);
  font-weight: var(--font-semibold);
}

.funnel-stage__delta--negative {
  color:       var(--color-error-600);
  font-size:   var(--text-sm);
  font-weight: var(--font-semibold);
}
```

---

## Barra de Acento (Card Accent — opcional)

Para stages com destaque especial (ex: etapa de conversão), aplicar a barra gradient no topo:

```css
.funnel-stage--accent {
  position: relative;
}

.funnel-stage--accent::before {
  content:       '';
  position:      absolute;
  top:           0;
  left:          0;
  right:         0;
  height:        3px;
  background:    linear-gradient(90deg, #E8511A 0%, #E83560 100%);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
}
```

---

## Connector entre Stages

```css
.funnel-connector {
  width:      1px;
  height:     var(--space-4);            /* 16px */
  background: var(--border-default);
  margin:     0 auto;
}
```

> ⚠️ Nunca substituir por ícone decorativo, seta ou divisor gráfico.

---

## Metric Cards Laterais (KPIs Axiais)

Ficam **FORA** dos stage blocks, nas laterais. Usar `.card-kpi` de `02-componentes.md`:

```
  ┌──────────┐     ┌──────────────────┐     ┌──────────┐
  │ C/Clique │─────│   Impressões     │─────│Taxa 100% │
  │  R$ 0,80 │     │     13.255       │     │          │
  └──────────┘     └──────────────────┘     └──────────┘
       ↑                                          ↑
  Coluna Esquerda                       Coluna Direita
  (Custo por etapa)                  (Taxa de conversão)
```

### Linhas Conectoras Laterais

```css
.funnel-connector-lateral {
  height:     1px;
  background: var(--border-subtle);
  flex:       1;
}

/* Bolinha-ponto na junção com o funil */
.funnel-connector-dot {
  width:            6px;
  height:           6px;
  border-radius:    var(--radius-full);
  background-color: var(--color-gray-300);
  flex-shrink:      0;
}
```

---

## Layout Geral do Funil

```css
.funnel-wrapper {
  display:        flex;
  flex-direction: column;
  align-items:    center;
  gap:            0;
  background:     var(--color-bg-base);     /* #F7F6F4 */
  padding:        var(--space-10);          /* 40px */
}

.funnel-row {
  display:         flex;
  align-items:     center;
  justify-content: center;
  width:           100%;
  gap:             var(--space-6);          /* 24px */
}

.funnel-row__side {
  flex: 0 0 140px;
}

.funnel-row__side--left  { text-align: right; }
.funnel-row__side--right { text-align: left; }
```

---

## Regras Críticas de Fidelidade

1. ✅ **Larguras proporcionais são obrigatórias** — cada stage representa o volume real de leads daquela etapa
2. ✅ **Valor numérico centralizado**, label (mono uppercase) acima, delta abaixo
3. ✅ **Metric cards FORA do funil**, nas laterais com linhas conectoras `border-subtle`
4. ✅ **Connector vertical fino** entre cada stage — `border-default`, 1px
5. ✅ **Fundo** `var(--color-bg-base)` no container — nunca branco puro
6. ✅ **Soft UI Elevação 1** em todos os stages — `shadow-sm`
7. ✅ **Número de stages igual ao original do CRM** — nunca adicionar/remover
8. ✅ **Fonte dos KPIs**: `text-3xl` (30px), `font-extrabold` (800)

---

## Adaptação Mobile (< 768px)

- Métricas laterais se desacoplam do funil e migram para **abaixo** do stage correspondente
- Cada stage mantém a largura proporcional em mobile, respeitando um mínimo legível
- Larguras proporcionais ao volume são mantidas em tablet (`640px–1023px`)
- Linhas conectoras laterais desaparecem em mobile
