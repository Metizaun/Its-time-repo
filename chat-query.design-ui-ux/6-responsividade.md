# Responsividade (Responsive Agent)

## 📌 Contexto
Este documento descreve como a complexa hierarquia que estabelecemos será espremida de forma harmoniosa nas diversas instâncias do view-port do DOM sem quebrar o layout Neo-Mórfico e o Funil.

---

## 📱 Responsive Agent
**Missão**: Adaptar layout para diferentes telas.
**Objetivo**: Garantir usabilidade em mobile, tablet e desktop.

### Diretrizes de Comportamento Dinâmico
- **O Funil (Dispositivos Móveis):** Em larguras muito estreitas (`< 768px`), as métricas de Custo e de Taxa (Esquerda e Direita) se soltarão da parede do funil. O card da respectiva parte do Funil se transferirá para um bloco saltado central único e volumoso, com as ramificações de custos unidas internamente com divisões por sulcos (inner shadows).
- **Trackers Longos (Hábitos):** Se o calendário for infinito horiontalmente, ocultar a listagem por fora do view-port usando `overflow-x: auto (scroll ocultado das scroolbars nativas visualmente no Mac/Windows)`. Permita um arrasto ("drag" ou swiping touch). Fixe apenas a primeira coluna (com os nomes dos Hábitos na Esquerda) em absoluto usando `position: sticky; left: 0` para reter sentido num tracking amplo.
- **Tabelas Financeiras (Responsive Mobile):** Assim como os gráficos gigantes diminuirão radicalmente o aspecto (Scale font/size elements proportionately down before breaking text format), tabelas puras perdem `gap-4` para `gap-1`, e caso as colunas batam na borda com valores extensos, a row será encolhida flex e as quebras serão para colunas (em `flex-col`) com label e valor como pares "Top & Bottom".
