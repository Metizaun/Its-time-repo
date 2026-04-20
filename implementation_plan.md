# Plano de Implementação: Refatoração White Mode

Baseado em auditoria real de todo o `src/`. O problema **não é só de tokens** — o código usa três categorias de valores hardcoded que quebram completamente o Light Mode.

---

## Diagnóstico: 3 Categorias de Problemas

### Categoria A — `text-white` / `text-white/**` hardcoded
Classes absolutas que ficam invisíveis sobre fundo claro. Não respondem a nenhum token de tema.

### Categoria B — `bg-white/N`, `border-white/N`, `hover:bg-white/N`
Transparências relativas ao branco. No dark mode funcionam como bordas e fundos sutis. No light mode ficam completamente invisíveis (branco sobre branco).

### Categoria C — Hex hardcoded dark (`#0d0d0d`, `#1A1A1A`, `#131313`, `#161616`, `#242424`)
Valores absolutos de cor escura colados diretamente nas classes. Não mudam com o tema.

---

## Fase 1 — Definir Novos Tokens no `index.css`

### [MODIFY] `src/index.css` — Bloco `:root` (Light Mode)

Adicionar os tokens semânticos Light equivalentes aos que existem no `.dark`:

```css
:root {
  /* Tokens Light Mode — espelho semântico do .dark */
  --color-bg-primary:      #F8FAFC;   /* slate-50 — fundo geral da página */
  --color-bg-surface:      #F1F5F9;   /* slate-100 — painéis e sidebars */
  --color-bg-elevated:     #FFFFFF;   /* branco — cards flutuantes */
  --color-bg-input:        #F1F5F9;   /* campos de input */

  --color-accent:          #e5393a;   /* vermelho — mantido idêntico */
  --color-accent-soft:     rgba(229, 57, 58, 0.10);

  --color-success:         #4caf82;
  --color-danger:          #e5393a;

  --color-text-primary:    #0f172a;   /* slate-900 */
  --color-text-secondary:  #64748b;   /* slate-500 */
  --color-text-muted:      #94a3b8;   /* slate-400 */

  --color-border-subtle:   rgba(0, 0, 0, 0.05);
  --color-border-medium:   rgba(0, 0, 0, 0.10);
}
```

> [!IMPORTANT]
> Os tokens `--color-bg-elevated`, `--color-text-primary` e `--color-text-secondary` precisam existir no `:root` **antes** de qualquer refatoração nos componentes, pois vários arquivos já os usam com `var()`.

---

## Fase 2 — Criar Utilitários Semânticos no `index.css`

Adicionar classes reutilizáveis que eliminam a necessidade de repetir lógica dark/light em cada componente:

```css
/* Ghost Card — padrão do sistema */
.ghost-card {
  background:    transparent;
  border:        1px solid var(--color-border-subtle);
  border-top:    2px solid var(--color-accent);
  box-shadow:    0 8px 32px rgba(229, 57, 58, 0.04);
}

/* Ghost Border — divisores e separadores */
.ghost-border-b { border-bottom: 1px solid var(--color-border-subtle); }
.ghost-border-t { border-top:    1px solid var(--color-border-subtle); }
.ghost-border-r { border-right:  1px solid var(--color-border-subtle); }

/* Ghost Surface — hover e elementos interativos secundários */
.ghost-surface        { background: var(--color-border-subtle); }
.ghost-surface:hover  { background: var(--color-border-medium); }
```

---

## Fase 3 — Refatoração por Arquivo

> [!WARNING]
> Cada substituição **deve usar a estratégia correta** para cada categoria. Não substitua `text-white` por `text-[var(--color-text-primary)]` onde o elemento está sobre fundo accent vermelho (botões) — nesses casos `text-white` é correto e deve permanecer.

---

### 🗂️ Páginas

#### [MODIFY] `src/pages/Agentes.tsx`
| Linha | Problema | Substituição |
|---|---|---|
| L41 | `text-white` (título) | `text-foreground` |
| L60 | `border-white/5` | `border-[var(--color-border-subtle)]` |
| L64 | `text-white` (empty state h2) | `text-foreground` |
| L86 | `border border-white/5` | `border-[var(--color-border-subtle)]` |
| L88 | `border-t-white/10` (inativo) | `border-t-[var(--color-border-medium)]` |
| L98 | `text-white` (agent name) | `text-foreground` |
| L100 | `bg-white/5 border-white/5` (model tag) | `bg-[var(--color-border-subtle)] border-[var(--color-border-subtle)]` |
| L111 | `bg-white/5 border-white/10` (status inativo) | `bg-[var(--color-border-subtle)] border-[var(--color-border-medium)]` |
| L123 | `border-t border-white/5` (footer) | `border-t border-[var(--color-border-subtle)]` |
| L136/142 | `hover:text-white hover:bg-white/5` | `hover:text-foreground hover:bg-[var(--color-border-subtle)]` |

