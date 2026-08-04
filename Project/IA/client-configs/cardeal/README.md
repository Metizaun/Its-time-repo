# Cardeal

Configuracao exclusiva da Cardeal:

- agente principal de otica vinculado a uma instancia existente e ao template `optics-consultant`;
- subagente completo `cardeal_clinical_assistant`, vinculado ao agente principal;
- prompt, modelo, personalidade e ferramentas clinicas proprias;
- sem numero ou instancia proprios; responde diretamente pelo canal herdado do agente principal;
- RAG desativado;
- empresas de Santa Cruz, Jatauba e Sume cadastradas idempotentemente com CNPJ, razao social e endereco;
- consulta de profissionais, servicos, valores, locais e disponibilidade habilitada;
- criacao, remarcacao e cancelamento pela IA desativados;
- encaminhamento humano obrigatorio para qualquer intencao de agendamento.

Os profissionais e dados das clinicas nao sao duplicados nos prompts. Eles devem estar atualizados nas estruturas existentes de Profissionais/Agenda. Campanhas vencidas e os dados clinicos conflitantes de Sume nao fazem parte deste manifesto.
