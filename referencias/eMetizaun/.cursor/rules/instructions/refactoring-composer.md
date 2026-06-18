1\. Contexto Geral e Objetivo
-----------------------------

O nicho do projeto pivotou para **Clínicas em Geral** (foco inicial em Estética e Saúde).Precisamos refatorar a atual página "Composer" para um novo ambiente chamado **"Create"**. Este ambiente funcionará como um painel de criação dividido em duas áreas principais: uma **Sidebar de Configuração** (esquerda) e um **Canvas/Lousa de Edição** (direita).

Nesta **Fase 1**, a implementação deve focar **exclusivamente na criação e edição de Textos** (WhatsApp, E-mail e Redes Sociais). A parte de imagens será feita na Fase 2.

**Design System:** O visual deve ser extremamente minimalista e limpo, herdando os padrões visuais e de estrutura já existentes no arquivo Tasks.tsx.

2\. Etapa 1: Refatoração de Rotas e Nomenclatura
------------------------------------------------

**Objetivo:** Renomear as dependências do antigo "Composer" para "Create".

*   **Arquivos:** Renomear o arquivo principal de Composer.tsx para Create.tsx (e atualizar os imports).
    
*   **Navegação:** Atualizar a sidebar de navegação global (AppSidebar ou similar) alterando o item "Composer" para "Create".
    
*   **Rotas:** Atualizar o App.tsx para que a rota /composer passe a ser /create.
    

3\. Etapa 2: Layout Principal (Split Screen)
--------------------------------------------

**Objetivo:** Criar o esqueleto da página Create.tsx.

*   Implementar um layout de tela dividida.
    
*   **Esquerda (Sidebar):** Painel rolável (ScrollArea) com largura fixa (aprox. 300px a 350px) para os controles de input.
    
*   **Direita (Canvas):** Área principal de visualização expandida. Fundo levemente contrastante para simular uma "lousa" de trabalho, onde o conteúdo gerado aparecerá.
    

4\. Etapa 3: Desenvolvimento da Sidebar (Controles de Criação)
--------------------------------------------------------------

**Objetivo:** Construir o formulário lateral com as opções de parametrização. Use os componentes UI do projeto (ex: Shadcn UI).

**Campos obrigatórios na Sidebar:**

1.  **Toggle Principal:** Alternador estilo "Pills" ou "Tabs" para \[ Texto | Imagem \]. (Deixe "Imagem" desabilitado ou mockado por enquanto).
    
2.  **Modo de Ação:** Alternador para \[ Criar | Melhorar \].
    
3.  **Tipo de Mensagem:** Um Dropdown/Select com as opções:
    
    *   WhatsApp
        
    *   E-mail
        
    *   Texto (Redes Sociais)
        
4.  **Seção "Conteúdo da Mensagem":**
    
    *   Título da seção (Se "E-mail" estiver selecionado no dropdown anterior, exibir também um campo de Título/Assunto).
        
    *   Um Textarea para o usuário descrever o conteúdo base.
        
    *   **Bubbles (Badges interativos):** Abaixo do textarea, adicionar chips/badges clicáveis com templates focados em **Clínicas de Estética/Saúde**. Ao clicar, o texto do bubble deve preencher o textarea com variáveis.
        
        *   _Exemplos de Bubbles:_ "Promoção \[Procedimento\] \[Mês\]", "Lembrete de Consulta para \[Nome\]", "Pós-atendimento \[Procedimento\]".
            
5.  **Seção "Estilo da Mensagem":**
    
    *   Um Textarea pequeno para descrever o tom (ex: "Tom acolhedor e profissional").
        
    *   **Bubbles de Estilo:** Chips clicáveis com predefinições.
        
        *   _Exemplos de Bubbles:_ "Clínica Premium (Elegante)", "Popular/Acessível (Descontraído)", "Foco em Saúde (Autoridade/Sério)".
            
6.  **Seção "Presets":**
    
    *   Dropdown com a opção "Default" e uma opção "+ Criar Novo".
        
7.  **Opções Avançadas (Exibidas ao clicar em gerar ou em um painel sanfona "Opções"):**
    
    *   **Estilo e Tom:** Dropdown (Corporativo, Criativo, Empático, Urgente, etc.) com o subtexto: _"Defina um tom e estilo para a mensagem"_.
        
    *   **Emojis:** Dropdown (Usar mais, Padrão, Não usar).
        
    *   **Instruções Personalizadas:** Um Textarea para regras adicionais (ex: "Nunca chame de cliente, chame de paciente").
        

5\. Etapa 4: Desenvolvimento do Canvas (A Lousa)
------------------------------------------------

**Objetivo:** Construir a área direita onde o texto gerado pela IA será exibido e poderá ser editado manualmente pelo usuário.

**Regras do Canvas:**

*   Deve ser um container centralizado, imitando uma folha de papel ou um card de post.
    
*   **Se o Tipo de Mensagem for WhatsApp ou Redes Sociais:**
    
    *   Renderizar um grande Textarea sem bordas agressivas (estilo editor Notion/Lousa), ocupando o espaço central.
        
*   **Se o Tipo de Mensagem for E-mail:**
    
    *   Renderizar dois campos distintos: Um Input de texto simples no topo para o "Título do E-mail", e um Textarea maior abaixo para o "Corpo do E-mail".
        
*   **Interações no Canvas:**
    
    *   Ícone de **Copy (Copiar)** posicionado no canto superior direito do Canvas.
        
    *   O texto no Canvas deve ser 100% editável pelo usuário para ajustes finos após a geração da IA.
        

6\. Etapa 5: Rodapé de Ações
----------------------------

**Objetivo:** Posicionar os botões finais de ação na tela.
*   Posicionar no centro de SideBar no fundo direito do layout principal Um botão principal em Sidebar:

    1.  **"Criar msg"** (Botão primário com destaque - acionará a geração no futuro)

*   Posicionar no canto inferior direito do layout principal (abaixo do Canvas ou fixo na base) Um botão principal:
        
    2.  **"Salvar template"** (Botão /Outline - para salvar a estrutura atual).
        

Regras de Implementação para o Codex
------------------------------------

*   **Design Limpo:** Reutilize as classes do Tailwind e componentes padrão da aplicação. Evite excesso de bordas (border), prefira usar sombras leves (shadow-sm) e fundos sutis (bg-muted/50 ou bg-gray-50) para separar a sidebar do Canvas.
    
*   **Sem Lógica de IA Ainda:** Não se preocupe em conectar com o backend do Supabase ou funções de IA (Supabase Edge Functions) neste exato momento. O foco é deixar a Interface (UI) e os Estados (useState) 100% funcionais (ex: quando mudar o dropdown para E-mail, o Canvas deve reagir e mostrar o campo de Título).
    
*   **Modularização:** Se o arquivo Create.tsx ficar muito grande, divida-o em componentes menores dentro de src/components/Composer/ (que pode ser renomeado para src/components/Create/), como CreateSidebar.tsx e CreateCanvas.tsx.