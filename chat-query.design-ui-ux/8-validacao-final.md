# Validação Final (UI Validator)

## 📌 Contexto
Este agente não constrói, funciona num modo de inspeção puramente dedutivo durante os fins dos ciclos para assegurar as guidelines criadas nos passos 1 a 7 antes do Code-Merge / Deployment.

---

## 🧪 UI Validator Agent
**Missão**: Revisar a interface final comparada ao protótipo.
**Objetivo**: Validar alinhamento, contraste e espaçamento num checklist pré-implementação final.

### Checklist Prático 

1. **Testes de Contraste Luminoso e Opacidade:**
   - [ ] As fontes cinzas sob a luz ambiente e no brilho baixo da tela monitor do tester ainda diferem razoavelmente do fundo preexistente escuro (`#121212`)? (Sem texto "invisível").
   - [ ] As linhas finíssimas do Funil conectadas às caixas de KPI (Bordas divisórias `rgba` no limiar do `10%` ou borders pretas absolutas da box-shadow do inner gradient Neumórfico) estão sendo renderizadas na GPU / DOM ou foram ocultadas ou engolidas pelo preenchimento? 

2. **Verificações Geométricas - O Funil Funciona Correctly Ocularly?**
   - [ ] As bolinhas que acoplam a reta horizontal ligada à lateral das abas da pirâmide estão centralizadas verticalmente ao respectivo div central de estatística ou se deslocaram visualmente por margens erradas? 
   - [ ] O padding geral das abas e Trapézios garante que nenhum texto grande que extrapole 4 dígitos bata nas bordas laterais do soft-glow numérico no interior?

3. **Verificação de Performance dos Gráficos Customizados:**
   - [ ] Se implementadas SVG/Canvas as linhas azuis verdes e amarelas no Tracker Multilinear fluem ou geram gargalos numa variação de re-renders de dados muito fortes?
   - [ ] As progress bars (Grid de acompanhamento de rastreadores ao lado de hábitos vermelhos) sofrem vazamentos no overflow e empurram outros elementos flex pra colunas indesejadas em redimensionamento?

---
*Este é o último estágio de compliance para a padronização e perfeição de um projeto imersivo profissional para agências voltadas a design dark mode high-profile.*