#### [MODIFY] `src/pages/Automacao.tsx`
| Linha | Problema | Substituição |
|---|---|---|
| L100 | `text-white` (título) | `text-foreground` |
| L117 | `border-white/5` (card) | `border-[var(--color-border-subtle)]` |
| L120 | `border-white/10` (inline filter) | `border-[var(--color-border-medium)]` |
| L127 | `bg-[#0d0d0d] border-white/10 text-white` (Select) | `bg-[var(--color-bg-surface)] border-[var(--color-border-medium)] text-foreground` |
| L130 | `bg-[#0d0d0d] border-white/10` (SelectContent) | `bg-[var(--color-bg-elevated)] border-[var(--color-border-subtle)]` |
| L131/133 | `text-white focus:bg-white/5` | `text-foreground focus:bg-[var(--color-border-subtle)]` |
| L143-145 | `border-white/10 text-white bg-white/5` (badges) | `border-[var(--color-border-medium)] text-foreground bg-[var(--color-border-subtle)]` |
| L160 | `border-white/5` (empty card) | `border-[var(--color-border-subtle)]` |

#### [MODIFY] `src/pages/Dashboard.tsx`
| Linha | Problema | Substituição |
|---|---|---|
| L142 | `bg-[var(--color-bg-elevated)] shadow-[0_4px_12px_rgba(0,0,0,0.4)]` | Shadow precisa de variação light: `shadow-[0_4px_12px_rgba(0,0,0,0.08)]` via token |
| L143 | `text-white` (span inline) | `text-foreground` |

#### [MODIFY] `src/pages/Pipeline.tsx` (L38)
| Linha | Problema | Substituição |
|---|---|---|
| L38 | `text-white` (título) | `text-foreground` |

#### [MODIFY] `src/pages/Chat.tsx` (L89, L93)
| Linha | Problema | Substituição |
|---|---|---|
| L89 | `border-white/5` | `border-[var(--color-border-subtle)]` |
| L93 | `text-white` (h2 empty) | `text-foreground` |

---

### 🧩 Componentes

#### [MODIFY] `src/components/KPICard.tsx`
| Linha | Problema | Substituição |
|---|---|---|
| L60 | `border border-white/5` | `border-[var(--color-border-subtle)]` |
| L69 | `text-white` (valor KPI) | `text-foreground` |

> [!NOTE]
> O `border-t-2 border-t-[var(--color-accent)]` e o `shadow-[0_8px_32px_rgba(229,57,58,0.04)]` **devem ser mantidos** — são o Ghost Card accent que funciona em ambos os modos.

#### [MODIFY] `src/components/kanban/KanbanColumn.tsx`
| Linha | Problema | Substituição |
|---|---|---|
| L91 | `bg-[#161616] border-white/5` | `bg-[var(--color-bg-surface)] border-[var(--color-border-subtle)]` |
| L108 | `bg-white/5` (drag over) | `bg-[var(--color-border-subtle)]` |
| L139 | `bg-[#1A1A1A] border-none text-white` (dropdown) | `bg-[var(--color-bg-elevated)] border-[var(--color-border-subtle)] text-foreground` |
| L140 | `focus:bg-[#242424] focus:text-white` | `focus:bg-[var(--color-bg-surface)] focus:text-foreground` |

#### [MODIFY] `src/components/kanban/PipelineToolbar.tsx`
| Linha | Problema | Substituição |
|---|---|---|
| L28 | `bg-[#131313]` (toolbar) | `bg-[var(--color-bg-surface)]` |
| L38 | `bg-[#1A1A1A] text-white/90 hover:bg-[#242424]` | `bg-[var(--color-bg-surface)] text-foreground/70 hover:bg-[var(--color-bg-elevated)]` |
| L48 | `bg-[#1A1A1A] border-none text-white` (Select) | `bg-[var(--color-bg-surface)] border-[var(--color-border-subtle)] text-foreground` |
| L49 | `text-white/40` (ícone) | `text-[var(--color-text-secondary)]` |
| L52-55 | `bg-[#1A1A1A] border-white/5` / `focus:bg-[#242424] text-white` | tokens bg/border semânticos |
| L64 | `bg-[#1A1A1A] text-white/70 hover:bg-[#242424]` | tokens semânticos |
| L68 | `bg-[#131313] border-white/5 text-white shadow-[..._rgba(0,0,0,0.8)]` (Popover) | `bg-[var(--color-bg-elevated)] border-[var(--color-border-subtle)] text-foreground shadow-[0_8px_32px_rgba(0,0,0,0.12)]` |
| L72-75 | `bg-[#1A1A1A] text-white/70` (kbd) | `bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)]` |

