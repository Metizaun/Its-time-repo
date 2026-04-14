# Dados e Visualização (Visualization e Chart Design)

## 📌 Contexto
Este é o guia **principal e obrigatório** para o mapeamento visual do modelo Funil e dos gráficos das dashboards na UI Final. A renderização de infográficos deve ser minimalista e de imediata compreensão, sem molduras supérfluas.

---

## 📊 Visualization Agent
**Missão**: Escolher tipo de gráfico.
**Objetivo**: Representar dados corretamente, no escuro absoluto.

### Modelos de Exibição
- **Rosca de Categorias (Donut Charts):** Use buraco central generoso para exibir métricas se necessário. Três Cores primárias vibrantes na representação visual (Amarelo, Azul, e Verde) encorpadas para equilibrar fundo e linhas. O vermelho nunca deve ser usado na rosca se significar status mistos sem relação com destaque negativo.
- **Gráficos de Área Lineares:** Gráfico principal de "Progresso Geral de Hábitos", assemelha-se a montanhas. O fill gradient é estritamente Vermelho (`var(--color-accent)`) indo de 40% nas proximidades da linha para 0% no limite Y, afogando-o no fundo escuro.
- **Gráficos de Múltiplas Linhas:** Pontos explícitos (nós e bolinhas marcadas nas dobras dos dados). Não se usa preenchimento sólido total, apenas opacidades muito translúcidas para não misturar demais com a linha inferior. Linhas nas cores de apoio (Amarelo, Verde, Azul).

---

## 🧭 Chart Design Agent - O FUNIL 3D NEUMÓRFICO
**Missão**: Padronizar e reconstruir visual do Funil e dos gráficos.
**Objetivo**: Garantir consistência e implementar geometria com elevação/profundidade (Depth/Shadow).

### Estrutura Definitiva (Apenas para o Funil)

**A Forma (Geometria Neumórfica Invertida):**
1. O funil exibe trapézios ou blocos com fortes curvas chanfradas (`border-radius: var(--radius-lg)`).
2. As etapas **transmitem relevos**. Utiliza-se sombreamentos em cascata.
3. **Pneus de Tração Externa (Elevados):** Cada estágio é projetado na tela. A etapa do topo ilumina suavemente na borda superior por meio de um sub-pixel inner shadow ou fine div frame, e toda a base repousa sobre uma espessa drop-shadow escurecida para que as formas do Funil destaquem do `var(--color-bg-primary)`.

**Conteúdo de Cada Etapa:**
1. **Topo:** Nome leve (Ex: "Impressões") cinza.
2. **Meio:** Valor em gigantesco formato (Ex: "13.255") branco vívido sem tracking.
3. **Rodapé:** Taxa de crescimento na cor condicional (`var(--color-success)` para verde/alta e `var(--color-danger)` para vermelho/queda) acompanhado das percentagens.
4. Um bloco de funil liga ao outro através de um único pino vertical fino que é o connector `var(--color-border-medium)`.

**KPIs Axiais Laterais do Funil:**
Enquanto os volumes caem no meio da tela no container principal do funil, existirão blocos flutuantes independentes em duas colunas, pendurados nos lados:
- **Coluna Esquerda:** Métricas Financeiras associadas a etapas do funil (Ex C/Clique `R$ 0,80`). Estas se ligarão com as extremidades esquerdas do container do funil com retinhas bem subtis em tons acinzentados. Onde a linha reta do KPI faz quina na parede do Funil se deve aplicar uma "bolinha-ponto" cinza preenchida para marcar a junção no eixo.
- **Coluna Direita:** Idem à esquerda, porém com as Taxas Percentuais correspondentes e ligações puxadas nas bordas direitas da pirâmide invertida (Ex: Taxa Vendas `100%`).
