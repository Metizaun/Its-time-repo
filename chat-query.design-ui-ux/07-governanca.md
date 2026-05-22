# 🚫 07 — Governança e Consistência
**White Minimalist SaaS — Soft UI Edition**

> O que NÃO fazer, antipatterns proibidos, e paradigmas de consistência global.
> Evita o descarrilamento visual por múltiplos desenvolvedores ou agentes IA simultâneos.

---

## ❌ PROIBIDO — Antipatterns

### 1. Branco Puro como Fundo de Página
```
❌ background: #ffffff;  (na tela principal)
❌ background: white;
❌ bg-white (no app shell)
```
O fundo da aplicação é **cream quente `#F7F6F4`**. Branco puro causa fadiga visual em sessões longas de SaaS. `#FFFFFF` é permitido apenas em superfícies de cards (`--color-surface-1`).

### 2. Cor Primária e Secundária Juntas no Mesmo Componente
```
❌ border: 2px solid var(--color-primary-500);
   background: var(--color-secondary-500);  /* nunca juntos */

❌ btn com gradient laranja→pink no texto principal
❌ badge primary + ícone em secondary no mesmo elemento
```
A única exceção autorizada é o **gradiente em ilustrações e empty states**: `linear-gradient(135deg, #E8511A 0%, #E83560 100%)`.

### 3. Gradiente Decorativo em Componentes Funcionais
```
❌ background: linear-gradient(135deg, #E8511A, #E83560);  /* em botões */
❌ color: linear-gradient(...);  /* em texto */
❌ border-image: linear-gradient(...);  /* em containers de UI */
```
O gradiente laranja→pink existe **apenas** em: ilustrações, banners de hero, empty states visuais, e a barra de 3px do `card-accent`.

### 4. Valores Hardcoded Fora do `index.css`
```
❌ color: #E8511A;          → use var(--color-primary-500)
❌ background: #F7F6F4;     → use var(--color-bg-base)
❌ border-radius: 16px;     → use var(--radius-xl)
❌ box-shadow: 4px 4px ...  → use var(--shadow-sm)
```
Zero ocorrências de cor hexadecimal, shadow value ou border-radius hardcoded fora do arquivo de tokens.

### 5. Sombras Pesadas / Dark Mode Shadows em Interface Light
```
❌ box-shadow: 0 8px 32px rgba(0,0,0,0.5);   /* muito densa para Soft UI */
❌ box-shadow: 0 0 20px rgba(229,57,58,0.4); /* neon accent — não existe aqui */
❌ drop-shadow pesada unilateral sem reflexo claro
```
Toda sombra Soft UI é **bilateral**: uma sombra escura + um reflexo claro. Veja `01-tokens.md` seção 11.

### 6. Flat Design Puro sem Elevação
```
❌ Cards sem nenhuma sombra colados ao fundo
❌ Botões sem shadow-primary (apenas mudança de cor)
❌ Inputs sem shadow-inset
```
Soft UI requer o par sombra/luz em todos os elementos interativos. Elementos completamente planos "desaparecem" no fundo cream.

### 7. Cores Semânticas como Decoração
```
❌ Verde para destacar features ou novidades
❌ Vermelho para simples rótulos de "Deletar" sem confirmação modal
❌ Amarelo como cor de acento de seção
```
Verde = bem-sucedido. Vermelho (`--color-error`) = erro. Amarelo = aviso. Nunca decoração.

### 8. Tipografia Mono em Texto Corrido
```
❌ Parágrafos em JetBrains Mono
❌ Títulos de seção em fonte mono
❌ Descrições de card em mono
```
`font-family-mono` é exclusivo para: labels de seção (section-label), headers de tabela, badges, IDs técnicos, timestamps, placeholders de versão.

---

## ✅ OBRIGATÓRIO — Paradigmas de Consistência

### Semântica de CTAs
| Ação | Variante | Estilo |
|---|---|---|
| Ação principal (salvar, criar, enviar) | `btn-solid` | Bg laranja sólido + shadow-primary |
| Ação alternativa (editar, exportar) | `btn-outline` | Borda laranja, bg transparente |
| Ação de baixo peso (cancelar, fechar) | `btn-ghost` | Sem borda, bg transparente |
| Ação perigosa (excluir permanentemente) | `btn-solid` vermelho com modal de confirmação | `--color-error-500` bg |

> Cancelar **nunca** usa `btn-solid` com cor primária — isso cria confusão com o CTA principal.

### Section Labels Obrigatórios
Todo bloco temático da dashboard **deve** começar com um `section-label` (barra laranja + texto mono uppercase). Exemplos:
- `CONSOLIDADO GERAL`
- `AQUISIÇÃO DE CLIENTES`
- `COMPOSIÇÃO DA RECEITA`
- `FUNIL DE CONVERSÃO`

### Formato Financeiro Padronizado
Todos os valores monetários seguem o mesmo padrão:
```
R$ X.XXX,XX
```
- Fonte: `--font-weight-bold` (700), cor `--color-gray-900`
- Alinhamento: **direita** para facilitar varredura vertical
- Delta positivo: `+R$ X,XX` em `--color-success-600`
- Delta negativo: `-R$ X,XX` em `--color-error-600`

### Formato de Variação Percentual
```
+12,5% ↑   → cor: var(--color-success-600), font-semibold
-8,3% ↓    → cor: var(--color-error-600), font-semibold
```

### Consistência de Tabelas
Todas as tabelas do CRM devem:
1. **Cabeçalho** mono, 12px, semibold, tracking-wide, uppercase, gray-500, `bg-subtle`
2. **Linhas** 16px padding, gray-700, border-bottom subtle
3. **Hover** `bg-subtle` (nunca sólido colorido)
4. **Formatação numérica** `R$ X.XXX,XX` alinhada à direita
5. **Zero fileiras pintadas** (sem zebra striping pesado)

### Consistência de Cards KPI
Todos os KPI cards devem:
1. `border-radius: var(--radius-2xl)` (20px)
2. Label em `font-family-mono`, uppercase, gray-500
3. Valor em `text-3xl` (30px), `font-extrabold` (800), gray-900
4. Delta em `text-sm`, semibold, success-600 ou error-600
5. `shadow-sm` em repouso

### Badges — Regra de Fundo
Todos os badges usam **fundo tinto** (versão 50 da cor) com texto **escuro correspondente** (versão 600/700). Nunca:
- Fundo sólido opaco
- Texto branco sobre fundo colorido (exceto em `bg-inverse` dark)
- Borda sem preenchimento (exceto status outline especial)

---

## 🔒 Regras de Contribuição

### Para Desenvolvedores Humanos
1. Leia `00-manifesto.md` e `01-tokens.md` antes de qualquer mudança visual
2. Nunca adicione cor nova sem registrá-la em `01-tokens.md`
3. Teste em 1280px, 1024px e 768px de viewport
4. Verifique contraste WCAG AA (ver `08-auditoria.md`)
5. Run `prefers-reduced-motion` check antes de submeter

### Para Agentes IA
1. Consumir **apenas** tokens de `01-tokens.md`
2. Seguir patterns de componentes de `02-componentes.md` com CSS copiar-colar
3. Executar checklist de `08-auditoria.md` antes de qualquer entrega
4. **Nunca** alterar lógica de negócio — apenas aparência visual
5. **Nunca** renomear campos, rotas ou entidades do CRM
6. **Nunca** adicionar dark mode sem instrução explícita do usuário
