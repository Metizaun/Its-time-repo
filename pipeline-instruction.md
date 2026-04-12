# Instruções de Refatoração: Backend para Pipeline Dinâmico (Supabase / PostgreSQL)

## Contexto e Objetivo

Precisamos migrar nosso modelo de funil estático (baseado em texto) para um
modelo dinâmico (baseado em UUIDs por empresa), mas mantendo uma **camada de
compatibilidade** para que as integrações atuais (n8n, IA) que injetam texto
continuem funcionando sem nenhuma alteração.

O pipeline é isolado por empresa (`aces_id`).

## Tarefa 1: Atualização da Estrutura de Tabelas (DDL)

A tabela `pipeline_stages` já existe e já possui a coluna `position` (para
ordenação) e `aces_id` (para isolamento por empresa). Precisamos aplicar as
seguintes modificações no banco de dados:

1. **Alterar a tabela `pipeline_stages`**:
   - Adicionar uma nova coluna obrigatória chamada `status` (tipo `VARCHAR` ou
     `ENUM`).
   - Os únicos valores permitidos para esta coluna são: `'Aberto'`, `'Ganho'` e
     `'Perdido'`.

2. **Alterar a tabela `leads`**:
   - Manter a coluna atual `status` (Texto) intacta. Ela continuará recebendo os
     inputs do n8n/IA.
   - Adicionar uma nova coluna chamada `stage_id` (tipo `UUID`).
   - Esta nova coluna deve ser uma chave estrangeira (Foreign Key) referenciando
     `pipeline_stages(id)`.
   - Permitir `NULL` temporariamente na criação para não quebrar registros
     antigos.

## Tarefa 2: Criação do Motor de Tradução Silenciosa (Database Trigger)

Precisamos criar uma Function e um Trigger no PostgreSQL na tabela `leads` que
atue como um tradutor automático do texto inserido pela IA para o UUID correto
daquela empresa.

**Regras de Negócio do Trigger (Executado em `BEFORE INSERT OR UPDATE OF status`
na tabela `leads`):**

1. Quando o campo `status` (texto) for alterado, o trigger deve capturar o
   `NEW.aces_id` do lead.
2. O trigger fará um `SELECT` na tabela `pipeline_stages` buscando o ID da etapa
   correta para aquela empresa (`aces_id`), seguindo a lógica condicional
   abaixo:

   - **Cenário A (Extremos do Funil):** Se o `NEW.status` em texto (ignorando
     case) for igual a `'ganho'`, `'fechado'`, `'sucesso'` (mapeie os termos que
     usamos hoje para ganho), o trigger deve ignorar o nome visual da etapa e
     buscar pelo `status` sistêmico. _Query lógica:_
     `SELECT id FROM pipeline_stages WHERE aces_id = NEW.aces_id AND status = 'Ganho' LIMIT 1;`
     _(Aplicar a mesma lógica de busca sistêmica se o texto for `'perdido'`,
     buscando `status = 'Perdido'`)._

   - **Cenário B (Meio do Funil):** Se o `NEW.status` for qualquer outro texto
     (ex: `'atendimento'`, `'orçamento'`), o trigger deve buscar a etapa pelo
     nome exato informado, mas garantindo que ela é uma etapa aberta. _Query
     lógica:_
     `SELECT id FROM pipeline_stages WHERE aces_id = NEW.aces_id AND status = 'Aberto' AND nome ILIKE NEW.status LIMIT 1;`

3. **Fallback (Plano de Segurança):** Se o trigger não encontrar nenhum registro
   correspondente no Cenário B (ex: n8n enviou um nome de coluna que o Admin
   deletou), ele deve preencher o `stage_id` com a etapa de `status = 'Aberto'`
   que tiver o menor valor na coluna `position` (a primeira coluna do funil)
   para aquele `aces_id`, evitando que o `stage_id` fique órfão.

4. Por fim, o trigger atribui o ID encontrado: `NEW.stage_id = id_encontrado;` e
   prossegue com a operação.

## Entregáveis Esperados do Codex:

1. Script SQL para o `ALTER TABLE` da tabela `pipeline_stages`.
2. Script SQL para o `ALTER TABLE` da tabela `leads`.
3. Script SQL completo contendo a criação da função
   (`CREATE OR REPLACE FUNCTION`) com a lógica de tradução.
4. Script SQL para atrelar a função ao Trigger (`CREATE TRIGGER`) na tabela
   `leads`.
