# Tarefas de Desenvolvimento — IA Cardial

## 1. Configurar a IA comercial para todas as unidades Cardial

* Vincular todas as lojas à mesma IA comercial.
* Manter a unidade **Polo** fora desse fluxo até uma nova definição.

---

## 2. Implementar consulta de médicos e clínicas

A IA deverá consultar uma base contendo:

* Unidade e endereço;
* Médico disponível;
* Valor da consulta.

Quando o cliente perguntar sobre consultas, médicos ou valores, a IA deverá apresentar essas informações de forma objetiva.

> **Dependência:** recebimento da listagem de endereços, médicos e valores fornecida pela Cardial.

---

## 3. Transferir clientes interessados para atendimento humano

Após apresentar médicos, endereços e valores, a IA deverá:

* Identificar quando o cliente demonstrar interesse em realizar a consulta;
* Transferir imediatamente a conversa para um vendedor;
* Não tentar concluir o agendamento automaticamente.

---

## 4. Bloquear qualquer agendamento automático

A IA comercial **não poderá**:

* Marcar consultas;
* Confirmar horários;
* Realizar agendamentos via API;
* Informar que o agendamento foi concluído.

Todo pedido de agendamento deverá terminar com a transferência da conversa para o atendimento humano.

---

## 5. Criar roteamento específico para Sumé e Jataúba

Quando o cliente informar que é de **Sumé** ou **Jataúba** e demonstrar interesse em uma consulta, a IA deverá:

1. Apresentar a clínica disponível na região;
2. Informar o respectivo endereço;
3. Perguntar se o cliente deseja realizar a consulta;
4. Caso a resposta seja positiva, transferir a conversa para um vendedor.

---

## 6. Corrigir o fluxo de envio do catálogo

Atualmente, o catálogo está sendo enviado por outro número. O fluxo deverá ser corrigido para:

* Utilizar o visagismo do próprio sistema;
* Manter a interação no mesmo número em que a conversa foi iniciada;
* Buscar o catálogo cadastrado na tela de visagismo criada pelo Cassiano;
* Não utilizar o estoque do RB como fonte do catálogo.

---

## 7. Configurar as regras de apresentação de preços

A IA não poderá fornecer orçamentos completos ou preços específicos dos produtos.

Serão permitidas apenas comunicações como:

* “Temos lentes a partir de R$ X.”
* “Temos armações a partir de R$ X.”

Solicitações de orçamento detalhado deverão ser transferidas para um vendedor.

---

## 8. Manter a IA da Polo sem implementação

A configuração da IA da unidade **Polo** ainda está em discussão.

Nenhum fluxo específico deverá ser desenvolvido até que seu objetivo e funcionamento sejam formalmente definidos.
