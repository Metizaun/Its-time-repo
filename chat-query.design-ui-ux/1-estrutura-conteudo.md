# Estrutura & Conteúdo (Information Architecture e Layout)

## 📌 Contexto
Este arquivo dita as regras para os *Agents* responsáveis pela fundação e arcabouço estrutural da aplicação em Dark Mode. Todas as interfaces devem priorizar hierarquia macro, o fluxo de leitura lógico e focar na escaneabilidade.

---

## 🏗️ Information Architecture Agent
**Missão**: Organizar o conteúdo de forma lógica e escaneável.
**Objetivo**: Definir ordem, agrupamento e fluxo de leitura.

### Diretrizes de Agrupamento
- **Foco Analítico:** Como demonstrado nas dashboards financeiras e de hábitos (imagens de referência), os dados devem ser segmentados em blocos temáticos lógicos (Ex: "Consolidado Geral", "Aquisição de Clientes", "Composição da Receita").
- **Títulos e Ícones:** Cada bloco / tabela analítica deve possuir um título claro e, de forma preferencial, ser acompanhado por um Emoji/Ícone discreto para facilitar a distinção rápida (Ex: 📊, 👥, 💰).
- **Hierarquia do Funil:** O elemento que puxar mais a atenção (como o Funil) deve estar centralizado horizontalmente no painel de sua seção, cercado pelas métricas que dependem das etapas (custos à esquerda, taxas à direita).

---

## 🔲 Layout Agent
**Missão**: Estruturar a página visualmente.
**Objetivo**: Definir grid, seções e hierarquia macro.

### Grid e Espacialidade Macroscópica
- **Dashboard Modular:** O design usa layouts de tabela e layouts de grid fluidos. Painéis grandes (como os de Gráficos de Área e Funil) devem tender a ocupar a largura de 100% da sua grid-column pai, dividindo espaço lateral apenas quando existirem gráficos menores.
- **Grids de Tabela:** O visual das tabelas de métricas financeiras se baseia num grid flex transparente. Não usar bordas duras delimitando `<table>`, mas usar `divs` alinhadas na horizontal (row) com forte espaçamento entre as colunas para separar "Métrica" / "Valor Total" / "Média Anual".
- **Limpeza Visual (Clean UI):** Evitar caixas desnecessárias. Use o fundo escuro absoluto ou contêineres levemente mais claros (ex: um level de elevação usando cor) no lugar de usar muitas divisórias (borders).
- **Divisores:** Use os "dividers" de maneira extremamente controlada, com `border-color` variando entre um branco com 5% a 10% de opacidade (`rgba(255, 255, 255, 0.05)`).
