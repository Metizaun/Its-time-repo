# 03-funnel-agent — Funil de Conversão do CRM

## Papel
Instruir o redesign visual do funil de conversão do CRM.
Este agente instrui APENAS design. Nenhuma lógica de negócio é alterada.
A estrutura de dados e os nomes das etapas do funil devem ser mantidos
exatamente como estão no código original — apenas a aparência muda.

## Estrutura visual obrigatória

O funil é exibido verticalmente, com largura decrescente a cada etapa:

```
┌─────────────────────────────────┐   ← 100% de largura
│           Impressões            │
└─────────────────────────────────┘
          ┌───────────────────┐       ← 80%
          │      Cliques      │
          └───────────────────┘
              ┌────────────┐          ← 65%
              │   Leads    │
              └────────────┘
               ┌──────────┐           ← 55%
               │Agendaram │
               └──────────┘
                ┌────────┐            ← 45%
                │Vendidos│
                └────────┘
```

> Os rótulos acima são apenas referência de posição.
> Mantenha os nomes reais das etapas do seu CRM.

## Anatomia de cada stage block

```
[ label da etapa        ]   ← font-size-label, color-text-secondary
[ VALOR NUMÉRICO GRANDE ]   ← font-size-hero, bold, color-text-primary
[ +17,1% variação       ]   ← font-size-label, cor positiva ou negativa
```

```css
.funnel-stage {
  background:    var(--color-bg-elevated);
  border-radius: var(--radius-lg);
  margin:        0 auto;
  padding:       var(--spacing-md) var(--spacing-lg);
  text-align:    center;
  box-shadow:    0 10px 30px rgba(0, 0, 0, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.05); /* Neumorfismo Invertido */
}

/* Larguras decrescentes obrigatórias */
.funnel-stage:nth-child(1) { width: 100%; }
.funnel-stage:nth-child(2) { width: 80%;  }
.funnel-stage:nth-child(3) { width: 65%;  }
.funnel-stage:nth-child(4) { width: 55%;  }
.funnel-stage:nth-child(5) { width: 45%;  }

.funnel-stage__label {
  font-size: var(--font-size-label);
  color:     var(--color-text-secondary);
}
.funnel-stage__value {
  font-size:   var(--font-size-hero);
  font-weight: var(--font-weight-bold);
  color:       var(--color-text-primary);
  line-height: 1;
}
.funnel-stage__delta--positive { color: var(--color-success); font-size: var(--font-size-label); }
.funnel-stage__delta--negative { color: var(--color-danger);  font-size: var(--font-size-label); }
```

## Connector entre stages

```css
.funnel-connector {
  width:      1px;
  height:     var(--spacing-sm);
  background: var(--color-border-medium);
  margin:     0 auto;
}
```

## Metric cards laterais

- Ficam FORA dos stage blocks, nunca dentro
- Coluna esquerda: custo por etapa (ex: C/Clique, C/Lead)
- Coluna direita: taxa de conversão por etapa
- Alinhados verticalmente ao centro do seu respectivo stage
- Usar .metric-card de 02-component-agent.md

## Layout geral

```css
.funnel-wrapper {
  display:         flex;
  flex-direction:  column;
  align-items:     center;
  gap:             0;
  background:      var(--color-bg-primary);
  padding:         var(--spacing-xl);
}
.funnel-row {
  display:         flex;
  align-items:     center;
  justify-content: center;
  width:           100%;
  gap:             var(--spacing-lg);
}
.funnel-row__side {
  flex:            0 0 140px;
}
.funnel-row__side--left  { text-align: right; }
.funnel-row__side--right { text-align: left; }
```

## Regras críticas de fidelidade
1. Larguras decrescentes são INEGOCIÁVEIS — cada stage visivelmente menor
2. Valor numérico centralizado, label acima, delta abaixo
3. Metric cards fora do funil, nas laterais
4. Connector vertical fino entre cada stage — nunca ícone decorativo
5. Fundo geral var(--color-bg-primary), sem bordas externas no container
6. **Mandatório:** Executar o Soft Neumorphism Invertido, garantindo fortes Drop-shadows para afastar as caixas do fundo escuro e glow line interno nas quinas superiores. NUNCA adotar flat design aqui.
