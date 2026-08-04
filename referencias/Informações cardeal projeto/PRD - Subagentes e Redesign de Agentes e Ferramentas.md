# PRD — Subagentes completos e fluxo visual de agentes

## Objetivo

Permitir que um agente principal encaminhe uma conversa para agentes especializados internos. Cada subagente deve executar como um agente completo, com prompt, modelo, personalidade, estado e ferramentas próprios, mas responder pelo mesmo canal do agente principal.

Para a Cardeal, Silvana continua responsável pelo atendimento óptico. O Atendimento Clínico Cardeal assume consultas, profissionais, serviços, valores e disponibilidade, encaminhando ao atendimento humano qualquer intenção de agendamento.

## Princípios funcionais

- Um subagente é um agente real, não uma Tool convencional nem um prompt armazenado dentro do agente principal.
- O agente principal somente escolhe o especialista e transfere o turno.
- O subagente consulta as ferramentas vinculadas ao próprio identificador e responde diretamente ao cliente.
- O canal de saída, número e instância são sempre herdados do agente principal.
- O principal não reformula a resposta e não pode responder enquanto o subagente controla o turno.
- A chave de destino é fornecida pelo backend como enum e validada antes do handoff; IDs ou destinos inventados pelo modelo são rejeitados.
- Ao concluir uma conversa informativa, o subagente devolve o controle sem gerar uma mensagem adicional do principal.
- Em atendimento com dados ainda pendentes, o subagente preserva a sessão até concluir ou encaminhar.
- Falha de execução segue o fallback humano configurado.

## Modelo de produto

Agentes principais possuem instância própria. Subagentes possuem `parent_agent_id`, chave interna e instrução de roteamento, mas não possuem `instance_name`. Um principal pode possuir vários subagentes.

As ferramentas continuam vinculadas por agente. Assim, Agenda, Encaminhamento, Áudio, Receituário, Visagismo e outras capacidades podem ser configuradas independentemente no principal ou em qualquer subagente.

O runtime diferencia:

- agente atuante: prompt, modelo, personalidade, memória e ferramentas;
- agente de canal: instância WhatsApp usada para receber e enviar mensagens.

## Experiência de configuração

O cadastro e a edição de um subagente reutilizam o mesmo modal de um agente comum. Para subagentes, o seletor de instância é substituído pela indicação do agente principal e pelo campo “Quando encaminhar para este subagente”.

Com apenas um agente principal ativo, o vínculo é automático. Com mais de um, o usuário escolhe o principal durante a criação. O vínculo não é alterado durante a edição.

Nenhuma tela utiliza badges para explicar o tipo do agente.

## Página Agentes

A página apresenta uma grade compacta sobre fundo claro. Agentes principais ficam lado a lado em desktop. Dentro de cada card aparecem, em ordem:

1. agente principal;
2. ferramentas pertencentes ao principal;
3. subagentes internos;
4. ferramentas pertencentes a cada subagente.

Os cards principais usam superfície branca, sombra Soft UI e contorno editorial laranja, coral e rosa. Ferramentas e subagentes são elementos compactos dentro do principal, evitando um diagrama vertical longo. Os elementos flutuam de forma lenta e discreta, com pequenas variações entre nós. `prefers-reduced-motion` desativa todo movimento.

## Página Ferramentas

A rota `/ferramentas` apresenta as ferramentas do agente principal selecionado e os subagentes vinculados. Com apenas um principal, a escolha é automática. Cada ferramenta abre seu configurador existente; cada subagente abre o modal completo de agente.

O item Subagente é um recurso especial de criação e navegação, não um registro em `agents.tool_definitions`.

## Cardeal

### Agente principal

- Nome: Silvana - Óticas Cardeal.
- Canal: instância existente da Cardeal.
- Responsabilidades: lentes, armações, receitas, visagismo, catálogo, pedidos, financeiro e assuntos gerais.
- RAG desativado.

### Subagente clínico

- Chave: `cardeal_clinical_assistant`.
- Nome: Atendimento Clínico Cardeal.
- Modelo: `gemini-3.1-flash-lite`.
- Responsabilidades: empresas, clínicas, profissionais, serviços, valores e disponibilidade.
- Ferramenta própria: Agenda. O encaminhamento humano permanece uma capacidade operacional do backend configurada no próprio subagente.
- Agenda: consulta habilitada; criação, remarcação e cancelamento desabilitados.
- Intenção de realizar, remarcar ou cancelar consulta: encaminhamento ao Chat Manual.
- RAG desativado.

### Empresas

O manifesto cadastra idempotentemente as três empresas da Cardeal com CNPJ, razão social, endereço, cidade, estado, CEP e fuso horário. Dados de médicos e disponibilidade permanecem nas estruturas de Profissionais e Agenda.

## Critérios de aceite

- O subagente aparece na interface como agente configurável completo.
- O subagente possui e executa suas próprias ferramentas.
- Uma pergunta clínica é respondida pelo subagente no mesmo número do principal.
- A consulta de profissionais e disponibilidade não é feita pelo principal.
- Não há resposta duplicada nem reformulação pelo principal.
- Nenhum evento é criado, remarcado ou cancelado pela IA da Cardeal.
- Ao finalizar o atendimento humano, o principal volta a controlar novas mensagens.
- Execuções repetidas do manifesto não duplicam agentes, ferramentas, empresas ou sessões.
- A interface funciona sem rolagem horizontal em desktop, tablet e celular.
- A animação de flutuação é sutil e desaparece com redução de movimento.

## Limites

- Não criar segundo número ou segunda instância.
- Não criar RAG para a Cardeal.
- Não publicar em produção nesta etapa.
- Não alterar dados de outros clientes nem mudanças não relacionadas existentes no repositório.
