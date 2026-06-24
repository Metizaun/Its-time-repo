# Proxima Implementacao - Biblioteca de Arquivos e Storage

## 1. Objetivo

Criar uma area chamada **Biblioteca** para que clientes gerenciem os arquivos usados pelas Tools sem depender de links manuais ou do painel do Supabase.

O termo `Storage` permanece apenas na arquitetura. Na interface, usar:

- Biblioteca;
- Produtos;
- Catalogos;
- Imagens;
- Arquivos.

Esta implementacao substituira gradualmente o Google Drive como repositorio operacional do Visagismo e os links manuais da Tool Enviar midia.

## 2. Escopo funcional

### 2.1 Navegacao

Adicionar uma aba **Biblioteca** no app com:

- busca;
- filtro por tipo;
- filtro por Tool;
- upload;
- preview;
- edicao de nome e descricao;
- ativacao/desativacao;
- exclusao com confirmacao;
- estado de processamento.

Abas iniciais:

1. **Produtos:** imagens de armacoes e itens usados em recomendacao/edicao.
2. **Catalogos:** PDFs e materiais comerciais.
3. **Imagens:** fotos institucionais e materiais avulsos.

Nao criar uma tela parecida com explorador de bucket. O usuario gerencia ativos de negocio, nao caminhos tecnicos.

### 2.2 Upload

Fluxo:

1. selecionar ou arrastar arquivo;
2. validar tipo e tamanho no cliente;
3. criar intencao de upload no backend;
4. enviar por URL assinada;
5. backend valida objeto, MIME e checksum;
6. gerar preview/thumbnail quando aplicavel;
7. solicitar nome, descricao e uso;
8. vincular a uma ou mais Tools;
9. marcar como pronto.

Estados:

```text
uploading | processing | ready | failed | archived
```

## 3. Arquitetura Supabase Storage

### 3.1 Bucket

Criar bucket privado e duravel:

```text
tool-assets
```

Manter `chat-attachments` separado:

- `tool-assets`: fonte duravel de produtos, catalogos e imagens;
- `chat-attachments`: copia associada a uma mensagem enviada ou recebida.

Nunca tornar `tool-assets` publico. Evolution e workers recebem URLs assinadas de curta duracao geradas pelo backend.

### 3.2 Caminho

```text
{aces_id}/{asset_id}/original/{sanitized_file_name}
{aces_id}/{asset_id}/preview/{generated_file_name}
```

O caminho deve ser criado pelo backend. O cliente nao escolhe `aces_id`, bucket ou pasta.

### 3.3 Tabela de metadados

Criar `crm.tool_assets`:

```text
id uuid
aces_id integer
display_name text
description text
asset_type text
media_kind text
storage_bucket text
storage_path text
preview_storage_path text
mime_type text
file_name text
file_size bigint
checksum_sha256 text
status text
source_type text
source_external_id text
created_by uuid
created_at timestamptz
updated_at timestamptz
archived_at timestamptz
```

Criar `crm.agent_tool_assets`:

```text
agent_tool_id uuid
asset_id uuid
usage_instruction text
default_caption text
sort_order integer
is_active boolean
created_at timestamptz
```

Unicidade `(agent_tool_id, asset_id)`.

Para produtos de visagismo, criar extensao tipada `crm.visual_catalog_items`:

```text
id uuid
aces_id integer
asset_id uuid
product_code text
recommendation_description text
attributes jsonb
is_active boolean
created_at timestamptz
updated_at timestamptz
```

Nao guardar descricao de recomendacao apenas no nome do arquivo.

### 3.4 RLS e grants

- RLS em todas as tabelas;
- policies por `aces_id` e papel CRM;
- indices em `aces_id`, FKs e status;
- `anon` sem acesso;
- `authenticated` recebe apenas operacoes necessarias;
- `service_role` apenas no backend;
- policies de `storage.objects` restringem bucket e primeiro segmento do caminho ao `aces_id` confiavel;
- upload com upsert, se usado, exige `INSERT`, `SELECT` e `UPDATE`;
- exclusao logica antes da remocao fisica.

Como o projeto pode adotar defaults novos do Supabase, toda migracao deve declarar grants explicitamente. RLS e grants sao camadas separadas.

## 4. Seguranca e validacao

Tipos iniciais:

- `image/jpeg`;
- `image/png`;
- `image/webp`;
- `application/pdf`.

Regras:

