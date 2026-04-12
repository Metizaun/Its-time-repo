# Dados e Visualização (Visualization e Chart Design)

## 📌 Contexto
Este é o guia **principal e obrigatório** para o mapeamento visual do modelo Funil e dos gráficos das dashboards na UI Final. A renderização de infográficos deve ser minimalista e de imediata compreensão, sem molduras supérfluas.

---

## 📊 Visualization Agent
**Missão**: Escolher tipo de gráfico.
**Objetivo**: Representar dados corretamente, no escuro absoluto.

### Modelos de Exibição
- **Rosca de Categorias (Donut Charts):** Use buraco central generoso para exibir métricas se necessário. Três Cores primárias vibrantes na representação visual (Verde, Azul, Amarelo Cítrico) encorpadas para equilibrar fundo e linhas.
- **Gráficos de Área Lineares:** Gráfico principal de "Progresso Geral de Hábitos", assemelha-se a montanhas com topo de linha e declive contínuo para o chão em *gradient*. O fill alpha gradient deve ir de 40% nas proximidades da linha para 0% no limite Y, afogando-o no fundo escuro.
- **Gráficos de Múltiplas Linhas:** Pontos explícitos (nós e bolinhas marcadas nas dobras dos dados). Não se usa preenchimento sólido total, apenas opacidades muito translúcidas para não misturar demais com a linha inferior. Linhas finas, mas brilhantes em relação ao Background.

---

## 🧭 Chart Design Agent - O FUNIL 3D NEUMÓRFICO
**Missão**: Padronizar e reconstruir visual do Funil e dos gráficos.
**Objetivo**: Garantir consistência e implementar geometria em profundidade.

### Estrutura Definitiva (Apenas para o Funil)

**A Forma (Geometria CSS ou SVG):**
1. O funil exibe Trapézios (ou Divs retangulares escaladas/chanfradas usando path-clip polygon ou transform: perspective + rotateX + escala decrescente entre as etapas de cima para baixo).
2. As etapas não são planas (Flat Design).
3. **Pneus de Tração Externa (Bordas e Relevo):** Cada estágio é um bloco largo e horizontal. A etapa do topo é muito mais larga que a da base, num stack vertical com forte sombreamento tipo Neo-morfismo. Fundo das formas do Funil: `#1a1a1a` a `#222`, não pode ser negro absoluto para poder contrastar as sombras da profundidade. Usar propriedades complexas de box-shadow incrustadas (Inner Shadow) ao topo do card e drop-shadow forte de contorno preto profundo em baixo e nos lados.

**Conteúdo de Cada Etapa:**
1. **Topo:** Nome leve (Ex: "Impressões") cinza.
2. **Meio:** Valor em gigantesco formato (Ex: "13.255") branco vívido sem tracking.
3. **Rodapé:** Taxa de crescimento verde/vermelha com seta direcional fina e pequena subida ou queda +%. ( Ex: `↓ -15.4%`).
4. Um bloco de funil liga ao outro através de um único pino vertical, uma mini reta fina com seta que direciona o stage seguinte.

**KPIs Axiais Laterais do Funil:**
Enquanto os volumes caem no meio da tela no container principal do funil, existirão blocos flutuantes independentes em duas colunas, pendurados nos lados:
- **Coluna Esquerda:** Métricas Financeiras associadas a etapas do funil (Ex C/Clique `R$ 0,80`). Estas se ligarão com as extremidades esquerdas do container do funil com retinhas bem subtis em tons acinzentados. Onde a linha reta do KPI faz quina na parede do Funil se deve aplicar uma "bolinha-ponto" cinza preenchida para marcar a junção no eixo.
- **Coluna Direita:** Idem à esquerda, porém com as Taxas Percentuais correspondentes e ligações puxadas nas bordas direitas da pirâmide invertida (Ex: Taxa Vendas `100%`).
