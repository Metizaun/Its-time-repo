# Instruções de Refatoração: Frontend para Pipeline Dinâmico (React)

## Contexto e Objetivo

O objetivo é refatorar o Kanban atual, que consome um array estático
(`DEFAULT_COLUMNS`), para um modelo totalmente dinâmico alimentado pelo banco de
dados (`pipeline_stages`). O sistema deve ter visões e permissões diferentes
baseadas no perfil do usuário (Vendedor vs. Admin).

---

## 1. Gestão de Estado e Dados (Hooks)

Precisamos transformar o funil estático em um fluxo de dados assíncrono.

- **Novo Hook (`usePipelineStages`)**:
  - Criar um hook dedicado para buscar as colunas da empresa (`aces_id`) na
    tabela `pipeline_stages`.
  - **Obrigatório**: Implementar escuta em tempo real (Supabase Realtime) para
    esta tabela. Se um Admin alterar a cor ou o nome de uma coluna, a mudança
    deve refletir instantaneamente para todos os usuários daquela empresa.
- **Adaptação do `useLeads`**:
  - Atualizar o hook atual de leads para garantir que ele retorne a nova coluna
    `stage_id`.
- **O "Merge" Visual (`KanbanBoard`)**:
  - O componente `KanbanBoard` deve cruzar as informações: mapear o array de
    _Stages_ (colunas) retornado do banco e renderizar os _Leads_ dentro da
    coluna correspondente onde `lead.stage_id === stage.id`.

---

## 2. A Experiência do Vendedor (Usuário Comum)

Para o vendedor da ótica, a interface deve ser limpa, focada apenas na operação.

- **Leitura Dinâmica**: O quadro renderiza as colunas vindas do banco de dados,
  sempre ordenadas pelo campo `position`.
- **Drag & Drop de Leads**: Ao arrastar um card da coluna A para a coluna B, a
  função `handleDrop` deve parar de enviar uma string (ex: "fechado") e passar a
  enviar o `stage_id` (UUID) da nova coluna de destino.
- **Bloqueio de UI (Read-only para estrutura)**: O vendedor **não** deve ver ou
  ter acesso aos botões de "Editar Coluna", "Excluir Etapa" ou "Nova Etapa". A
  estrutura do funil é imutável para este perfil.

---

## 3. A Experiência do Administrador (O Construtor)

O usuário Admin terá permissões totais para gerenciar o funil.

- **Botão "Nova Etapa"**: Adicionar um botão "+ Adicionar Etapa" no
  `PipelineToolbar` (ou no final da rolagem horizontal do Kanban).
- **Modal de Criação/Edição (`StageModal`)**: Um modal simples contendo:
  1. **Nome**: Input de texto.
  2. **Cor**: Componente de color picker ou seleção da paleta padrão do sistema.
  3. **Status**: Um `<Select>` obrigatório com 3 opções exatas: `Aberto`,
     `Ganho` ou `Perdido`.
- **Menu de Contexto na Coluna**: No cabeçalho de cada coluna, incluir um menu
  dropdown (ex: ícone de três pontinhos ou engrenagem) com as opções: "Editar
  Etapa" e "Excluir Etapa" (visível apenas para Admins).
- **Drag & Drop Horizontal**: Permitir que o Admin clique no cabeçalho de uma
  coluna e a arraste lateralmente. Isso deve alterar o campo `position` no
  banco, reordenando o funil em tempo real.

---

## 4. O Cenário Crítico: A Exclusão de Etapas

A exclusão de colunas exige validações rigorosas para evitar perda de dados e
quebra de relatórios.

- **Modal de Exclusão Segura (`DeleteStageModal`)**: Ao acionar a exclusão de
  uma coluna, o sistema deve verificar o estado atual (se há leads atrelados a
  ela).
  - **Cenário A (Coluna Vazia)**: Exibir apenas um alerta simples de confirmação
    ("Tem certeza que deseja excluir esta etapa?").
  - **Cenário B (Coluna com Leads)**: Alterar o conteúdo do modal para: _"Esta
    etapa possui X leads. Para excluí-la, selecione para qual etapa deseja mover
    estes leads:"_, exibindo um `<select>` com as demais colunas disponíveis do
    funil.
- **A Trava das Extremidades (Validação Obrigatória)**: O sistema deve impedir
  que o funil fique sem etapas de conversão. Se o Admin tentar excluir a última
  etapa cadastrada como "Ganho" ou a última etapa como "Perdido", o botão de
  excluir deve ficar desabilitado (disabled), exibindo um tooltip que explique a
  obrigatoriedade de manter pelo menos uma etapa desse tipo.

---

## 5. Ajustes Menores de Componentes

- **Componente `LeadCard` e Listagens**: Em locais do sistema (como a
  visualização em lista) onde o status em texto é exibido diretamente, será
  necessário criar um subcomponente (ex:
  `<StageBadge stageId={lead.stage_id} />`). Este componente ficará responsável
  por cruzar o `stage_id` com os dados do pipeline para exibir o nome correto da
  etapa e sua respectiva cor de forma dinâmica.