#### [MODIFY] `src/components/kanban/LeadCard.tsx`
| Linha | Problema | Substituição |
|---|---|---|
| L59 | `text-white` (lead name) | `text-foreground` |
| L62 | `text-white/40` | `text-[var(--color-text-muted)]` |
| L78 | `bg-white/5 border-white/5` (source badge) | `bg-[var(--color-border-subtle)] border-[var(--color-border-subtle)]` |
| L83 | `border-t border-white/[0.03]` | `border-t border-[var(--color-border-subtle)]` |
| L85 | `text-white/80` | `text-[var(--color-text-primary)]` |
| L92 | `bg-white/5 border-white/10 text-white` (Badge) | `bg-[var(--color-border-subtle)] border-[var(--color-border-medium)] text-foreground` |

#### [MODIFY] `src/components/modals/AgentConfigModal.tsx`
| Linha | Problema | Substituição |
|---|---|---|
| L171 | `bg-[#0d0d0d] border-white/5` (modal) | `bg-[var(--color-bg-elevated)] border-[var(--color-border-subtle)]` |
| L180 | `border-b border-white/5` | `border-b border-[var(--color-border-subtle)]` |
| L182 | `text-white` (modal title) | `text-foreground` |
| L191 | `border-white/10 hover:bg-white/5` | `border-[var(--color-border-medium)] hover:bg-[var(--color-border-subtle)]` |
| L202 | `border-r border-white/5` | `border-r border-[var(--color-border-subtle)]` |
| L215/319 | `border-white/8 text-white placeholder-white/20` (inputs) | `border-[var(--color-border-medium)] text-foreground placeholder-[var(--color-text-muted)]` |
| L228 | `bg-[#0d0d0d] border-white/8 text-white` (select) | `bg-[var(--color-bg-surface)] border-[var(--color-border-medium)] text-foreground` |
| L261 | `text-white/20 hover:text-white/50` | `text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]` |
| L278 | `bg-white/10` (range input) | `bg-[var(--color-border-medium)]` |
| L284 | `text-white` | `text-foreground` |
| L286/334 | `text-white/20` | `text-[var(--color-text-muted)]` |
| L301/378 | `hover:text-white hover:bg-white/5` | `hover:text-foreground hover:bg-[var(--color-border-subtle)]` |
| L330/374 | `border-b/t border-white/5` | `border-b/t border-[var(--color-border-subtle)]` |
| L350 | `border-white/5` (card prompt) | `border-[var(--color-border-subtle)]` |
| L354 | `hover:bg-white/[0.02]` | `hover:bg-[var(--color-border-subtle)]` |
| L359 | `text-white/20` (grip) | `text-[var(--color-text-muted)]` |
| L360 | `text-white/70` | `text-[var(--color-text-secondary)]` |

#### [MODIFY] `src/components/leads/LeadSidebar.tsx`
| Linha | Problema | Substituição |
|---|---|---|
| L18/28/35 | `border-r border-white/5` | `border-r border-[var(--color-border-subtle)]` |
| L20 | `bg-white/5` (skeleton) | `bg-[var(--color-border-subtle)]` |
| L36 | `border-b border-white/5` | `border-b border-[var(--color-border-subtle)]` |
| L37 | `text-white` (título) | `text-foreground` |
| L63 | `bg-white/5 border-white/10` (selected) | `bg-[var(--color-border-subtle)] border-[var(--color-border-medium)]` |
| L64 | `hover:bg-white/5` | `hover:bg-[var(--color-border-subtle)]` |
| L72 | `bg-white/5 border-white/5` (status badge) | `bg-[var(--color-border-subtle)] border-[var(--color-border-subtle)]` |
| L82 | `text-white` (selected name) | `text-foreground` |

