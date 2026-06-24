# Padrao de Design, UI e UX para Tools de Agentes

## 1. Objetivo

Este guia define como novas Tools devem aparecer e se comportar na area de Agentes.

Uma Tool representa uma capacidade conectada ao agente de atendimento. Ela pode executar um processo simples, como enviar um catalogo, ou coordenar workers especializados, como leitura de receituario e visagismo. A infraestrutura pode ser sofisticada; a experiencia de configuracao nao pode parecer tecnica.

Principio do produto:

> Sofisticacao da tecnologia significa transformar um processo complexo em uma escolha simples, segura e eficaz.

As Tools devem lembrar visualmente as conexoes do n8n: o agente ocupa o centro e suas capacidades aparecem conectadas a ele. Isso e uma metafora visual, nao um editor de automacao. O usuario nao deve montar nos, conexoes, JSON, webhooks ou pipelines.

Este guia complementa:

- `chat-query.design-ui-ux/00-manifesto.md`;
- `chat-query.design-ui-ux/01-tokens.md`;
- `chat-query.design-ui-ux/02-componentes.md`;
- `chat-query.design-ui-ux/05-layout-responsividade.md`;
- `chat-query.design-ui-ux/06-ux-animacoes.md`;
- `chat-query.design-ui-ux/07-governanca.md`;
- `chat-query.design-ui-ux/08-auditoria.md`.

## 2. Modelo mental apresentado ao usuario

O frontend deve apresentar apenas tres conceitos:

1. **Agente:** quem conversa com o lead e preserva personalidade, memoria e contexto.
2. **Tool:** uma capacidade que o agente pode utilizar.
3. **Template:** uma configuracao inicial de agente com Tools recomendadas para um nicho.

Workers, modelos internos, filas, retries, credenciais e providers permanecem ocultos. Eles seguem o padrao de separacao definido em `09-padrao-workers-agentes-modelos.md`.

## 3. Criacao de agente

Ao clicar em **Criar agente**, a primeira etapa deve apresentar duas abas:

- **Templates**;
- **Em branco**.

### 3.1 Templates

Cada template aparece como um card contendo:

- nome;
- descricao de uma linha;
- nicho ou objetivo;
- lista resumida das Tools incluidas;
- CTA `Usar template`.

Primeiro template:

**Consultor para Oticas**

> Atendimento comercial para oticas com audio humanizado, encaminhamento, envio de catalogos, analise de receituario e visagismo.

Tools instaladas:

- Audio IA;
- Encaminhamento;
- Enviar midia;
- Analista;
- Visagismo.

O template e copiado para um agente real. Depois da criacao, o cliente pode alterar nome, personalidade, prompt e configuracoes das Tools. Atualizacoes futuras do template nunca modificam silenciosamente agentes existentes.

### 3.2 Em branco

Cria um agente sem Tools opcionais. O usuario pode adiciona-las posteriormente pelo botao `+` da secao Ferramentas.

### 3.3 Ativacao progressiva

O agente pode funcionar mesmo que uma Tool ainda nao esteja pronta. Cada Tool possui sua propria prontidao:

- `Ativa`;
- `Precisa configurar`;
- `Desativada`;
- `Erro`.

Uma Tool que exige destinos, precos ou arquivos nao pode ser ativada antes de receber os dados minimos. O restante do agente nao deve ser bloqueado.

## 4. Representacao visual das Tools

### 4.1 Tool Rail

No Studio do agente, adicionar uma secao chamada **Ferramentas** abaixo ou ao lado da configuracao principal.

Em desktop:

- apresentar uma linha horizontal sutil;
- cada Tool aparece como um botao circular conectado a essa linha;
- o botao `+` aparece no inicio ou no fim da sequencia;
- o nome aparece em tooltip e no painel de detalhes;
- um indicador pequeno comunica o estado sem depender apenas de cor.

Em telas menores que 768px:

- substituir a linha por uma lista vertical de cards compactos;
- manter a mesma ordem e as mesmas acoes;
- nao exigir scroll horizontal para configurar.

A Tool Rail nao permite arrastar, criar arestas ou reordenar logica. A ordem e apenas visual.

### 4.2 Anatomia de uma Tool

Cada Tool possui:

- icone Lucide;
- nome amigavel;
- descricao curta;
- badge de estado;
- resumo da configuracao atual;
- acao `Configurar`;
- toggle de ativacao quando estiver pronta;
- acao secundaria `Testar`, quando aplicavel.

Icones iniciais:

| Tool | Icone sugerido |
|---|---|
| Audio IA | `Volume2` |
| Encaminhamento | `Forward` |
| Enviar midia | `Files` |
| Analista | `ScanLine` |
| Visagismo | `WandSparkles` |

### 4.3 Estados

| Estado | Comportamento |
|---|---|
| Ativa | Pode ser usada pelo agente. Exibir badge semantico de sucesso. |
| Precisa configurar | Toggle bloqueado e CTA `Concluir configuracao`. |
| Desativada | Configuracao preservada, mas a Tool nao pode ser acionada. |
| Erro | Exibir explicacao curta e acao de correcao ou novo teste. |
| Carregando | Skeleton ou spinner sem alterar o tamanho do componente. |