- validar assinatura real do arquivo;
- normalizar nome;
- bloquear executaveis e SVG ativo na V1;
- calcular SHA-256 no backend;
- deduplicar dentro da conta;
- limitar tamanho por tipo;
- nao confiar em MIME enviado pelo navegador;
- URL assinada com expiracao curta;
- preview nunca revela objeto de outra conta;
- logs nao registram URL assinada completa.

## 5. Integracao com Tools

### 5.1 Enviar midia

Substituir `source_url` manual por `asset_id`.

Ao enviar:

1. validar binding e conta;
2. copiar ou baixar o ativo para o contexto da mensagem;
3. registrar `crm.message_attachments`;
4. enviar pela abstracao WhatsApp;
5. preservar historico mesmo que o ativo original seja arquivado.

### 5.2 Visagismo

Substituir Google Drive file ID por `visual_catalog_items.asset_id`.

O worker recebe apenas itens ativos da conta com URL assinada. Matching continua usando descricao de recomendacao e atributos.

### 5.3 Analista

Receitas recebidas continuam em `chat-attachments`, nao em `tool-assets`. A Biblioteca nao e prontuario e nao deve listar imagens pessoais de leads.

## 6. Importacao do Google Drive

Criar importador administrativo:

1. ler produtos atuais e Drive file IDs;
2. baixar arquivo;
3. validar MIME e checksum;
4. criar `tool_assets`;
5. criar `visual_catalog_items` preservando SKU e descricao;
6. vincular ao Visagismo;
7. registrar origem e ID externo;
8. gerar relatorio de sucesso, duplicidade e falha.

Durante migracao:

- leitura prioriza `asset_id` local;
- se ausente, usa Drive como fallback;
- depois de 100% validado, remover fallback em release separada;
- nunca remover arquivos do Drive automaticamente.

## 7. UI e UX

Seguir `10-padrao-tools-design-ui-ux.md` e o design system.

### Desktop

- header compacto com busca e CTA `Adicionar arquivo`;
- filtros persistentes;
- grid de cards para imagens/produtos;
- lista compacta para PDFs;
- painel lateral para detalhes e vinculacoes.

### Mobile

- uma coluna;
- filtros em sheet;
- upload com progresso visivel;
- acoes secundarias em menu;
- nenhum scroll horizontal.

Card de ativo:

- thumbnail ou icone;
- nome;
- tipo;
- Tools vinculadas;
- estado;
- menu de acoes.

Nao mostrar bucket, storage path, checksum ou MIME, exceto em area administrativa de diagnostico.

## 8. BI e observabilidade

Publicar eventos, sem copiar o arquivo para o schema `bi`:

```text
asset.upload_started
asset.upload_completed
asset.processing_failed
asset.linked_to_tool
asset.sent
asset.archived
drive_import.completed
drive_import.failed
```

Metricas:

- ativos por conta e Tool;
- taxa de upload;
- taxa de falha;
- ativos mais enviados;
- produtos mais selecionados no Visagismo;
- arquivos sem vinculacao;
- economia obtida por deduplicacao.

## 9. Metricas de sucesso

- upload concluido >= 99%;
- zero acesso entre contas;
- zero arquivo executavel aceito;
- zero objeto orfao apos processo de limpeza;
- preview p95 <= 2 segundos;
- 100% dos ativos com checksum;
- importacao do Drive sem perda de SKU ou descricao;
- 100% das mensagens com copia historica valida;
- nenhuma foto pessoal de lead exibida na Biblioteca.

## 10. Testes obrigatorios

- imagem e PDF validos;
- MIME falso;
- arquivo acima do limite;
- arquivo duplicado;
- upload interrompido;
- retry idempotente;
- duas contas com mesmo nome de arquivo;
- RLS em metadados e `storage.objects`;
- URL assinada expirada;
- arquivamento de ativo usado no historico;
- importacao Drive parcial e retomada;
- vinculacao a varias Tools;
- responsividade e navegacao por teclado.

## 11. Rollout

1. criar bucket e tabelas com flags desligadas;
2. testar policies e grants;
3. upload administrativo interno;
4. importar catalogo piloto do Google Drive;
5. habilitar Biblioteca para conta interna;
6. migrar Tool Enviar midia;
7. migrar Visagismo;
8. liberar para contas piloto;
9. remover fallback de links em release posterior.

Feature flags:

```text
TOOL_ASSET_LIBRARY_ENABLED
TOOL_ASSET_UPLOAD_ENABLED
GOOGLE_DRIVE_IMPORT_ENABLED
VISAGISM_LOCAL_CATALOG_ENABLED
```

