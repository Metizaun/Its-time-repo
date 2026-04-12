# UX e Interação (Interaction e UX Heuristics)

## 📌 Contexto
Esses agentes controlam a usabilidade da aplicação e como a navegação é percebida ao longo dos cliques e animações, mantendo a experiência intuitiva e profissional.

---

## ⚡ Interaction Agent
**Missão**: Controlar comportamento da interface.
**Objetivo**: Aplicar animações e feedback de ações.

### Movimento em Dashboards
- **Desenho Dinâmico:** Gráficos não devem ter exata renderização brusca (Zero State pop-in). Animações de entrada suaves em fade-in e scale, gráficos desenhando curvas (draw).
- **Efeito Progressivo de Preenchimento:** A área abaixo das "linhas" dos gráficos devem ter uma opacidade subindo gradualmente de transparente (fundo dark principal) para a cor mais densa (ao longo do eixo Y e da esquerda para a direita na exibição inicial).

---

## 🧠 UX Heuristics Agent
**Missão**: Validar usabilidade.
**Objetivo**: Garantir clareza, rapidez e experiência intuitiva.

### Redução de Carga Cognitiva no Escuro
- **Acessibilidade do Texto:** Num fundo total-preto/cinza-escuro, contrastes podem explodir demais (se o texto for excessivamente branco #FFF e grosso) e sangrar na retina. Para leituras demoradas contínuas (como tabelas e nomes longos), o cinza claro acalma os olhos. 
- **Ícones Reconhecíveis:** Continuar utilizando os emojis minimalistas nativos ou ícones predefinidos line-art no cabeçalho dos painéis `(Ex: 📊 Consolidado)`. Torna as seções varríveis sem a necessidade de o usuário precisar ler as palavras ativamente.
- **Posição Certa:** Centralize a área de maior informação (exposição progressiva do Funil de Conversões), com os desdobramentos de gastos ou conversão laterais ligando os olhos mecanicamente da margem ao centro.
