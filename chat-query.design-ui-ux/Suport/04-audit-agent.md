# 04-audit-agent — Validação Visual do Redesign

## Papel
Auditar o output dos agentes 01, 02 e 03 antes da entrega final.
Este agente instrui APENAS validação de design.
Nenhum arquivo é entregue sem passar por este checklist.

## Checklist de validação

### Tokens (01-token-agent.md)
- [ ] Zero ocorrências de cor hexadecimal hardcoded fora de 01-token-agent.md
- [ ] Todos os border-radius usam variáveis --radius-*
- [ ] Todos os espaçamentos usam variáveis --spacing-*
- [ ] Nenhum valor de cor clara (#fff, #f0f0f0 etc.) usado como fundo

### Contraste WCAG AA
- [ ] Texto primário sobre bg-primary:  relação ≥ 4.5:1
- [ ] Texto secundário sobre bg-surface: relação ≥ 3:1
- [ ] Accent red sobre bg-elevated:     relação ≥ 3:1
- [ ] Delta verde e vermelho sobre bg-elevated: ≥ 3:1

### Componentes (02-component-agent.md)
- [ ] Componentes flutuantes (como modals ou cards principais) possuem correta volumetria com drop-shadow escurecida para Neumorfismo Invertido
- [ ] Hover states reativos demonstram sutil iluminação/glow onde aplicável e clareamento limpo e restrito.
- [ ] Focus visível: outline 2px var(--color-accent)
- [ ] Badges usam fundo semi-transparente, nunca fundo sólido claro

### Funil (03-funnel-agent.md) — validação crítica
- [ ] Número de stages igual ao original do CRM (não alterar)
- [ ] Larguras decrescentes presentes e mensuráveis
- [ ] Valor numérico usa font-size-hero (2.5rem)
- [ ] Metric cards posicionados fora dos stage blocks
- [ ] Connector vertical presente entre cada stage
- [ ] Efeito *Soft Neumorphism Invertido* está implementado e claro através da sombra escura (drop) com luz linear (inset shadow).

### Dark mode geral
- [ ] Nenhuma superfície usa fundo branco ou cinza claro
- [ ] Todos os ícones visíveis sobre fundo escuro
- [ ] Estados de loading/empty state seguem a mesma paleta

## Output esperado

Retornar relatório antes de qualquer entrega:

```json
{
  "passed": true,
  "critical_issues": [],
  "warnings": [],
  "fidelity_score": 0.0
}
```

- `passed: false` bloqueia entrega — corrigir todos os `critical_issues` primeiro
- `warnings` são opcionais mas devem ser documentados
- `fidelity_score` de 0 a 1, sendo 1 = 100% aderente às imagens de referência

## O que este agente NÃO faz
- Não altera lógica de negócio
- Não renomeia campos, rotas ou entidades do CRM
- Não sugere novas funcionalidades
- Não opina sobre UX ou fluxo — apenas design visual
