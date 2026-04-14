# Componentes e Estados (Component e State)

## 📌 Contexto
Estas guidelines são voltadas para a modularização do design system, garantindo que botões, blocos analíticos e principalmente controles como checkboxes não destoem do fundo Dark Premium da aplicação.

---

## 🧩 Component Agent
**Missão**: Criar componentes reutilizáveis.
**Objetivo**: Padronizar botões, inputs, cards e modais.

### Controles Diretos e Repetitivos
1. **Checkboxes (Grade de Hábitos):**
   - Não devem usar o visual padrão do navegador.
   - Componentes "quadrados arredondados" (squircle).
   - **Unchecked:** Margem com linha fina vermelha (`var(--color-accent)`) e background escuro profundo.
   - **Checked:** Background sólido na cor primária de destaque (Vermelho intenso `var(--color-accent)`), e um Ícone de "check" em branco puro ou cinza escuro.
2. **Progress Bars Lineares (Hábitos):**
   - Fundos (track): Linhas longas em cinza bem escuro (`var(--color-bg-elevated)`).
   - Progresso (fill): Linha na cor da paleta (Vermelho `var(--color-accent)`) finalizando em ponta arredondada e um counter "XY%" lateral.
3. **Buttons Primários:**
   - Background totalmente bloqueado com a "Accent Color" vermelha, sem bordas extrusivas.
4. **Divisores e Tabelas:**
   - Tabelas financeiras não possuem fileiras pintadas individualmente. Usa-se linhas finas (`dividers`, de 1px `solid rgba(255,255,255,0.05)`) apenas para separar blocos ou o cabeçalho.

---

## 🕹️ State Agent
**Missão**: Definir estados de UI.
**Objetivo**: Garantir feedback visual (hover, loading, disabled).

### Respostas Táteis no Dark Mode
- **Hover em Tabela ou Listas:** Uma transição sutil iluminando o relevo do fundo (elevação simulada de opacidade leve em vez de cor pura sólida).
- **Hover de Botões / Actionable:** Usar um sutil "Glow" em vermelho (`var(--color-accent)`) projetado para fora como uma leve sombra luminosa e aumento de brightness, demonstrando resposta tátil à Accent Color num cenário muito escuro.
- **Disabled:** Manter volume mas sem nenhum foco emissor de luz, baixando muito a sua saturação geral (`opacity: 0.3`).