Nao usar verde, amarelo ou vermelho como decoracao. Cores semanticas comunicam exclusivamente estado.

## 5. Configuracao de cada Tool

### 5.1 Audio IA

Mostrar:

- toggle;
- seletor de voz;
- botao `Ouvir amostra`;
- texto `Aproximadamente 2 em cada 100 respostas serao enviadas por audio`;
- teste de envio.

Nao mostrar:

- API key da ElevenLabs;
- model ID;
- formato ou bitrate;
- porcentagem editavel;
- regra de hash.

### 5.2 Encaminhamento

Apresentar uma lista de destinos. Para adicionar um destino, solicitar:

- **Nome do local ou agente**;
- **Tipo:** WhatsApp ou Agente;
- **Quando encaminhar**;
- numero, quando o tipo for WhatsApp;
- agente de destino, quando o tipo for Agente.

Microcopy recomendada:

> Quando essa situacao acontecer, o agente enviara o contexto para este destino.

O teste deve deixar claro que e apenas uma mensagem de validacao e nao uma transferencia real.

### 5.3 Enviar midia

Apresentar uma biblioteca compacta de arquivos cadastrados. Na primeira implementacao, solicitar:

- nome do material;
- descricao;
- quando deve ser enviado;
- link do Google Drive ou URL HTTPS;
- legenda padrao opcional.

O sistema detecta tipo, tamanho e nome do arquivo. Nao solicitar MIME type, file ID ou bucket.

Mostrar preview para imagens e identificacao visual para PDF. Link inacessivel deixa o item com estado `Precisa corrigir`.

### 5.4 Analista

Apresentar apenas a configuracao comercial:

- categoria da lente;
- faixa de grau;
- limite de cilindro;
- faixa de adicao, quando multifocal;
- preco;
- prioridade.

Os dados extraidos dos receituarios nao aparecem no frontend nesta fase.

### 5.5 Visagismo

Mostrar:

- as duas perguntas de qualificacao;
- status do catalogo;
- quantidade de produtos disponiveis;
- origem atual `Google Drive`;
- teste controlado com uma imagem de homologacao.

Enquanto a Biblioteca do app nao existir, o cadastro dos produtos e descricoes continua manual.

## 6. Linguagem e microcopy

### 6.1 Termos permitidos

- Ferramenta;
- Configurar;
- Testar;
- Destino;
- Arquivo;
- Voz;
- Faixa de grau;
- Pronto para usar.

### 6.2 Termos proibidos na interface

- function call;
- worker;
- webhook;
- JSON;
- schema;
- MIME;
- provider;
- Redis;
- service role;
- prompt interno;
- model ID.

Mensagens de erro devem explicar a correcao:

- `Nao conseguimos acessar esse arquivo. Verifique se o link permite visualizacao.`
- `Adicione pelo menos um destino antes de ativar o encaminhamento.`
- `Cadastre uma faixa de preco para ativar o Analista.`

## 7. Regras visuais obrigatorias

- Fundo da pagina: `var(--color-bg-base)`.
- Cards e paineis: `var(--color-surface-1)` com `shadow-sm`.
- CTA principal: `var(--color-primary-500)`.
- Inputs: 40px, `radius-md`, `shadow-inset` e `shadow-focus`.
- Modal ou drawer: `radius-3xl` e `shadow-modal`.
- Tool interativa: `shadow-sm` no repouso, `shadow-md` e `translateY(-2px)` no hover, `shadow-inset` no active.
- Zero cores, sombras ou raios hardcoded fora dos tokens.
- Nao combinar laranja e pink no mesmo componente funcional.
- JetBrains Mono apenas em badges, metadados, IDs e labels de secao.
- Cancelar usa variante ghost; salvar usa o unico CTA solid.

## 8. Acessibilidade e responsividade

- Toda Tool deve ser acessivel por teclado.
- Icone sem texto visivel exige `aria-label` e tooltip.
- Estado nunca depende somente de cor.
- Focus visivel usa `shadow-focus`.
- Toggle bloqueado explica por que esta indisponivel.
- Modal prende foco e devolve foco ao elemento de origem.
- Respeitar `prefers-reduced-motion`.
- Validar em 1280px, 1024px, 768px e mobile.
- Em mobile, footer de salvar permanece acessivel sem cobrir campos.

## 9. Criterios de aceite

- O usuario consegue identificar quais capacidades o agente possui sem conhecer n8n.
- Um template pode ser escolhido antes da configuracao do agente.
- Tools incompletas nao bloqueiam o agente nem podem ser ativadas por engano.
- Nenhuma credencial ou detalhe de infraestrutura aparece no frontend.
- Toda configuracao possui estado vazio, carregando, erro, sucesso e desativado.
- A interface passa pela auditoria de `chat-query.design-ui-ux/08-auditoria.md`.

