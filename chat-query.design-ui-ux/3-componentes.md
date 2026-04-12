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
   - **Unchecked:** Margem com linha fina vermelha (border rgba vermelha) e background escuro profundo.
   - **Checked:** Background sólido na cor primária de destaque (Vermelho sangue, ex: `#ff3b3b`), e um Ícone de "check" em branco denso ou cinza escuro.
2. **Progress Bars Lineares (Hábitos):**
   - Fundos (track): Linhas longas em cinza bem escuro (ex: `#2a2a2a`).
   - Progresso (fill): Linha na cor da paleta (Laranja-vermelho) finalizando em ponta arredondada e um counter "XY%" lateral.
3. **Buttons Primários:**
   - Background totalmente bloqueado com a "Accent Color" com borda suave, acompanhado de ícones minimalistas de add (`+`).
4. **Divisores e Tabelas:**
   - Tabelas financeiras não possuem fileiras pintadas individualmente. Usa-se linhas finas (`dividers`, de 1px `solid rgba(255,255,255,0.05)`) apenas para separar blocos ou o cabeçalho.

---

## 🕹️ State Agent
**Missão**: Definir estados de UI.
**Objetivo**: Garantir feedback visual (hover, loading, disabled).

### Respostas Táteis no Dark Mode
- **Hover em Tabela ou Listas:** Uma transição muito sutil na mudança da cor de fundo (de `#121212` para `#181818` rgba(255,255,255,0.02)). Não utilize tons puros claros para evitar fashbang na retina.
- **Hover de Botões / Actionable:** Devemos iluminar levemente elementos de ação (brightness e glow sutil de fora para espalhar a luz primária).
- **Disabled:** Manter a estrutura visível mas diminuir consideravelmente a opacidade e desaturar a paleta (ex: transformar botões de CTA ativos opacos em formas com `opacity: 30%` sem cor de acento).
