# 🧪 08 — Auditoria e Validação Pré-Deploy
**White Minimalist SaaS — Soft UI Edition**

> Checklist obrigatório antes de qualquer code-merge ou deployment.
> Este agente não constrói — ele **inspeciona**.
> Nenhum arquivo é entregue sem passar por estas verificações.

---

## Checklist de Validação

### 🎨 Tokens (`01-tokens.md`)
- [ ] Zero ocorrências de cor hexadecimal hardcoded fora de `index.css`
- [ ] Todos os `border-radius` usam variáveis `--radius-*`
- [ ] Todos os espaçamentos usam variáveis `--space-*` ou classes Tailwind mapeadas
- [ ] Nenhuma cor não listada nos tokens foi introduzida
- [ ] Sombras usam exclusivamente os tokens `--shadow-*` definidos
- [ ] Novos tokens documentados em `01-tokens.md`

### ♿ Contraste WCAG AA
- [ ] `gray-900` (#111110) sobre `surface-1` (#FFFFFF): relação ≥ **4.5:1** ✅ (~21:1)
- [ ] `gray-700` sobre `bg-base` (#F7F6F4): relação ≥ **4.5:1**
- [ ] `gray-500` sobre `surface-1`: relação ≥ **3:1** (labels, headers)
- [ ] `primary-500` (#E8511A) sobre `surface-1`: relação ≥ **3:1**
- [ ] `success-600` (#16A34A) sobre fundo claro: relação ≥ **3:1**
- [ ] `error-600` (#DC2626) sobre fundo claro: relação ≥ **3:1**
- [ ] Texto branco sobre `primary-500` (botão solid): relação ≥ **3:1** ✅
- [ ] Nenhum texto "invisível" — cinzas devem diferenciar razoavelmente do fundo

### 🕶️ Soft UI — Elevação
- [ ] Todos os cards interativos possuem `shadow-sm` em estado default
- [ ] Hover de cards usa `shadow-md` + `translateY(-2px)` — sem mudança de cor de fundo
- [ ] Active/pressed de cards usa `shadow-inset` + `translateY(0)`
- [ ] Inputs usam `shadow-inset` em estado default
- [ ] Focus de inputs usa `shadow-focus` (ring laranja translúcido + shadow-sm)
- [ ] Botão solid usa `shadow-primary` em default, `shadow-primary-hover` em hover
- [ ] Modais usam `shadow-modal`
- [ ] Sidebar flutuante usa `shadow-lg`
- [ ] Badges e elementos planos **não** têm sombra (`none`)

### 🧩 Componentes (`02-componentes.md`)
- [ ] Inputs têm todos os estados: default, focus, error, disabled, sizes SM/LG
- [ ] Botões têm todos os estados: hover, active, focus-visible, disabled
- [ ] Focus visível via `shadow-focus` — nunca `outline: none` sem substituto
- [ ] Badges usam fundo tinto (cor-50) com texto escuro correspondente (cor-600/700)
- [ ] Modais têm backdrop com `blur(4px)`, animation com `ease-spring`
- [ ] Section labels sempre com `::before` barra laranja 20px × 2px + mono uppercase
- [ ] Skeletons usam `--color-bg-muted` (#E8E5DF) — warm, nunca cinza frio
- [ ] Nenhuma caixa explicativa repete controles autoexplicativos
- [ ] Apenas um editor principal está visível em cada superfície
- [ ] Modos mutuamente exclusivos substituem conteúdo por abas ou controle segmentado
- [ ] Nenhum formulário está envolvido por fundo laranja ou tint de acento
- [ ] Helpers são curtos, operacionais e diretamente ligados ao campo
- [ ] IDs técnicos não aparecem no fluxo operacional principal
- [ ] Timelines e modais de release não exibem badges decorativos de “Novidade”, “Melhoria”, “Correção” ou equivalentes
- [ ] Ícones editoriais usam 40px a 64px e degradês somente no suporte visual, sem texto sobreposto

### 🔻 Funil (`03-funil.md`) — Validação Crítica
- [ ] Número de stages **igual ao original** do CRM (não alterar)
- [ ] Larguras decrescentes presentes e mensuráveis (100% → 80% → 65% → 55% → 45%)
- [ ] Label em mono/xs/tracking-wider/uppercase, valor em text-3xl/800
- [ ] Metric cards posicionados **fora** dos stage blocks, nas laterais
- [ ] Connector vertical de 1px `border-default` entre cada stage
- [ ] Fundo do wrapper: `--color-bg-base` (#F7F6F4)
- [ ] Stages têm `shadow-sm` (Elevação 1 Soft UI)
- [ ] Padding suficiente para números de 4+ dígitos

### 📊 Gráficos (`04-graficos-dados.md`)
- [ ] Gráfico de área: gradient fill laranja (20% → 0% opacity)
- [ ] Gráficos multi-linha: NÃO usa secondary pink (`#E83560`)
- [ ] Donuts: máximo 4 segmentos, laranja apenas para destaque
- [ ] Pontos explícitos (dots) presentes nas dobras dos dados
- [ ] Tooltips usam `bg-inverse` dark (#1A1A18) — contraste editorial
- [ ] Container de gráfico usa `card-section` com `shadow-sm`
- [ ] Section labels precedem cada bloco de gráficos

### 📐 Layout (`05-layout-responsividade.md`)
- [ ] Topbar: 56px, `surface-1`, sticky com z-index 100
- [ ] Sidebar: 240px, `bg-subtle`, border-right
- [ ] Content area: `bg-base` (#F7F6F4), padding 32px
- [ ] Cards dentro do content: `surface-1` (#FFFFFF) + `shadow-sm`
- [ ] Grid de KPI: 4 colunas → 2 → 1 nos breakpoints corretos
- [ ] Funil mobile: stages 100% width abaixo de 768px
- [ ] Trackers horizontais: scroll oculto + coluna de nome sticky
- [ ] Tabelas mobile: converte em cards empilhados abaixo de 640px
- [ ] Sidebar mobile: overlay com lock de scroll
- [ ] Formulários são agrupados por tarefa, sem colunas vazias ou campos órfãos
- [ ] Controles compostos mantêm continuidade visual e empilham de forma previsível no mobile

### ⚡ Transições e Animações (`06-ux-animacoes.md`)
- [ ] Nenhum componente aparece com "pop-in" brusco
- [ ] Fade-in aplicado em cards e seções na primeira renderização
- [ ] Hover de cards responde em ≤ 200ms
- [ ] Modais usam `ease-spring` na entrada
- [ ] Gráficos têm animação de draw ou rise na entrada
- [ ] `prefers-reduced-motion` desativa todas as animações
- [ ] Drag placeholder usa borda dashed `primary-300` + `primary-50` bg

### 🎯 Identidade Visual
- [ ] Gradientes editoriais usam exclusivamente os quatro tokens documentados
- [ ] Gradientes **nunca** aparecem em botões, textos, campos, formulários, cards completos ou backgrounds funcionais
- [ ] Tipografia mono **apenas** em labels, badges, IDs, timestamps
- [ ] Nenhum card de hero/destaque sem barra accent de 3px no topo
- [ ] Section labels precedem cada bloco temático da dashboard
- [ ] Pixel grid texture (se usada em empty states): `opacity: 0.04`

### 🔁 Consistência Cross-Page
- [ ] Todas as tabelas: headers mono uppercase, hover bg-subtle, zero zebra pesada
- [ ] Todos os valores monetários: `R$ X.XXX,XX`, bold, gray-900, alinhado à direita
- [ ] Variações percentuais: `+/-X,X%`, semibold, success-600/error-600
- [ ] Tipografia escala consistente (extrabold 800 só em KPIs e H1)
- [ ] Espaçamentos todos múltiplos de 4px/8px

### ⚙️ Performance
- [ ] Animações usam `transform` e `opacity` (GPU-accelerated)
- [ ] `width`, `height`, `padding` não são animados diretamente
- [ ] Gráficos Recharts com `isAnimationActive` controlado para re-renders frequentes
- [ ] Nenhum layout shift (CLS) perceptível durante carregamento

---

## Output Esperado

Antes de qualquer entrega, gerar relatório:

```json
{
  "passed": true,
  "critical_issues": [],
  "warnings": [],
  "fidelity_score": 0.0
}
```

| Campo | Significado |
|---|---|
| `passed: false` | ❌ **Bloqueia entrega** — corrigir todos `critical_issues` primeiro |
| `critical_issues` | Violações de tokens, Soft UI, contraste, funil |
| `warnings` | Melhorias opcionais — documentar para tracking |
| `fidelity_score` | `0.0` a `1.0` — aderência às specs (`1.0` = 100%) |

---

## Frequência de Auditoria

| Momento | Obrigatoriedade |
|---|---|
| Antes de cada PR com mudanças visuais | ✅ Obrigatório |
| Antes de deploy para produção | ✅ Obrigatório |
| Após merge de branch de design | ✅ Obrigatório |
| Sprint review (revisão visual geral) | 📋 Recomendado |

---

## O Que Este Agente NÃO Faz
- ❌ Não altera lógica de negócio
- ❌ Não renomeia campos, rotas ou entidades do CRM
- ❌ Não sugere novas funcionalidades
- ❌ Não opina sobre UX ou fluxo — apenas design visual

---

*Fim do checklist. Versão 2.0 — White Minimalist SaaS / Soft UI Edition*
