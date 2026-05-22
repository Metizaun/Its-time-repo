# 🏛️ Manifesto — CRM Its Time Design System v2
**White Minimalist SaaS — Soft UI Edition**
*Engenharia reversa das referências visuais KP & Kromap*

> "A ferramenta é a mesma. A direção muda tudo."

---

## Visão

O CRM Its Time é uma plataforma de gestão comercial para agências e equipes de vendas de alta performance. A interface deve comunicar **clareza analítica**, **sofisticação editorial** e **leveza funcional** — um painel de controle elegante que respeita o tempo do usuário e elimina ruído visual.

---

## Os Três Pilares Irredutíveis

### 1. Contraste Editorial
Títulos ultra-pesados (800–900) coexistem com whitespace generoso. A tensão entre peso tipográfico e espaço vazio **cria hierarquia sem decoração**. Nenhum elemento visual extra é necessário quando a tipografia já comunica.

### 2. Acento Cirúrgico
Uma cor quente (**laranja `#E8511A`**) e uma cor de tensão (**pink/magenta `#E83560`**) são os únicos cromáticos permitidos. Tudo o mais é neutro — escalas de cinza quente e fundo cream. Usar as duas cores ao mesmo tempo no mesmo componente é proibido (exceto gradiente controlado em ilustrações).

### 3. Profundidade Suave (Soft UI)
Sombras não demarcam fronteiras — elas **elevam**. O sistema usa sombras Soft UI bilaterais: uma escura (embaixo/direita) e uma clara (acima/esquerda), criando a ilusão de que os componentes emergem organicamente da superfície. Interfaces Soft UI **flutuam**, não dividem.

---

## Tradução para SaaS

> **Clean > Decorativo** — Remova tudo que não serve à informação.
> **Funcional > Expressivo** — Cada elemento existe por uma razão.
> **Sutil > Óbvio** — A beleza está no que não se nota imediatamente.

---

## Identidade Visual

| Atributo | Valor |
|---|---|
| **Fundo da aplicação** | Cream quente `#F7F6F4` — nunca branco puro |
| **Superfície de cards** | Branco `#FFFFFF` com Soft UI elevation |
| **Cor de ação (CTA)** | Laranja `#E8511A` — exclusividade total |
| **Cor de tensão** | Pink `#E83560` — uso restritíssimo |
| **Tipografia** | Inter (sans) + JetBrains Mono (labels técnicos) |
| **Hierarquia** | Peso tipográfico, não tamanho ou cor |
| **Sombras** | Bilaterais Soft UI — luz e sombra simultâneas |
| **Border radius** | Generoso — componentes "flutuam" |

---

## Stack Técnica

| Camada | Tecnologia |
|---|---|
| Tokens | CSS Custom Properties (`--var`) |
| Utilidades | Tailwind CSS 3.4 via `hsl(var(--xxx))` |
| Componentes | shadcn/ui (Radix UI) customizados |
| Gráficos | Recharts com tema Soft UI |
| Ícones | Lucide icons + micro-barras laranja como marcadores de seção |
| Tipografia | Inter 400/500/600/700/800 + JetBrains Mono 500 |
| Animações | CSS transitions com `ease-spring` nos modais |

---

## Gradiente Autorizado

```css
/* USO RESTRITO: apenas ilustrações, banners hero, empty states visuais */
background: linear-gradient(135deg, #E8511A 0%, #E83560 100%);
```

> ⛔ **Nunca** em botões, textos ou backgrounds de componentes funcionais.

---

## Estrutura desta Documentação

| Arquivo | Conteúdo |
|---|---|
| `00-manifesto.md` | Este documento — visão, pilares, filosofia |
| `01-tokens.md` | Cores, tipografia, espaçamento, sombras, transições |
| `02-componentes.md` | Inputs, botões, cards, nav, badges, modal, tabelas |
| `03-funil.md` | Funil de conversão — geometria e layout Soft UI |
| `04-graficos-dados.md` | Charts com paleta warm neutral |
| `05-layout-responsividade.md` | Grid 12-col, breakpoints, sidebar, content |
| `06-ux-animacoes.md` | Soft UI state machine, transições, micro-animações |
| `07-governanca.md` | Antipatterns, consistência, regras de contribuição |
| `08-auditoria.md` | Checklist pré-deploy |

---

## Regra de Ouro

> Todo agente ou desenvolvedor que modificar a interface do CRM Its Time **deve ler este manifesto e `01-tokens.md` antes de tocar qualquer arquivo `.tsx` ou `.css`**.
> Zero valores de cor, sombra ou espaçamento hardcoded fora do `index.css`.
> Zero exceções.
