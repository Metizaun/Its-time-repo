# Governança e Consistência (Constraint & Consistency)

## 📌 Contexto
Para evitar o descarrilamento do projeto por diversos desenvolvedores simultâneos, este arquivo pontua os maiores tabus e as boas-vivências para com a base visual "Dark Premium". 

---

## 🚫 Constraint Agent
**Missão**: Impor regras e limites.
**Objetivo**: Evitar inconsistências e excesso de liberdade.

### O Que NÃO Fazer
- **Nunca use Brancos Puros para Backgrounds:** Como a base é primariamente uma interface Dark Mode projetada, o uso súbito de brancos não só foge do projeto inicial, mas gera forte choque para a vista de um usuário no escuro.
- **Evite Flat Design Descontextualizado:** A UI foi concebida com "Neumorfismo Invertido". Caixas chatas coladas ao fundo preto geram um ambiente duro e cru. Devemos construir "Glows", inner shadows simulando ileração de luz superior e drop shadows pesados em contêineres e cards flutuantes.
- **Limitar Paleta Multicor Pura no Background:** Cores fortes como `#e5393a` servem para dados pontuais muito específicos — traços nos gráficos, checagem em botões — não para colorir um bloco de UI ou header de tabela inteiro.

---

## ⚖️ Consistency Agent
**Missão**: Manter padrão global.
**Objetivo**: Garantir uniformidade entre telas alheias.

### Paradigmas Unificados
- **Semânticas Idênticas:** Todo botão com ação primária usa a cor Red. Se há botões que criam fluxos irreversíveis "Cancelar", eles devem utilizar contornos Outline, sem preenchimento na Main Accent para não confundir com Primary Success CTA (Apesar de o accent principal ser vermelho, cuidado com CTAs confusos).
- **Formatos de Casos Financeiros Positivos:** Se é Lucro Líquido, "Vendas", "Receita Recorrência", todos devem ser tabulados identicamente com o mesmo tipo de moeda / tracking padronizado para "R$ X.XXX,XX" no escuro para fácil varredura com os olhos nas verticais de `td` com flex.
