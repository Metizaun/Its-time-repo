# Governança e Consistência (Constraint & Consistency)

## 📌 Contexto
Para evitar o descarrilamento do projeto por diversos desenvolvedores simultâneos, este arquivo pontua os maiores tabus e as boas-vivências para com a base visual "Dark Premium". 

---

## 🚫 Constraint Agent
**Missão**: Impor regras e limites.
**Objetivo**: Evitar inconsistências e excesso de liberdade.

### O Que NÃO Fazer
- **Nunca use Brancos Puros para Backgrounds:** Como a base é primariamente uma interface Dark Mode projetada, o uso súbito de brancos não só foge do projeto inicial, mas gera forte choque para a vista de um usuário no escuro.
- **Evitar Flat Design Descontextualizado:** A UI foi concebida com "Depth", camadas, glow interno nas superfícies frontais. Não empilhe cards retangulares retos sem shadows puramente vazios se o container principal (como o de um Funil num dashboard) utiliza um design volumétrico de Neumorfismo.
- **Limitar Paleta Multicor Pura no Background:** Cores fortes como `#ff3b3b` servem para dados pontuais muito específicos — traços nos gráficos, checagem em botões — não para colorir um bloco de UI ou header de tabela inteiro.

---

## ⚖️ Consistency Agent
**Missão**: Manter padrão global.
**Objetivo**: Garantir uniformidade entre telas alheias.

### Paradigmas Unificados
- **Semânticas Idênticas:** Todo botão com ação primária usa a cor Red. Se há botões que criam fluxos irreversíveis "Cancelar", eles devem utilizar contornos Outline, sem preenchimento na Main Accent para não confundir com Primary Success CTA (Apesar de o accent principal ser vermelho, cuidado com CTAs confusos).
- **Formatos de Casos Financeiros Positivos:** Se é Lucro Líquido, "Vendas", "Receita Recorrência", todos devem ser tabulados identicamente com o mesmo tipo de moeda / tracking padronizado para "R$ X.XXX,XX" no escuro para fácil varredura com os olhos nas verticais de `td` com flex.