#### [MODIFY] `src/components/chat/ChatInput.tsx`
| Linha | Problema | Substituição |
|---|---|---|
| L49 | `border-white/5 bg-[var(--color-bg-primary)]` | `border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)]` ✓ (token já ok) |
| L50 | `bg-white/5 border-white/5 focus-within:border-white/10` | `bg-[var(--color-border-subtle)] border-[var(--color-border-subtle)] focus-within:border-[var(--color-border-medium)]` |
| L68 | `bg-white/5` (enviar inativo) | `bg-[var(--color-border-subtle)]` |

#### [MODIFY] `src/components/chat/MessageBubble.tsx` (L24)
| Linha | Problema | Substituição |
|---|---|---|
| L24 | `bg-white/5 border-white/5` | `bg-[var(--color-border-subtle)] border-[var(--color-border-subtle)]` |

#### [MODIFY] `src/components/chat/DateSeparator.tsx` (L8)
| Linha | Problema | Substituição |
|---|---|---|
| L8 | `bg-white/5 border-white/5` | `bg-[var(--color-border-subtle)] border-[var(--color-border-subtle)]` |

#### [MODIFY] `src/components/chat/ChatHeader.tsx` (L17, L36)
| Linha | Problema | Substituição |
|---|---|---|
| L17 | `border-white/5` | `border-[var(--color-border-subtle)]` |
| L36 | `hover:text-white hover:bg-white/5` | `hover:text-foreground hover:bg-[var(--color-border-subtle)]` |

#### [MODIFY] `src/components/chat/MessageList.tsx` (L32-35)
| Linha | Problema | Substituição |
|---|---|---|
| L32-35 | `bg-white/5` (skeletons) | `bg-[var(--color-border-subtle)]` |

#### [MODIFY] `src/components/charts/LineChart.tsx`, `BarChart.tsx`, `RevenueByVendorChart.tsx`
| Linha | Problema | Substituição |
|---|---|---|
| L21/38 | `border-white/5` (card) | `border-[var(--color-border-subtle)]` |

#### [MODIFY] `src/components/charts/FunnelChart.tsx` (L33, L76)
| Linha | Problema | Substituição |
|---|---|---|
| L33/76 | `bg-[var(--color-bg-primary)]` | ✓ Token correto — apenas precisa do valor definido no `:root` (Fase 1) |

---

## Fase 4 — Regras Intocáveis (Não Modificar)

> [!CAUTION]
> As seguintes classes devem ser **preservadas exatamente como estão** em qualquer modo, pois são elementos de identidade visual que funcionam sobre fundo accent ou são semanticamente corretos:
> - `bg-[var(--color-accent)] text-white` em **botões primários** — branco sobre vermelho é correto
> - `border-t-2 border-t-[var(--color-accent)]` — Ghost Card neon top bar
> - `shadow-[0_8px_32px_rgba(229,57,58,0.04)]` — glow sutil do accent
> - `text-[var(--color-accent)]` e `text-[var(--color-success)]` — cores semânticas
> - `animate-spin border-t-[var(--color-accent)]` — spinner de loading

---

## Fase 5 — Adicionar Token `--color-text-muted` ao `.dark`

O token `--color-text-muted` existe no design doc mas **falta no bloco `.dark` atual** do `index.css`:

```css
/* Adicionar dentro do bloco .dark */
--color-text-muted: #555555;
```

---

## Plano de Execução (Ordem)

```
1. index.css      → Adicionar tokens :root Light + .dark muted
2. KPICard.tsx    → Componente base, afeta todo o Dashboard
3. Agentes.tsx    → Página principal de referência Ghost Card
4. Dashboard.tsx  → Página de entrada
5. charts/        → LineChart, BarChart, RevenueByVendorChart, FunnelChart
6. kanban/        → KanbanColumn, PipelineToolbar, LeadCard
7. chat/          → ChatInput, ChatHeader, MessageBubble, DateSeparator, MessageList
8. leads/         → LeadSidebar
9. modals/        → AgentConfigModal (maior volume de mudanças)
10. pages/        → Automacao, Pipeline, Chat (restantes)
```

## Verificação Final

Após todas as substituições, rodar busca por regressões:
- `grep -r "text-white" src/` → Só deve restar em botões accent
- `grep -r "bg-white/" src/` → Deve retornar zero
- `grep -r "border-white/" src/` → Deve retornar zero
- `grep -r "#0d0d0d\|#1A1A1A\|#131313\|#161616\|#242424" src/` → Deve retornar zero
