"""
Dados da auditoria de seguranca do chat-query (Its Time CRM).

Este modulo contem apenas dados. O layout/renderizacao fica em gerar_relatorio.py.
Para atualizar o relatorio depois de uma nova auditoria, edite as listas abaixo
e rode novamente o gerador.
"""

PROJETO = "Its Time CRM (chat-query)"
DATA_AUDITORIA = "04 de setembro de 2026"
BRANCH = "meta"
COMMIT = "36fa32a"

# ---------------------------------------------------------------------------
# Escopo e nota metodologica
# ---------------------------------------------------------------------------

STACK = [
    ("Frontend", "React 18 + TypeScript + Vite 7 + Tailwind/shadcn-ui; react-router-dom 7"),
    ("Backend proprio", "Node 22 + Express 5 (TypeScript), ~4.330 linhas de rotas em Project/IA/api-server.ts"),
    ("Banco / ORM", "PostgreSQL gerenciado (Supabase); acesso via supabase-js (PostgREST), sem ORM classico"),
    ("Auth", "Supabase Auth (JWT). Papel e tenant resolvidos em crm.users e espelhados em app_metadata do JWT"),
    ("Isolamento multi-tenant", "Duplo: (a) RLS no Postgres usando current_aces_id()/current_crm_role(); (b) filtro manual por aces_id no backend, que usa service_role"),
    ("Funcoes serverless", "3 Supabase Edge Functions (Deno): buscar-leads, import-leads-csv, send-user-invitation"),
    ("Deploy", "Docker + Docker Swarm (docker-stack.backend.yml), docker-compose.yml para dev, Vercel para o frontend"),
    ("Migrations", "173 arquivos SQL em supabase/migrations/ (schemas crm, agents, collections, calendar, meta, instagram, costs, rb, bi, locator)"),
]

ESCOPO = [
    "Project/IA/ — backend Express + workers + servicos de integracao (167 registros de rota, ~15.900 linhas em sdr-agent-gemini.ts)",
    "src/ — aplicacao React (paginas, hooks, services, componentes)",
    "supabase/migrations/ — 173 migrations, com foco em RLS, policies, GRANT/REVOKE e funcoes SECURITY DEFINER",
    "supabase/functions/ — 3 Edge Functions e supabase/config.toml (verify_jwt)",
    "docker-compose.yml, docker-stack.backend.yml, Project/IA/Dockerfile, scripts/, docs e arquivos .env*",
    "Historico do Git (todos os commits alcancaveis) e o bundle compilado em dist/",
]

METODOLOGIA = [
    ("1. Banco sem tranca (isolamento de tenant)",
     "O projeto tem DOIS mecanismos de isolamento e ambos foram mapeados. (a) RLS: foi levantada a lista "
     "completa de tabelas com ENABLE ROW LEVEL SECURITY nas migrations e cruzada com as 23 tabelas/views "
     "que o frontend consulta direto com a chave anon. (b) Filtro manual: o backend usa "
     "SUPABASE_SERVICE_ROLE_KEY (que ignora RLS), portanto cada handler foi verificado quanto ao filtro "
     "explicito por aces_id. Views tambem foram checadas quanto a security_invoker."),
    ("2. Permissao definida no navegador",
     "Cada gate de papel do frontend (isAdmin, isStaff, userRole === 'ADMIN', acesId === 535) foi localizado "
     "e rastreado ate a escrita correspondente — seja endpoint do backend, seja policy de RLS — para "
     "confirmar se existe verificacao equivalente no servidor."),
    ("3. IDOR",
     "Todos os 167 registros de rota de api-server.ts foram percorridos (nao amostrados). Para cada handler "
     "que delega a uma camada de servico, o metodo de servico foi aberto e classificado por guarda de posse "
     "(ensureAdmin / getAgentForAccount / loadLeadById / ensureInstanceOwnership / getAccessibleInstanceNames). "
     "As constraints do banco (FKs compostas (id, aces_id)) foram lidas para avaliar defesa em profundidade."),
    ("4. Chaves expostas",
     "Varredura de arquivos versionados, do historico completo do Git, dos arquivos .env* em disco (com "
     "checagem de git check-ignore), dos compose/stack files (com atencao a defaults ${VAR:-valor}), dos "
     "scripts de deploy, da documentacao e do bundle do frontend em dist/. Tambem foi verificada a existencia "
     "de validacao de startup que rejeite valores default."),
    ("5. Inputs sem tratamento (XSS)",
     "Frontend: busca por dangerouslySetInnerHTML, innerHTML/outerHTML/insertAdjacentHTML, eval, new Function, "
     "href/src dinamicos e renderizacao de markdown. Confirmado que nao existe biblioteca de sanitizacao "
     "(DOMPurify/sanitize-html) no projeto. Backend: procura por respostas HTML e por conteudo do usuario "
     "refletido em res.send()."),
]

OBSERVACOES_GERAIS = [
    "Nao existe framework de teste de seguranca automatizado no repositorio; a auditoria foi estatica, por leitura de codigo.",
    "Nao houve acesso ao banco de producao. Afirmacoes sobre RLS valem para o que esta declarado nas migrations.",
    "Duas condicoes de explorabilidade dependem de variaveis de ambiente nao versionadas (EVOLUTION_WEBHOOK_SECRET, RB_WEBHOOK_JWT_SECRET) e estao marcadas como tal em cada achado.",
    "O comportamento de res.send(string) do Express 5 (Content-Type: text/html) foi confirmado empiricamente com a versao instalada no projeto.",
]

# ---------------------------------------------------------------------------
# Achados
# severidade: critica | alta | media | baixa | info
# categoria: 1..5 conforme o pedido, ou "Extra" para achados fora das 5 categorias
# ---------------------------------------------------------------------------

ACHADOS = [
    dict(
        id="F01",
        titulo="Emissao de token de webhook sem nenhuma autenticacao (/webhook/login)",
        severidade="critica",
        categoria="3. IDOR",
        arquivos=["Project/IA/api-server.ts:841-853",
                  "Project/IA/rb-connection-service.ts:149-160",
                  "Project/IA/rb-connection-service.ts:162-183"],
        codigo=(
            'app.post(\n'
            '  "/webhook/login",\n'
            '  asyncHandler(async (req, res) => {\n'
            '    const rbAcesId = Number(req.body.aces_id);\n'
            '    const empId = Number(req.body.emp_id);\n'
            '    if (!Number.isInteger(rbAcesId) || rbAcesId <= 0 || !Number.isInteger(empId) || empId <= 0) {\n'
            '      throw new HttpError(400, "aces_id e emp_id sao obrigatorios e devem ser validos");\n'
            '    }\n'
            '    const connection = await rbConnectionService.authenticate({ rbAcesId });\n'
            '    if (!connection) throw new HttpError(404, "aces_id RB nao cadastrado");\n'
            '    const { token, exp } = rbConnectionService.signWebhookToken(connection, empId);\n'
            '    res.json({ token, aces_id: rbAcesId, exp: String(exp) });\n'
            '  }),\n'
            ');'
        ),
        porque=(
            "A rota nao passa por authMiddleware nem valida qualquer segredo, assinatura, mTLS ou allowlist de IP. "
            "A unica 'credencial' exigida e um inteiro positivo (aces_id) que a propria rota confirma existir "
            "respondendo 404 quando nao existe — ou seja, o endpoint funciona como oraculo de enumeracao. "
            "rbConnectionService.authenticate() busca a conexao apenas por rb_aces_id e is_active, e "
            "signWebhookToken() assina um JWT HS256 valido por 300s contendo connection_id e internal_aces_id "
            "do tenant descoberto. Esse token e aceito por POST /webhook/image e POST /webhook/delete "
            "(api-server.ts:990 e 1009), que sao verificados por verifyWebhookToken()."
        ),
        impacto=(
            "Tomada de controle das operacoes de visagismo de qualquer tenant, por atacante anonimo: "
            "POST /webhook/delete desativa itens do catalogo (visagism_catalog_items) e APAGA objetos do "
            "Supabase Storage do tenant (rb-visagism-service.ts:275-285); POST /webhook/image dispara analise "
            "de imagem por LLM debitada do orcamento de IA da conta da vitima. Enumeracao de inteiros pequenos "
            "revela quais aces_id RB existem."
        ),
        correcao=(
            "Exigir uma credencial real na emissao: segredo compartilhado por conexao (header validado em tempo "
            "constante contra collections/source_credentials ou rb.connections), ou assinatura HMAC do corpo, ou "
            "mTLS/allowlist de IP do parceiro RB. Enquanto isso, responder sempre 401 generico (sem distinguir "
            "aces_id inexistente de credencial invalida) e aplicar rate limit por IP, reaproveitando "
            "consume_webhook_rate_limit, que ja existe no schema collections."
        ),
        aceite=[
            "POST /webhook/login sem credencial valida responde 401 com corpo generico, para aces_id existente e inexistente.",
            "Nenhum token e emitido sem apresentacao de credencial por conexao.",
            "Rate limit por IP aplicado em /webhook/login (reaproveitar consume_webhook_rate_limit).",
            "Teste automatizado cobrindo: (a) sem credencial -> 401; (b) credencial de outra conexao -> 401; (c) credencial correta -> 200 com token.",
            "Tokens emitidos antes da correcao invalidados por rotacao de RB_WEBHOOK_JWT_SECRET.",
        ],
        condicao="Nenhuma. Explorável em qualquer deploy que exponha o backend, sem autenticacao previa.",
    ),
    dict(
        id="F02",
        titulo="Validacao do webhook da Evolution falha aberta quando o segredo nao esta configurado",
        severidade="alta",
        categoria="3. IDOR",
        arquivos=["Project/IA/sdr-agent-gemini.ts:15828-15835",
                  "Project/IA/api-server.ts:628-637",
                  "Project/IA/api-server.ts:832-833",
                  "Project/IA/api-server.ts:460"],
        codigo=(
            '// sdr-agent-gemini.ts:15828\n'
            'validateWebhookSecret(headerValue?: string | null) {\n'
            '  if (!this.config.evolutionWebhookSecret) {\n'
            '    return true;            // <-- fail-open\n'
            '  }\n'
            '  const provided = headerValue?.replace(/^Bearer\\s+/i, "").trim();\n'
            '  return provided === this.config.evolutionWebhookSecret;   // comparacao nao constante\n'
            '}'
        ),
        porque=(
            "EVOLUTION_WEBHOOK_SECRET e opcional (api-server.ts:460 usa process.env sem requireEnv). Quando a "
            "variavel esta vazia, validateWebhookSecret() devolve true para qualquer requisicao e o "
            "webhookHandler (api-server.ts:628) segue direto para manager.processEvolutionWebhook(). Diferente do "
            "handler da Gupshup, que barra a ausencia de segredo em producao "
            "('if (!configuredSecret && process.env.NODE_ENV === \"production\") throw 503', api-server.ts:710-712), "
            "aqui nao existe guarda de ambiente. A comparacao tambem usa === em vez de timingSafeEqual, "
            "ao contrario dos webhooks Meta/Instagram."
        ),
        impacto=(
            "Injecao anonima de mensagens de entrada falsas em qualquer tenant via POST /webhook/evolution ou "
            "/api/webhook/evolution: criacao/alteracao de leads, disparo do agente de IA (com custo de LLM), "
            "envio de respostas ao WhatsApp e movimentacao de etapas do funil. Envenenamento do historico de "
            "conversa e possivel prompt injection indireta no agente."
        ),
        correcao=(
            "Fazer a validacao falhar fechada: retornar false quando o segredo nao estiver configurado e "
            "adicionar assercao de startup que aborte o processo se EVOLUTION_WEBHOOK_SECRET estiver ausente "
            "com NODE_ENV=production (ou promover a requireEnv). Trocar === por crypto.timingSafeEqual sobre "
            "buffers de mesmo tamanho, como ja e feito em meta-webhook.ts:56-70."
        ),
        aceite=[
            "Com EVOLUTION_WEBHOOK_SECRET ausente e NODE_ENV=production, o processo nao sobe (ou o webhook responde 503).",
            "validateWebhookSecret retorna false quando o segredo nao esta configurado.",
            "Comparacao do segredo feita em tempo constante.",
            "Teste cobrindo: sem segredo configurado -> requisicao rejeitada; segredo errado -> 401; segredo correto -> 202.",
        ],
        condicao="Requer EVOLUTION_WEBHOOK_SECRET vazio/ausente no ambiente. Nao ha nada no codigo que impeca esse estado.",
    ),
    dict(
        id="F03",
        titulo="Edge Function send-user-invitation sem autorizacao e sem vinculo convite<->e-mail",
        severidade="alta",
        categoria="2. Permissao definida no navegador",
        arquivos=["supabase/functions/send-user-invitation/index.ts:38-41",
                  "supabase/functions/send-user-invitation/index.ts:43-55",
                  "supabase/functions/send-user-invitation/index.ts:74-77",
                  "supabase/config.toml:49-51"],
        codigo=(
            'const { email, invitationId } = body ?? {};\n'
            'if (!email || !invitationId) { /* ... 400 ... */ }\n'
            '\n'
            'const supabaseAdmin = createClient(\n'
            '  Deno.env.get("SUPABASE_URL") ?? "",\n'
            '  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",   // service_role: ignora RLS\n'
            ');\n'
            '\n'
            'const { data: invitation } = await supabaseAdmin\n'
            '  .schema("crm").from("user_invitations")\n'
            '  .select("*").eq("id", invitationId).single();      // sem filtro por aces_id\n'
            '\n'
            'await supabaseAdmin.auth.admin.inviteUserByEmail(email, {   // email vem do atacante\n'
            '  data: { name: invitation.name, role: invitation.role,\n'
            '          aces_id: invitation.aces_id, invitation_id: invitationId },\n'
            '});'
        ),
        porque=(
            "A funcao nao chama auth.getUser(), nao verifica papel e nao compara o parametro email com "
            "invitation.email. O convite e buscado com service_role apenas por id, sem filtro por tenant. "
            "verify_jwt = true (config.toml:51) garante somente que exista um JWT valido do projeto — qualquer "
            "usuario autenticado serve, de qualquer papel e de qualquer tenant. A policy inv_select "
            "(20260411154500_fix_crm_rls_recursion.sql:105-107) permite a qualquer usuario autenticado ler os "
            "convites do seu proprio aces_id, incluindo os de role ADMIN, o que fornece um invitationId valido."
        ),
        impacto=(
            "Escalonamento de privilegio: um VENDEDOR ou NENHUM le um invitationId com role ADMIN da sua conta "
            "e chama a funcao com um e-mail que controla; o Supabase envia convite carregando "
            "role=ADMIN e aces_id da conta no app_metadata do novo usuario, resultando em conta ADMIN sob "
            "controle do atacante. O parametro email desacoplado do convite tambem permite redirecionar "
            "qualquer convite pendente para um endereco arbitrario."
        ),
        correcao=(
            "Na propria funcao: (1) resolver o chamador com um client anon usando o header Authorization e "
            "auth.getUser(); (2) carregar o crm.users do chamador e exigir role ADMIN; (3) filtrar o convite por "
            "aces_id do chamador; (4) ignorar o email do corpo e usar exclusivamente invitation.email. "
            "Os arquivos buscar-leads/index.ts:56-91 e import-leads-csv/index.ts:242-276 ja implementam "
            "exatamente esse padrao e servem de referencia."
        ),
        aceite=[
            "A funcao resolve o chamador via auth.getUser() e rejeita com 401 quando nao ha usuario valido.",
            "A funcao rejeita com 403 quando o chamador nao tem role ADMIN.",
            "O convite e carregado com filtro .eq('aces_id', callerAcesId); id de outro tenant retorna 404.",
            "O destinatario do convite vem de invitation.email; o campo email do corpo e ignorado ou validado como igual.",
            "Teste cobrindo: sem JWT -> 401; JWT de VENDEDOR -> 403; invitationId de outro tenant -> 404; email divergente -> rejeitado.",
        ],
        condicao="Requer apenas uma sessao autenticada qualquer no projeto Supabase e um invitationId valido.",
    ),
    dict(
        id="F04",
        titulo="Senha de root do VPS de producao em texto puro em scripts do projeto",
        severidade="alta",
        categoria="4. Chaves expostas",
        arquivos=["scripts/get_vps_logs.js:36-39",
                  "scripts/check_vps_git.js:39-45",
                  "scripts/search_vps_logs.js:36-39"],
        codigo=(
            '// scripts/get_vps_logs.js:36\n'
            '}).connect({\n'
            '  host: "72.60.251.89",\n'
            '  port: 22,\n'
            '  username: "root",\n'
            '  password: "<SENHA REAL REDIGIDA NESTE RELATORIO>"\n'
            '});\n'
            '\n'
            '// A senha aparece literalmente na linha 39 do arquivo.\n'
            '// Foi omitida aqui de proposito: este relatorio circula, a credencial nao deve.'
        ),
        porque=(
            "Credencial de root SSH de host de producao gravada literalmente em tres arquivos da arvore do "
            "projeto. Verificado que os tres estao cobertos por .gitignore:68 (/scripts/*vps*.js) e que nunca "
            "foram commitados ('git log --all' vazio para esses caminhos) — mas a protecao e apenas um glob de "
            "nome de arquivo. Renomear para scripts/logs.js, copiar o trecho para outro script, colar em um "
            "issue/PR ou usar 'git add -f' derrama a senha no historico. Alem disso, o par usuario/senha "
            "indica que autenticacao por senha para root esta habilitada no SSH do host."
        ),
        impacto=(
            "Comprometimento total do host: acesso root ao VPS, que executa a Docker Swarm do backend e portanto "
            "carrega SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY, OPENAI_API_KEY, EVOLUTION_API_KEY, "
            "INSTAGRAM_APP_SECRET, INSTAGRAM_TOKEN_ENCRYPTION_KEY, COLLECTION_SECRETS_ENCRYPTION_KEY e "
            "RB_WEBHOOK_JWT_SECRET no ambiente dos servicos. Com a service_role em maos, todo o isolamento "
            "multi-tenant cai."
        ),
        correcao=(
            "Rotacionar a senha de root imediatamente. Migrar os tres scripts para autenticacao por chave "
            "(privateKey lida de caminho fora do repositorio) ou, melhor, para o binario ssh com um bloco em "
            "~/.ssh/config, sem host nem credencial no codigo — host e usuario vindos de variaveis de ambiente. "
            "Desabilitar PermitRootLogin/PasswordAuthentication no sshd do host. Ampliar o .gitignore de um glob "
            "de nome para uma regra por diretorio (ex.: /scripts/local/) e adicionar um hook de pre-commit com "
            "varredura de segredos."
        ),
        aceite=[
            "Senha de root do VPS rotacionada e a antiga invalidada.",
            "Nenhum dos tres scripts contem host, usuario ou senha literais; credenciais vem de env/arquivo externo.",
            "sshd do host com PasswordAuthentication no e PermitRootLogin prohibit-password (ou no).",
            "Hook de pre-commit com varredura de segredos ativo no repositorio.",
            "grep -rn 'password:' scripts/ nao retorna credencial literal.",
        ],
        condicao="Arquivos ignorados pelo Git e presentes apenas no disco local; o risco e de vazamento por copia/renomeacao e de exposicao da maquina do desenvolvedor.",
    ),
    dict(
        id="F05",
        titulo="POST /api/agents/:id/tools/rb_billing/run-now sem verificacao de papel no servidor",
        severidade="media",
        categoria="2. Permissao definida no navegador",
        arquivos=["Project/IA/api-server.ts:2928-2937",
                  "Project/IA/rb-billing-worker.ts:459-462",
                  "Project/IA/sdr-agent-gemini.ts:5145-5147",
                  "src/services/agentToolsService.ts:380"],
        codigo=(
            '// api-server.ts:2928 — nao chama manager.*, portanto nao passa por ensureAdmin\n'
            'app.post(\n'
            '  "/api/agents/:id/tools/rb_billing/run-now",\n'
            '  authMiddleware,\n'
            '  asyncHandler(async (req: AuthenticatedRequest, res) => {\n'
            '    const agentId = getSingleParam(req.params.id);\n'
            '    const result = await rbBillingWorker.runNowForAgent(\n'
            '      req.authContext!.acesId, agentId);        // so escopo de tenant, sem papel\n'
            '    res.status(202).json({ success: true, result });\n'
            '  }),\n'
            ');\n'
            '\n'
            '// contraste — a rota irma valida papel:\n'
            '// sdr-agent-gemini.ts:5145  async bootstrapRbBilling(...) { this.ensureAdmin(context); ... }'
        ),
        porque=(
            "Essa e a unica rota de /api/agents/:id/tools/* que nao delega ao manager (que sempre chama "
            "ensureAdmin + getAgentForAccount). Ela chama rbBillingWorker.runNowForAgent diretamente, e o "
            "getBindingForAgent (rb-billing-worker.ts:479-486) filtra apenas por aces_id e agent_id. O isolamento "
            "de tenant esta correto; o que falta e o controle de papel. No frontend, toda a pagina de Agentes "
            "esta atras de isAdmin (src/components/layout/Sidebar.tsx:202), logo a restricao existe so no navegador."
        ),
        impacto=(
            "Qualquer usuario autenticado do tenant, inclusive com role NENHUM ou VENDEDOR, dispara uma rodada de "
            "cobranca fora de hora: envio de mensagens de cobranca a leads reais via WhatsApp, consumo de "
            "orcamento de IA e poluicao dos registros de execucao. Nao ha exposicao de dados de outro tenant."
        ),
        correcao=(
            "Roteá-la pelo manager, como as demais: adicionar uma verificacao explicita de papel antes da "
            "chamada (const context = req.authContext!; if (context.role !== 'ADMIN') throw new HttpError(403, ...)) "
            "e validar a posse do agente com manager.getAgentForAccount(agentId, context.acesId, context.crmUserId, context.role) — "
            "de preferencia expondo um metodo runRbBillingNow(context, agentId) no AgentManager para manter o padrao."
        ),
        aceite=[
            "Chamada com token de usuario VENDEDOR/NENHUM retorna 403.",
            "Chamada com agentId de outro tenant retorna 404.",
            "A rota valida posse do agente pela mesma funcao usada pelas rotas irmas.",
            "Teste de rota cobrindo os tres casos (NENHUM -> 403, VENDEDOR -> 403, ADMIN -> 202).",
        ],
        condicao="Requer sessao autenticada no tenant e um agente com a tool rb_billing configurada.",
    ),
    dict(
        id="F06",
        titulo="Upsert por id fornecido pelo cliente permite sequestro de linhas de outro tenant",
        severidade="media",
        categoria="3. IDOR",
        arquivos=["Project/IA/api-server.ts:1345-1362",
                  "Project/IA/api-server.ts:1364-1395",
                  "Project/IA/api-server.ts:1292-1316"],
        codigo=(
            '// api-server.ts:1345 — /api/collections/bindings\n'
            'const { data, error } = await collectionApi.collectionService.collections\n'
            '  .from("agent_source_bindings").upsert({\n'
            '    id: asString(req.body.id) ?? undefined,     // <-- id arbitrario do cliente\n'
            '    aces_id: context.acesId,\n'
            '    agent_tool_id: String(req.body.agentToolId ?? ""),\n'
            '    source_connection_id: String(req.body.sourceConnectionId ?? ""),\n'
            '    ...\n'
            '  }).select("*").single();\n'
            '\n'
            '// mesmo padrao em journey_rules (1364) e mapping_profiles (1292)'
        ),
        porque=(
            "collectionApi.collectionService.collections e um client service_role "
            "(collections/collection-service.ts:62), logo RLS nao se aplica; o unico limite e o filtro manual. "
            "O upsert do supabase-js usa a chave primaria como conflict target por padrao, e a PK dessas tabelas "
            "e apenas id. Passando o id de uma linha de outro tenant, o UPDATE acerta aquela linha e reescreve "
            "seu aces_id para o do atacante. As FKs compostas (agent_tool_id, aces_id) e "
            "(source_connection_id, aces_id) — 20260903205231_collections_core_v1.sql:115-120 — impedem apontar "
            "para objetos de outro tenant, mas nao impedem a linha alheia de ser movida."
        ),
        impacto=(
            "Escrita destrutiva cross-tenant: um ADMIN do tenant A remove silenciosamente um binding, uma "
            "journey_rule ou um mapping_profile do tenant B (a linha passa a pertencer a A). Para journey_rules "
            "isso interrompe a jornada de cobranca da vitima. Nao ha leitura de dados alheios, apenas perda de "
            "configuracao. Requer conhecer/adivinhar um UUID."
        ),
        correcao=(
            "Nao aceitar id do cliente em criacao. Para atualizacao, separar as rotas: PATCH /:id que faca "
            "UPDATE ... .eq('id', id).eq('aces_id', context.acesId) e retorne 404 quando nao afetar linha — "
            "exatamente o padrao ja usado em /api/collections/sources/:id (api-server.ts:1064-1081). "
            "Alternativamente, declarar o onConflict como a chave natural do negocio "
            "(ex.: 'agent_tool_id,source_connection_id,creditor_external_id') e nunca a PK."
        ),
        aceite=[
            "POST/PATCH das tres rotas nunca aceitam id arbitrario para criar linha nova.",
            "Atualizacao ocorre por UPDATE com .eq('aces_id', context.acesId) e retorna 404 quando nao ha match.",
            "Teste: id de linha de outro tenant -> 404 e a linha original permanece intacta com o aces_id original.",
            "Nenhum upsert no schema collections usa a PK como conflict target com id vindo do corpo.",
        ],
        condicao="Requer papel ADMIN em algum tenant e conhecimento do UUID da linha alvo.",
    ),
    dict(
        id="F07",
        titulo="Sincronizacao de templates Meta nao filtra por tenant",
        severidade="media",
        categoria="1. Banco sem tranca (isolamento de tenant)",
        arquivos=["Project/IA/api-server.ts:1488-1508",
                  "Project/IA/meta-template-service.ts:106-118",
                  "Project/IA/meta-template-service.ts:56-97"],
        codigo=(
            '// api-server.ts:1488 — instanceName vem do corpo e nao e validado contra o tenant\n'
            'const result = await metaTemplateService.syncTemplatesForInstance(instanceName);\n'
            '\n'
            '// meta-template-service.ts:106 — requireChannel sem acesId\n'
            'private async requireChannel(instanceName: string) {\n'
            '  const { data, error } = await this.metaClient\n'
            '    .from("whatsapp_channels")\n'
            '    .select("id, waba_id, access_token_secret_ref")\n'
            '    .eq("instance_name", instanceName)      // <-- falta .eq("aces_id", acesId)\n'
            '    .maybeSingle();'
        ),
        porque=(
            "O handler confere apenas que o chamador e ADMIN e repassa instanceName cru. requireChannel busca o "
            "canal so por instance_name usando client service_role, sem escopo de conta. Todas as rotas irmas "
            "fazem o certo: metaAdminService.upsertChannel passa por requireInstance(acesId, instanceName) "
            "(meta-admin-service.ts:182-189) e listTemplates recebe acesId. Nomes de instancia sao curtos e "
            "previsiveis (o script verify-evolution-env.mjs cita 'prospect', 'Juan', 'Lucas'), o que torna a "
            "adivinhacao viavel."
        ),
        impacto=(
            "Escrita cross-tenant: um ADMIN do tenant A sobrescreve meta.whatsapp_templates e "
            "last_template_sync_at do canal do tenant B e provoca chamadas a Graph API da Meta usando o "
            "access token do tenant B (consumo de quota e ruido nos logs do parceiro). A resposta devolve apenas "
            "{ instanceName, mode, synced }, portanto nao ha leitura direta do conteudo alheio."
        ),
        correcao=(
            "Propagar o tenant: mudar a assinatura para syncTemplatesForInstance(acesId, instanceName) e "
            "adicionar .eq('aces_id', acesId) em requireChannel; ou validar antes no handler com "
            "metaAdminService.requireInstance(context.acesId, instanceName). Vale varrer meta-template-service.ts "
            "em busca de outras consultas sem escopo de conta."
        ),
        aceite=[
            "syncTemplatesForInstance recebe e aplica acesId.",
            "requireChannel filtra por aces_id e instance_name.",
            "Chamada com instanceName de outro tenant retorna 404 e nao altera nenhuma linha.",
            "Teste com dois tenants confirmando isolamento.",
        ],
        condicao="Requer papel ADMIN em algum tenant e conhecer o nome de instancia da vitima.",
    ),
    dict(
        id="F08",
        titulo="Export de relatorio de leads restrito apenas no navegador, sobre view sem RLS rastreada",
        severidade="media",
        categoria="2. Permissao definida no navegador",
        arquivos=["src/pages/Leads.tsx:112-137",
                  "src/integrations/supabase/client.ts:15-24"],
        codigo=(
            '// src/pages/Leads.tsx:112\n'
            'const { profile } = await getCrmBackend<CrmProfileResponse>("/api/crm/profile");\n'
            'const acesId = profile?.aces_id;\n'
            '\n'
            '// 3. Verificar se e o aces_id especial (535)\n'
            'if (acesId === 535) {                      // <-- gate 100% client-side\n'
            '  let query = supabase\n'
            '    .from(\'vw_relatorio_leads\')          // view nao definida em supabase/migrations/\n'
            '    .select(\'*\');\n'
            '  ...\n'
            '  const { data: viewData } = await query;\n'
            '  exportGenericToCSV(viewData, ...);'
        ),
        porque=(
            "A decisao de acesso ao relatorio esta num if do bundle React: qualquer usuario autenticado pode "
            "chamar supabase.from('vw_relatorio_leads').select('*') pelo console do navegador com a chave anon, "
            "sem passar por esse if. O que impede o vazamento e exclusivamente a postura de RLS da view — e "
            "vw_relatorio_leads NAO existe em nenhuma das 173 migrations (foi criada fora do versionamento). "
            "Views no Postgres nascem com security_invoker = false, isto e, consultam as tabelas-base como o "
            "owner e ignoram a RLS de crm.leads. Todas as outras views do projeto tratam isso explicitamente "
            "(crm.v_lead_details recebe ALTER VIEW ... SET (security_invoker = true) apos cada redefinicao — "
            "20260618205533:55, 20260708211239:133, 20260724202355:593, 20260827145250:151)."
        ),
        impacto=(
            "Se a view em producao estiver com security_invoker = false e SELECT concedido a authenticated, "
            "qualquer usuario logado de qualquer tenant extrai a base de leads inteira de todas as contas "
            "(dados pessoais: nome, telefone, e-mail, cidade, historico de etapa) — vazamento de LGPD em massa. "
            "Nao foi possivel confirmar o estado real em producao porque a view nao esta versionada; por isso "
            "o achado esta em media e nao em critica."
        ),
        correcao=(
            "Primeiro, verificar em producao: SELECT relname, reloptions FROM pg_class WHERE relname = "
            "'vw_relatorio_leads'. Em seguida versionar a view numa migration com "
            "WITH (security_invoker = true) e um GRANT explicito, e mover o export para o backend, "
            "atras de authMiddleware + verificacao de papel + filtro por aces_id (o padrao de "
            "/api/collections/imports em api-server.ts:1114-1128). Remover a condicao acesId === 535 do frontend, "
            "que e regra de negocio hardcoded e nao controle de acesso."
        ),
        aceite=[
            "vw_relatorio_leads definida em supabase/migrations/ com security_invoker = true.",
            "Consulta a vw_relatorio_leads com JWT de um tenant retorna apenas linhas daquele aces_id.",
            "Export passa por endpoint do backend com verificacao de papel; nenhuma chamada direta do frontend a view.",
            "A constante 535 nao aparece mais como criterio de acesso no frontend.",
        ],
        condicao="Explorabilidade depende da configuracao real da view em producao (security_invoker e GRANT), nao verificavel a partir do repositorio.",
    ),
    dict(
        id="F09",
        titulo="Segredo default publico no docker-compose e ausencia de validacao de startup",
        severidade="media",
        categoria="4. Chaves expostas",
        arquivos=["docker-compose.yml:25",
                  "Project/IA/api-server.ts:274-280",
                  ".env.local.example:57-58"],
        codigo=(
            '# docker-compose.yml:25\n'
            '- RB_WEBHOOK_JWT_SECRET=${RB_WEBHOOK_JWT_SECRET:-local-only-rb-webhook-secret}\n'
            '\n'
            '// api-server.ts:274 — requireEnv so checa presenca, nao qualidade\n'
            'function requireEnv(name: string) {\n'
            '  const value = process.env[name];\n'
            '  if (!value) {\n'
            '    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);\n'
            '  }\n'
            '  return value;\n'
            '}'
        ),
        porque=(
            "O valor 'local-only-rb-webhook-secret' esta versionado e vira segredo real de assinatura sempre que "
            "RB_WEBHOOK_JWT_SECRET nao for exportado no shell que sobe o compose. Esse segredo assina os JWT HS256 "
            "de webhook do RB (rb-connection-service.ts:162-183), portanto quem conhece o default forja tokens "
            "offline para qualquer connection_id/aces_id, sem nem precisar do /webhook/login. Nao existe "
            "validacao de startup que rejeite valores default ou de baixa entropia: requireEnv apenas verifica se "
            "a string e nao vazia. Os placeholders 'local-dev-verify-token' e 'local-dev-app-secret' de "
            ".env.local.example:57-58 tem o mesmo problema de classe. Nota positiva: o stack de producao "
            "(docker-stack.backend.yml) usa ${VAR} puro, sem default, em todos os 18 segredos."
        ),
        impacto=(
            "Falsificacao completa dos tokens de webhook do RB em qualquer ambiente que herde o default, "
            "combinando com F01 para acesso cross-tenant as operacoes de visagismo. Em compose de dev/homolog "
            "com dados reais, o impacto e o mesmo de producao."
        ),
        correcao=(
            "Remover o default do compose (usar ${RB_WEBHOOK_JWT_SECRET:?RB_WEBHOOK_JWT_SECRET obrigatorio}, "
            "que faz o compose falhar cedo) e adicionar validacao de startup no backend: uma funcao "
            "requireStrongSecret(name) que rejeite valores de uma denylist de defaults conhecidos e exija "
            "comprimento minimo (>= 32 bytes) quando NODE_ENV=production. Rotacionar o segredo em todos os "
            "ambientes que possam ter subido com o default."
        ),
        aceite=[
            "Nenhum ${VAR:-valor} com valor de segredo nos arquivos compose/stack (apenas flags e nomes de modelo).",
            "Backend aborta o startup em producao se algum segredo for default conhecido ou tiver menos de 32 bytes.",
            "Teste unitario da validacao de startup cobrindo default conhecido, segredo curto e segredo valido.",
            "RB_WEBHOOK_JWT_SECRET rotacionado em todos os ambientes.",
        ],
        condicao="Explorável apenas em ambientes que subiram sem exportar a variavel. O stack de producao nao tem defaults.",
    ),
    dict(
        id="F10",
        titulo="Segredos de terceiros commitados no historico do Git",
        severidade="media",
        categoria="4. Chaves expostas",
        arquivos=["referencias/Cobranca API/Curl.txt (commit 02333eb e seguintes)",
                  "referencias/eMetizaun/CONFIGURACAO_SUPABASE.md (commit 02333eb e seguintes)"],
        codigo=(
            '# git show 02333eb:"referencias/Cobranca API/Curl.txt"\n'
            '#   -> Bearer JWT da API RB. Payload decodificado:\n'
            '#      {"iss":"<id do emissor redigido>", "exp":"2026-07-08T14:42:19", ...,\n'
            '#       "secrets":"eyJzZWNyZXRzIjoi..."}\n'
            '\n'
            '# git show 02333eb:referencias/eMetizaun/CONFIGURACAO_SUPABASE.md\n'
            '#   -> chave Supabase de OUTRO projeto. Payload decodificado:\n'
            '#      {"iss":"supabase","ref":"hkqrgomafbohittsdnea","role":"anon",...}'
        ),
        porque=(
            "Os arquivos foram removidos do HEAD (nao aparecem em 'git ls-tree -r HEAD'), mas continuam "
            "recuperaveis em qualquer clone via 'git show <commit>:<path>'. Verificado que nenhum outro arquivo "
            "versionado contem segredo (varredura por AIzaSy*, sk-*, JWT HS256 e blocos PRIVATE KEY em todo o "
            "'git ls-files' voltou vazia) e que todos os .env* estao corretamente ignorados. Os dois valores sao "
            "de risco baixo em si — o JWT do RB tem exp em 2026-07-08 (expirado) e a chave Supabase e uma anon "
            "key (publica por design) de um projeto de terceiro. O problema real e de processo: segredos "
            "chegaram ao historico e nao houve rotacao nem limpeza."
        ),
        impacto=(
            "Direto: baixo — token RB expirado e anon key publica de outro projeto. Indireto: o campo "
            "'secrets' embutido no JWT do RB pode conter material reutilizavel, e o padrao demonstra ausencia de "
            "barreira de commit para segredos. O mesmo caminho poderia ter levado uma service_role ao historico."
        ),
        correcao=(
            "Confirmar com o parceiro RB que o token esta revogado (nao apenas expirado). Adotar varredura de "
            "segredos no pre-commit e na CI (gitleaks ou equivalente). Avaliar a limpeza do historico com "
            "git filter-repo para os dois caminhos, coordenando o rewrite com quem tem clones. Manter a regra de "
            "nunca versionar diretorios de referencia com material de integracao."
        ),
        aceite=[
            "Token RB confirmado como revogado pelo parceiro.",
            "Varredura de segredos rodando no pre-commit e na CI, com falha bloqueante.",
            "Decisao registrada sobre limpeza do historico (executada ou aceita como risco, com justificativa).",
            "gitleaks detect no repositorio nao retorna achados novos.",
        ],
        condicao="Requer acesso de leitura ao repositorio (clone). Ambos os valores tem impacto direto limitado.",
    ),
    dict(
        id="F11",
        titulo="XSS refletido no challenge de verificacao dos webhooks Meta e Instagram",
        severidade="baixa",
        categoria="5. Inputs sem tratamento (XSS)",
        arquivos=["Project/IA/api-server.ts:757-767",
                  "Project/IA/api-server.ts:784-806",
                  "Project/IA/meta-webhook.ts:44-54"],
        codigo=(
            '// api-server.ts:757\n'
            'app.get("/api/webhook/meta", (req, res) => {\n'
            '  const challenge = metaWebhookProcessor.verifyChallenge(req.query as Record<string, unknown>);\n'
            '  if (!challenge) { res.status(403).send("Forbidden"); return; }\n'
            '  res.status(200).send(challenge);      // Express: string -> text/html\n'
            '});\n'
            '\n'
            '// api-server.ts:805 — mesmo padrao com hub.challenge cru\n'
            'res.status(200).send(challenge);'
        ),
        porque=(
            "Confirmado empiricamente com o Express 5.2.1 instalado no projeto: res.send(string) define "
            "Content-Type: text/html; charset=utf-8. O valor de hub.challenge vem direto da query string e e "
            "devolvido sem escape, sem Content-Type explicito e sem X-Content-Type-Options. "
            "GET /api/webhook/instagram?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<script>... "
            "executa script na origem do backend. A exploracao depende de conhecer META_WEBHOOK_VERIFY_TOKEN ou "
            "INSTAGRAM_WEBHOOK_VERIFY_TOKEN — valores que .env.local.example:57 sugere como "
            "'local-dev-verify-token', do tipo que costuma sobreviver a homologacao."
        ),
        impacto=(
            "Execucao de script na origem do backend. Como o frontend guarda a sessao em localStorage de outra "
            "origem, nao ha roubo direto de token; o impacto pratico e phishing convincente hospedado no dominio "
            "da API e abuso de qualquer coisa ligada a essa origem."
        ),
        correcao=(
            "Responder com Content-Type explicito e nao-HTML: res.type('text/plain').send(challenge), ou "
            "res.set('Content-Type','text/plain; charset=utf-8'). Validar que challenge casa com /^[A-Za-z0-9_-]{1,256}$/ "
            "antes de refletir e adicionar X-Content-Type-Options: nosniff (o endpoint de midia do Instagram "
            "em api-server.ts:815 ja faz isso e serve de referencia)."
        ),
        aceite=[
            "Resposta dos dois endpoints GET de verificacao usa Content-Type text/plain.",
            "challenge validado por allowlist de caracteres antes de ser refletido.",
            "Header X-Content-Type-Options: nosniff presente nas respostas.",
            "Teste de rota confirmando que payload com < > nao e devolvido como HTML.",
        ],
        condicao="Requer conhecer o verify token do webhook (segredo compartilhado com a Meta).",
    ),
    dict(
        id="F12",
        titulo="Open redirect por URL protocolo-relativa no returnPath do OAuth do Instagram",
        severidade="baixa",
        categoria="5. Inputs sem tratamento (XSS)",
        arquivos=["Project/IA/instagram-service.ts:89-92",
                  "Project/IA/instagram-service.ts:151-156",
                  "Project/IA/api-server.ts:3822-3852"],
        codigo=(
            '// instagram-service.ts:89\n'
            'function sanitizeReturnPath(value: string | null | undefined) {\n'
            '  const normalized = value?.trim() || "/admin?section=instances";\n'
            '  return /^\\/[A-Za-z0-9\\/_?&=.%-]*$/.test(normalized) ? normalized : "/admin?section=instances";\n'
            '}\n'
            '\n'
            '// "//evil.com" passa no regex (comeca com / e usa apenas caracteres permitidos)\n'
            '// instagram-service.ts:153\n'
            'const url = new URL(sanitizeReturnPath(returnPath), `${base}/`);\n'
            '// new URL("//evil.com", "https://crm.example.com/") === "https://evil.com/"'
        ),
        porque=(
            "Verificado em Node: a string '//evil.com' satisfaz o regex de sanitizacao (inicia com '/' e todos os "
            "caracteres seguintes estao na classe permitida) e, resolvida com new URL contra a base, produz uma "
            "URL de outra origem, porque '//' e interpretado como URL protocolo-relativa. O valor sai de "
            "beginOAuth (req.body.returnPath, api-server.ts:3810), e persistido no state assinado e usado no "
            "res.redirect(303, ...) do callback."
        ),
        impacto=(
            "Redirecionamento para dominio externo a partir de uma URL do backend confiavel. O returnPath vem do "
            "proprio usuario autenticado que inicia o fluxo, entao o cenario principal e auto-redirecionamento; "
            "o valor real esta em usar o dominio da API como trampolim em phishing e em burlar filtros que "
            "confiam no dominio de origem."
        ),
        correcao=(
            "Rejeitar caminhos que comecem com '//' (ou com '/\\\\'): exigir "
            "/^\\/(?!\\/)[A-Za-z0-9\\/_?&=.%-]*$/ e, como defesa em profundidade, validar depois do new URL que "
            "url.origin === new URL(base).origin, caindo no default quando divergir."
        ),
        aceite=[
            "sanitizeReturnPath devolve o default para '//evil.com', '///evil.com' e '/\\\\evil.com'.",
            "buildFrontendRedirect confirma que a origem final e a do frontend configurado.",
            "Teste unitario com os vetores acima.",
        ],
        condicao="Requer que o proprio usuario inicie o fluxo OAuth com o returnPath manipulado.",
    ),
    dict(
        id="F13",
        titulo="Erros crus do banco devolvidos ao cliente no campo details",
        severidade="baixa",
        categoria="Extra (defesa em profundidade)",
        arquivos=["Project/IA/api-server.ts:4315-4321",
                  "Project/IA/sdr-agent-gemini.ts:1122-1131",
                  "Project/IA/api-server.ts:2093 (e outras 18 ocorrencias do padrao)"],
        codigo=(
            '// api-server.ts:4315 — handler global devolve details verbatim\n'
            'app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {\n'
            '  if (error instanceof HttpError) {\n'
            '    return res.status(error.statusCode).json({\n'
            '      error: error.message,\n'
            '      details: error.details ?? null,      // <-- objeto de erro do PostgREST\n'
            '    });\n'
            '  }\n'
            '\n'
            '// padrao dos call sites (19 ocorrencias):\n'
            '// throw new HttpError(500, "Nao foi possivel carregar usuarios", error);'
        ),
        porque=(
            "HttpError guarda o terceiro argumento em details (sdr-agent-gemini.ts:1122-1131) e o handler global "
            "serializa esse campo na resposta. Em 19 pontos de api-server.ts o objeto passado e o erro cru do "
            "supabase-js/PostgREST, que carrega message, details, hint e code — muitas vezes com nome de tabela, "
            "coluna, constraint e fragmento de SQL."
        ),
        impacto=(
            "Divulgacao de informacao: mapeamento do schema interno (tabelas, colunas, constraints, funcoes) para "
            "qualquer usuario autenticado, o que facilita a fase de reconhecimento de outros ataques. Sem impacto "
            "direto de integridade ou confidencialidade de dados."
        ),
        correcao=(
            "Registrar o erro completo no log do servidor e responder apenas com a mensagem tratada mais um "
            "requestId de correlacao. Se detalhes forem uteis ao cliente, expor uma lista fechada de campos "
            "seguros (por exemplo, apenas code mapeado para mensagem amigavel) e nunca o objeto cru — em "
            "producao, omitir details por completo."
        ),
        aceite=[
            "Respostas de erro em producao nao contem message/details/hint do PostgREST.",
            "Erro completo permanece no log do servidor, correlacionado por requestId devolvido ao cliente.",
            "Nenhum call site passa objeto de erro cru para o construtor de HttpError sem sanitizacao.",
        ],
        condicao="Requer sessao autenticada capaz de provocar erro em alguma rota.",
    ),
    dict(
        id="F14",
        titulo="Limite default de corpo JSON em 150 MB",
        severidade="baixa",
        categoria="Extra (defesa em profundidade)",
        arquivos=["Project/IA/api-server.ts:568-580"],
        codigo=(
            'app.use(\n'
            '  express.json({\n'
            '    limit:\n'
            '      process.env.JSON_BODY_LIMIT ?? process.env.WEBHOOK_JSON_LIMIT ?? "150mb",\n'
            '    verify: (req, _res, buf) => { ... },\n'
            '  }),\n'
            ');'
        ),
        porque=(
            "O parser global aceita ate 150 MB por requisicao quando nenhuma das duas variaveis esta definida. "
            "Esse limite vale para todas as rotas montadas depois, inclusive os webhooks nao autenticados "
            "(/webhook/evolution, /api/webhook/gupshup). Cada corpo e materializado em memoria antes de qualquer "
            "verificacao de credencial. Rotas especificas fazem melhor: o webhook de collections usa "
            "express.raw({ limit: '1mb' }) (api-server.ts:553-557) e /webhook/image tem guarda de 15 MB "
            "(api-server.ts:559-567)."
        ),
        impacto=(
            "Exaustao de memoria/CPU com poucas requisicoes concorrentes, levando a indisponibilidade do backend. "
            "Nao ha impacto de confidencialidade."
        ),
        correcao=(
            "Reduzir o default global para algo na ordem de 1-2 MB e elevar o limite apenas nas rotas que "
            "comprovadamente precisam de payload grande, montando um express.json dedicado por rota, como ja e "
            "feito em /webhook/image."
        ),
        aceite=[
            "Default global do express.json em <= 2mb.",
            "Rotas que precisam de payload maior tem parser dedicado com limite documentado.",
            "Teste confirmando 413 para corpo acima do limite global em rota comum.",
        ],
        condicao="Nenhuma; alcancavel nas rotas de webhook sem autenticacao.",
    ),
    dict(
        id="F15",
        titulo="Comparacao de segredos de webhook fora de tempo constante",
        severidade="baixa",
        categoria="Extra (defesa em profundidade)",
        arquivos=["Project/IA/sdr-agent-gemini.ts:15834",
                  "Project/IA/api-server.ts:705-709"],
        codigo=(
            '// sdr-agent-gemini.ts:15834 (Evolution)\n'
            'return provided === this.config.evolutionWebhookSecret;\n'
            '\n'
            '// api-server.ts:706 (Gupshup) — tambem aceita o segredo pela query string\n'
            'const providedSecret =\n'
            '  req.header("x-gupshup-secret") || req.header("x-webhook-secret") ||\n'
            '  asString(req.query.secret);\n'
            'if (configuredSecret && providedSecret !== configuredSecret) { throw new HttpError(401, ...); }'
        ),
        porque=(
            "Os dois handlers comparam segredos com === , que faz curto-circuito no primeiro byte diferente. "
            "Os webhooks Meta, Instagram e collections fazem o correto, com crypto.timingSafeEqual "
            "(meta-webhook.ts:67-70, instagram-webhook.ts:119, collections/webhook-security.ts:51). "
            "Agravante no Gupshup: o segredo pode vir em req.query.secret, e query strings vazam para access "
            "logs, referrers e historico de proxy."
        ),
        impacto=(
            "Canal lateral de tempo teoricamente explorável para recuperar o segredo byte a byte; na pratica, "
            "ruidoso sobre rede. O vazamento do segredo por query string em logs e o risco mais concreto."
        ),
        correcao=(
            "Comparar com crypto.timingSafeEqual sobre buffers, checando o tamanho antes. Remover "
            "req.query.secret como fonte aceita, mantendo apenas headers."
        ),
        aceite=[
            "Comparacao de segredo de webhook usa timingSafeEqual em todos os handlers.",
            "Segredo da Gupshup aceito somente por header.",
            "Teste unitario cobrindo segredo correto, incorreto e de tamanho diferente.",
        ],
        condicao="Nenhuma para o vazamento em log; o ataque de tempo exige muitas amostras.",
    ),
    dict(
        id="F16",
        titulo="Sessao Supabase persistida em localStorage",
        severidade="baixa",
        categoria="5. Inputs sem tratamento (XSS)",
        arquivos=["src/integrations/supabase/client.ts:15-24"],
        codigo=(
            'export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {\n'
            '  db: { schema: \'crm\' },\n'
            '  auth: {\n'
            '    storage: localStorage,        // access + refresh token legiveis por JS\n'
            '    persistSession: true,\n'
            '    autoRefreshToken: true,\n'
            '  }\n'
            '});'
        ),
        porque=(
            "Access token e refresh token ficam em localStorage, acessiveis a qualquer script da origem. A "
            "auditoria nao encontrou nenhum sink de XSS explorável no frontend (nao existe innerHTML, eval nem "
            "new Function em src/, e os dois dangerouslySetInnerHTML sao CSS estatico), portanto isto e "
            "amplificacao de risco, nao vulnerabilidade ativa. Registrado porque o projeto nao tem biblioteca de "
            "sanitizacao instalada, o que aumenta a chance de um sink aparecer em codigo futuro."
        ),
        impacto=(
            "Se um XSS surgir no frontend, o atacante extrai o refresh token e mantem acesso persistente a conta "
            "mesmo depois do fechamento da aba, com o tenant e o papel da vitima."
        ),
        correcao=(
            "Ao menos adicionar Content-Security-Policy restritiva no index.html/headers da Vercel para reduzir a "
            "superficie, e incluir DOMPurify como dependencia obrigatoria antes de qualquer futura renderizacao "
            "de HTML. Migrar para armazenamento em cookie httpOnly exige um proxy de autenticacao no backend e "
            "deve ser avaliado como trabalho maior."
        ),
        aceite=[
            "CSP restritiva publicada para o frontend (sem unsafe-inline em script-src).",
            "Decisao registrada sobre manter localStorage ou migrar para cookie httpOnly.",
            "Regra de lint bloqueando novos dangerouslySetInnerHTML sem sanitizacao.",
        ],
        condicao="Sem impacto isolado; depende de um XSS futuro no frontend.",
    ),
    dict(
        id="F17",
        titulo="Claims de papel e tenant no JWT ficam obsoletas ate a renovacao do token",
        severidade="baixa",
        categoria="1. Banco sem tranca (isolamento de tenant)",
        arquivos=["supabase/migrations/20260411161000_move_crm_context_to_jwt.sql:3-51",
                  "src/contexts/AuthContext.tsx:76-92",
                  "Project/IA/sdr-agent-gemini.ts:2647-2679"],
        codigo=(
            '-- 20260411161000:43 — RLS le o papel do app_metadata do JWT\n'
            'CREATE OR REPLACE FUNCTION public.current_crm_role()\n'
            'RETURNS crm.user_role LANGUAGE sql STABLE SECURITY DEFINER\n'
            'AS $$ SELECT NULLIF(auth.jwt() -> \'app_metadata\' ->> \'crm_role\', \'\')::crm.user_role; $$;\n'
            '\n'
            '-- o trigger sync_aces_id_to_jwt atualiza auth.users.raw_app_meta_data,\n'
            '-- porem o JWT ja emitido continua valido com o papel antigo'
        ),
        porque=(
            "A RLS decide papel e tenant a partir das claims do JWT, gravadas em app_metadata pelo trigger "
            "sync_aces_id_to_jwt. app_metadata nao e editavel pelo usuario (so pelo service_role), portanto "
            "nao ha spoofing — esse ponto esta correto. O efeito colateral e temporal: rebaixar um usuario de "
            "ADMIN para VENDEDOR via PATCH /api/admin/users/:id/role atualiza a tabela e o app_metadata, mas o "
            "access token em uso continua carregando crm_role = ADMIN ate expirar (1h por default no Supabase). "
            "Durante essa janela, escritas diretas do frontend pela chave anon ainda passam pelas policies de "
            "ADMIN. O backend nao sofre disso porque authenticate() (sdr-agent-gemini.ts:2647) le o papel ao vivo "
            "de crm.users. AuthContext.tsx:76-92 detecta a divergencia e chama refreshSession(), o que mitiga o "
            "caso comum, mas e logica de cliente e pode ser evitada."
        ),
        impacto=(
            "Janela de privilegio residual de ate uma expiracao de token depois de um rebaixamento de papel ou "
            "troca de tenant, aplicavel somente as escritas que o frontend faz direto no Postgres "
            "(automation_*, pipelines, pipeline_stages, empresas, calendar.*)."
        ),
        correcao=(
            "Nas policies mais sensiveis, resolver o papel na tabela em vez da claim (por exemplo, uma funcao "
            "SECURITY DEFINER que faca SELECT role FROM crm.users WHERE auth_user_id = auth.uid()), aceitando o "
            "custo de um lookup. Alternativamente, invalidar as sessoes do usuario no servidor ao alterar papel "
            "(auth.admin.signOut do usuario) e reduzir o tempo de vida do access token."
        ),
        aceite=[
            "Rebaixar um usuario de ADMIN para VENDEDOR revoga imediatamente as escritas admin feitas direto pelo frontend.",
            "Teste de integracao: alterar papel e, sem renovar o token, confirmar que a escrita admin e negada.",
            "Decisao documentada entre lookup na tabela e invalidacao de sessao.",
        ],
        condicao="Janela limitada ao tempo de vida do access token e parcialmente mitigada pelo refresh automatico do AuthContext.",
    ),
    dict(
        id="F18",
        titulo="Sink de CSS via dangerouslySetInnerHTML em componente de chart (latente)",
        severidade="info",
        categoria="5. Inputs sem tratamento (XSS)",
        arquivos=["src/components/ui/chart.tsx:61-88",
                  "src/components/ui/material-ui-dropdown-menu.tsx:193-215"],
        codigo=(
            '// chart.tsx:70 — id e cores entram num <style> sem escape\n'
            '<style\n'
            '  dangerouslySetInnerHTML={{\n'
            '    __html: Object.entries(THEMES).map(([theme, prefix]) => `\n'
            '${prefix} [data-chart=${id}] {\n'
            '${colorConfig.map(([key, itemConfig]) => {\n'
            '  const color = itemConfig.theme?.[theme] || itemConfig.color;\n'
            '  return color ? `  --color-${key}: ${color};` : null;\n'
            '}).join("\\n")}\n'
            '}`).join("\\n"),\n'
            '  }}\n'
            '/>'
        ),
        porque=(
            "Sao os dois unicos usos de dangerouslySetInnerHTML no projeto. O de material-ui-dropdown-menu.tsx:198 "
            "e CSS 100% estatico, sem interpolacao — sem risco. O de chart.tsx:70 interpola id e cores num bloco "
            "<style>, mas hoje id vem de React.useId() (chart.tsx:40-41) e as cores vem de ChartConfig definido "
            "em codigo; confirmado que ChartContainer nao e usado em nenhum lugar fora de chart.tsx, ou seja, e "
            "boilerplate do shadcn/ui atualmente morto. Registrado como informativo porque viraria injecao de CSS "
            "no momento em que alguem alimentar o config com dado de banco (por exemplo, cor de etapa ou de tag "
            "escolhida pelo usuario)."
        ),
        impacto=(
            "Nenhum hoje. Se alimentado por dado do usuario, permitiria injecao de CSS (exfiltracao por seletor de "
            "atributo, defacement); nao permite execucao de script em navegadores atuais dentro de <style>."
        ),
        correcao=(
            "Se o componente voltar a ser usado, validar as cores por allowlist (por exemplo "
            "/^#[0-9a-fA-F]{3,8}$/ ou nomes de token conhecidos) e as chaves por /^[a-zA-Z0-9_-]+$/ antes da "
            "interpolacao. Caso siga sem uso, remover chart.tsx reduz a superficie."
        ),
        aceite=[
            "Componente removido, ou cores/chaves validadas por allowlist antes da interpolacao.",
            "Regra de lint impedindo novos dangerouslySetInnerHTML sem sanitizacao explicita.",
        ],
        condicao="Nao explorável no estado atual do codigo: o componente nao e instanciado em nenhuma pagina.",
    ),
]

# ---------------------------------------------------------------------------
# Pontos fortes verificados
# ---------------------------------------------------------------------------

PONTOS_FORTES = [
    dict(
        titulo="Cobertura integral de guardas de posse na camada de servico do backend",
        evidencia=(
            "Os 53 metodos publicos de AgentManager que recebem AuthContext foram enumerados e todos "
            "aplicam pelo menos uma guarda: ensureAdmin (sdr-agent-gemini.ts:2682), getAgentForAccount (3400), "
            "loadLeadById (7847), ensureInstanceOwnership (3317) ou getAccessibleInstanceNames (3342). "
            "Nenhum metodo ficou sem guarda. Exemplos: getStageRules (6198), listRuns (6310), resumeLead (6336), "
            "sendManualMessage (14956), deleteInstance (7014)."
        ),
    ),
    dict(
        titulo="Guardas de posse compostas: tenant + instancia + dono do lead",
        evidencia=(
            "loadLeadById (sdr-agent-gemini.ts:7847-7873) filtra por .eq('aces_id', acesId) e so entao chama "
            "canAccessLead. getAgentForAccount (3400-3435) filtra por aces_id e valida created_by ou "
            "hasActiveInstanceAccessMembership. ensureInstanceOwnership (3317-3340) confere aces_id da instancia "
            "e a associacao ativa do usuario. O modelo nao para no tenant: desce a instancia e ao dono do registro."
        ),
    ),
    dict(
        titulo="FKs compostas (id, aces_id) impedem referencia cross-tenant no schema collections",
        evidencia=(
            "20260903205231_collections_core_v1.sql declara constraints como "
            "agent_source_bindings_tool_tenant_fkey FOREIGN KEY (agent_tool_id, aces_id) REFERENCES "
            "agents.agent_tools(id, aces_id) (linhas 115-120), journey_rules_funnel_tenant_fkey (322-325), "
            "mapping_profiles_connection_tenant_fkey (368-371) e spreadsheet_imports_connection_tenant_fkey "
            "(404-407). Isso torna a violacao de tenant impossivel no banco, nao apenas improvavel no codigo — "
            "e foi o que neutralizou o risco de leitura em F06."
        ),
    ),
    dict(
        titulo="Schema collections fechado para a chave anon e com RLS por padrao",
        evidencia=(
            "20260903205231_collections_core_v1.sql:492-513 percorre as 14 tabelas do schema executando "
            "ENABLE ROW LEVEL SECURITY, REVOKE ALL ... FROM PUBLIC, anon, authenticated e concedendo apenas ao "
            "service_role. As 24 rotas /api/collections/* passam todas por requireCollectionAdmin "
            "(api-server.ts:1022-1028) e propagam context.acesId em cada consulta e RPC."
        ),
    ),
    dict(
        titulo="Webhook de ingestao de cobranca com autenticacao completa",
        evidencia=(
            "collections/webhook-security.ts:28-55 valida HMAC-SHA256 sobre timestamp + '.' + corpo cru, exige "
            "timestamp na janela de tolerancia (anti-replay) e compara com timingSafeEqual, aceitando segredo "
            "atual e anterior para rotacao sem downtime. collection-api.ts:54-142 soma rate limit por IP via RPC "
            "consume_webhook_rate_limit, Idempotency-Key obrigatorio, express.raw com limite de 1 MB e mensagens "
            "de erro genericas que nao distinguem fonte inexistente de assinatura invalida."
        ),
    ),
    dict(
        titulo="Webhooks Meta e Instagram falham fechados, com comparacao em tempo constante",
        evidencia=(
            "meta-webhook.ts:56-70 e instagram-webhook.ts:110-120 retornam false quando appSecret esta ausente e "
            "usam crypto.timingSafeEqual apos checagem de tamanho. Os handlers em api-server.ts:657-670 e 769-782 "
            "lancam 401 antes de qualquer processamento. Este e o comportamento correto que F02 nao replica."
        ),
    ),
    dict(
        titulo="Entrega de midia do Instagram por token de capacidade assinado",
        evidencia=(
            "instagram-service.ts:158-171 gera um token HMAC-SHA256 sobre {acesId, attachmentId, expiresAt}; "
            "downloadMediaDelivery (173-213) valida a assinatura com timingSafeEqual, rejeita expirados e TTL "
            "inflado, e busca o intent com .eq('aces_id', acesId).eq('attachment_id', attachmentId). O MIME e "
            "restrito por allowlist na ingestao (instagram-workers.ts:85) e a resposta traz "
            "X-Content-Type-Options: nosniff (api-server.ts:815) — por isso o endpoint publico da linha 807 nao "
            "virou achado."
        ),
    ),
    dict(
        titulo="Chat interno com client escopado por RLS mais checagem explicita de participacao",
        evidencia=(
            "internal-chat-service.ts:105-111 cria client com a chave anon e o JWT do usuario, de modo que a RLS "
            "se aplica; assertMember (113-121) confirma participacao ativa antes de listMessages (287) e "
            "createAttachmentUploadUrl (530); o envio passa pelo RPC rpc_send_internal_message. Intents de anexo "
            "sao validados por .eq('aces_id').eq('created_by') e conferencia de existencia e tamanho real do "
            "objeto no Storage (443-511)."
        ),
    ),
    dict(
        titulo="RLS com escrita restrita a ADMIN nas tabelas de configuracao",
        evidencia=(
            "crm.pipelines (20260706231251:27-65), crm.pipeline_stages (20260410100000:962-988), "
            "crm.automation_funnels/steps/executions (20260411190000:84-200), crm.empresas "
            "(20260724202355:251-280) e as 7 tabelas do schema calendar (20260724202355:844-899) exigem "
            "current_crm_role() = 'ADMIN' ou crm.current_user_is_account_admin() em INSERT/UPDATE/DELETE. "
            "E o que sustenta no servidor os gates isAdmin de KanbanColumn.tsx:117, PipelineToolbar.tsx:106 e "
            "Dashboard.tsx:109."
        ),
    ),
    dict(
        titulo="Claims de tenant e papel em app_metadata, nao editaveis pelo usuario",
        evidencia=(
            "20260411161000_move_crm_context_to_jwt.sql:23-51 define current_crm_user_id, current_aces_id e "
            "current_crm_role lendo auth.jwt() -> 'app_metadata'. app_metadata so e gravavel pelo service_role "
            "(trigger sync_aces_id_to_jwt, linhas 3-21) — diferente de user_metadata, que o proprio usuario "
            "poderia alterar via auth.updateUser e que resultaria em auto-promocao a ADMIN. A escolha esta certa."
        ),
    ),
    dict(
        titulo="RLS de leads desce ao nivel de instancia e de dono do registro",
        evidencia=(
            "20260716195449_harden_tenant_instance_rls.sql:353-381 substitui a comparacao simples de aces_id por "
            "crm.current_user_can_access_lead(id) no SELECT, crm.current_user_can_edit_lead(id) no UPDATE/DELETE "
            "e, no INSERT, exige aces_id + current_user_can_access_instance(instancia,'editor') + "
            "crm_user_belongs_to_current_account(owner_id). crm.message_history (386-393) herda o mesmo modelo."
        ),
    ),
    dict(
        titulo="Views expostas ao frontend com security_invoker habilitado",
        evidencia=(
            "crm.v_lead_details recebe ALTER VIEW ... SET (security_invoker = true) apos cada redefinicao "
            "(20260425110000:229, 20260618205533:55, 20260708211239:133, 20260724202355:593, "
            "20260827145250:151), de modo que a RLS de crm.leads continua valendo atraves da view. As views de "
            "costs (20260716195449:362) e de superadmin (20260814001041:442, 479, 501) usam "
            "WITH (security_invoker = true) na criacao. A excecao e vw_relatorio_leads, que nao esta versionada "
            "(F08)."
        ),
    ),
    dict(
        titulo="Rotas de superadmin isoladas por RPC de staff e prefixo de RPC restrito",
        evidencia=(
            "As 21 rotas /api/admin/(overview|accounts|plans|revenue-entries|fixed-costs|exchange-rates) usam "
            "authMiddleware + requireStaff (api-server.ts:864-871), que consulta o RPC service_admin_is_staff "
            "(sdr-agent-gemini.ts:10353-10359). adminRpc (10361-10368) recusa qualquer nome de funcao que nao "
            "comece com 'service_admin_', bloqueando execucao arbitraria de RPC mesmo se o nome vazasse para o "
            "corpo da requisicao."
        ),
    ),
    dict(
        titulo="Edge Functions com verify_jwt=false compensam com verificacao interna",
        evidencia=(
            "buscar-leads e import-leads-csv estao com verify_jwt = false em supabase/config.toml:62 e 68, mas "
            "ambas exigem o header Authorization, resolvem o usuario com userClient.auth.getUser() usando a chave "
            "anon, carregam crm.users e escopam todas as consultas por crmUser.aces_id "
            "(buscar-leads/index.ts:242-276, 342-350, 463-473; import-leads-csv/index.ts:56-91, 205-244, 275-308). "
            "Esse e exatamente o padrao ausente em send-user-invitation (F03)."
        ),
    ),
    dict(
        titulo="Gestao de segredos: nada versionado, sem defaults em producao, bundle limpo",
        evidencia=(
            "docker-stack.backend.yml usa ${VAR} puro nos 18 segredos (linhas 6-9, 28, 33-40, 47-51, 70-72), sem "
            "nenhum default. Todos os .env* (.env.local, .env.vps.local, .env.cloudflare, .env.vercel, "
            "Project/IA/.env.local, DEPLOY_ENV_VPS.local.md) confirmados como ignorados por git check-ignore. "
            "A varredura de todo o 'git ls-files' por AIzaSy*, sk-*, JWT HS256 e blocos PRIVATE KEY voltou vazia, "
            "e dist/assets/*.js nao contem service_role nem chave de API. scripts/set-backend-secret.ps1 le o "
            "segredo por Read-Host -AsSecureString e nunca o imprime."
        ),
    ),
    dict(
        titulo="URLs de anexo sempre assinadas pelo servidor, sem esquema controlado pelo usuario",
        evidencia=(
            "src/components/chat/MessageAttachment.tsx:205 e 240 usam href={attachment.url}, e esse valor vem "
            "sempre de createSignedDownloadUrl (sdr-agent-gemini.ts:7456-7466), chamado nos 5 pontos que montam "
            "anexos (9422, 9797, 14315, 14850, 15675). O resultado e sempre uma URL https do Supabase Storage, "
            "logo nao existe caminho para javascript: em href."
        ),
    ),
    dict(
        titulo="Frontend sem os sinks classicos de XSS",
        evidencia=(
            "Varredura em todo o src/ nao encontrou innerHTML, outerHTML, insertAdjacentHTML, eval nem "
            "new Function. Nao ha renderizador de markdown/HTML no package.json. Os unicos dois "
            "dangerouslySetInnerHTML sao blocos <style> (F18), sendo um deles CSS estatico. Conteudo de lead, "
            "mensagem e nota e renderizado como texto em JSX, com escape automatico do React."
        ),
    ),
    dict(
        titulo="CORS do backend por allowlist estrita",
        evidencia=(
            "api-server.ts:583-595 monta a allowlist de CORS_ORIGINS e so envia "
            "Access-Control-Allow-Origin quando a origem consta da lista, acrescentando Vary: Origin. Nao ha "
            "reflexao incondicional de origem nem curinga com credenciais."
        ),
    ),
    dict(
        titulo="Isolamento de tenant nas rotas administrativas de conta",
        evidencia=(
            "As rotas de gestao de usuarios, acessos e empresas verificam papel e escopo em toda consulta: "
            "/api/admin/users (2063-2085), /api/admin/users/:id/role (2087-2160, com .eq('id').eq('aces_id') e "
            "revogacao em cascata de instance_access_memberships e empresa_memberships), "
            "/api/admin/instance-access (2163-2277, validando instancia e vendedor na conta antes do upsert), "
            "/api/admin/company-access (2570-2670) e /api/admin/companies/:id (2486-2524)."
        ),
    ),
    dict(
        titulo="RPCs de servico validam o tenant dentro da funcao",
        evidencia=(
            "crm.service_move_lead_to_stage (20260411210000:269-316) e SECURITY DEFINER com "
            "SET search_path, confere a etapa com WHERE id = p_stage_id AND aces_id = p_aces_id e levanta "
            "excecao quando nao encontra, repetindo a checagem no UPDATE do lead. As permissoes sao concedidas "
            "somente ao service_role, com REVOKE explicito para authenticated, anon e PUBLIC."
        ),
    ),
]

# ---------------------------------------------------------------------------
# Pontos fracos (riscos centrais)
# ---------------------------------------------------------------------------

PONTOS_FRACOS = [
    dict(
        titulo="A borda de integracao e o elo fraco, nao o nucleo multi-tenant",
        detalhe=(
            "O nucleo do produto — rotas autenticadas, RLS, camada de servico — esta consistente. Os achados de "
            "maior severidade estao todos nas bordas de integracao com parceiros: /webhook/login sem credencial "
            "(F01), webhook da Evolution falhando aberto (F02) e a Edge Function de convite sem autorizacao "
            "(F03). Sao caminhos que nao passam pelo authMiddleware nem pela camada de servico e, por isso, "
            "escaparam do padrao que o resto do sistema segue."
        ),
    ),
    dict(
        titulo="Falha aberta como default em vez de falha fechada",
        detalhe=(
            "Duas verificacoes de credencial tratam 'segredo nao configurado' como 'autorizado': "
            "validateWebhookSecret da Evolution (F02) e, parcialmente, o handler da Gupshup — que ao menos barra "
            "producao. O padrao correto ja existe no proprio repositorio (Meta, Instagram e collections falham "
            "fechados). O risco e de configuracao: um ambiente sem a variavel fica aberto sem qualquer sinal."
        ),
    ),
    dict(
        titulo="Ausencia de validacao de startup para qualidade de segredo",
        detalhe=(
            "requireEnv (api-server.ts:274-280) apenas verifica se a string e nao vazia. Nada impede que "
            "'local-only-rb-webhook-secret' (docker-compose.yml:25), 'local-dev-verify-token' ou "
            "'local-dev-app-secret' (.env.local.example:57-58) cheguem a um ambiente com dados reais. O sistema "
            "sobe normalmente e assina tokens com um segredo publicado no repositorio (F09)."
        ),
    ),
    dict(
        titulo="Client service_role sem RLS torna o filtro manual a unica barreira",
        detalhe=(
            "O backend usa SUPABASE_SERVICE_ROLE_KEY em praticamente todas as consultas, o que anula a RLS. "
            "Onde o filtro por aces_id existe, a protecao e solida; onde falta, o vazamento e imediato — foi "
            "assim em F07 (requireChannel sem acesId) e F06 (upsert por PK). Nao ha lint, wrapper tipado nem "
            "teste que force a presenca do filtro, o que deixa a garantia dependente de revisao humana."
        ),
    ),
    dict(
        titulo="Objetos de banco fora do versionamento",
        detalhe=(
            "vw_relatorio_leads e consultada pelo frontend com a chave anon (src/pages/Leads.tsx:119) e nao "
            "existe em nenhuma das 173 migrations. Sua postura de RLS e portanto nao auditavel a partir do "
            "repositorio, e como views nascem com security_invoker = false o cenario padrao e o inseguro (F08). "
            "O gate de acesso correspondente e um if no navegador."
        ),
    ),
    dict(
        titulo="Credencial de producao em texto puro protegida apenas por glob de .gitignore",
        detalhe=(
            "A senha de root do VPS aparece literalmente em tres scripts (F04). O que evita o commit e a regra "
            "/scripts/*vps*.js do .gitignore — renomear o arquivo, copiar o trecho ou usar git add -f derrama a "
            "credencial no historico. Nao existe hook de pre-commit nem varredura de segredos na CI."
        ),
    ),
]

# ---------------------------------------------------------------------------
# Recomendacoes priorizadas
# ---------------------------------------------------------------------------

RECOMENDACOES = [
    dict(
        prioridade="P1",
        prazo="Imediato (mesma semana)",
        itens=[
            ("Exigir credencial em POST /webhook/login e rotacionar RB_WEBHOOK_JWT_SECRET",
             "F01, F09 — hoje qualquer anonimo emite token valido para qualquer tenant e o segredo pode ser o default publicado."),
            ("Rotacionar a senha de root do VPS e migrar os scripts para autenticacao por chave",
             "F04 — credencial de producao em texto puro; com root vem a service_role e todo o isolamento cai."),
            ("Fazer validateWebhookSecret falhar fechada e abortar o startup sem EVOLUTION_WEBHOOK_SECRET em producao",
             "F02 — injecao anonima de mensagens em qualquer tenant se a variavel estiver ausente."),
            ("Adicionar autorizacao e vinculo convite<->e-mail na Edge Function send-user-invitation",
             "F03 — escalonamento de VENDEDOR para ADMIN reaproveitando um invitationId da propria conta."),
        ],
    ),
    dict(
        prioridade="P2",
        prazo="Curto prazo (2 a 4 semanas)",
        itens=[
            ("Verificar security_invoker de vw_relatorio_leads em producao, versionar a view e mover o export para o backend",
             "F08 — no cenario default de Postgres a view ignora a RLS de crm.leads e vazaria a base de todos os tenants."),
            ("Adicionar verificacao de papel e posse do agente em /api/agents/:id/tools/rb_billing/run-now",
             "F05 — unica rota de tools que nao passa pelo manager; hoje qualquer usuario do tenant dispara cobranca."),
            ("Escopar por aces_id a sincronizacao de templates Meta",
             "F07 — escrita cross-tenant em meta.whatsapp_templates e uso do token da vitima na Graph API."),
            ("Eliminar o upsert por id vindo do cliente nas tres rotas de collections",
             "F06 — permite mover linhas de configuracao de outro tenant para a conta do atacante."),
            ("Introduzir validacao de startup de qualidade de segredo e remover defaults dos arquivos compose",
             "F09 — requireEnv so checa presenca; defaults publicos entram silenciosamente em ambientes reais."),
            ("Ativar varredura de segredos no pre-commit e na CI, e tratar o material do historico",
             "F04, F10 — nao existe barreira automatica; segredos ja chegaram ao historico uma vez."),
        ],
    ),
    dict(
        prioridade="P3",
        prazo="Medio prazo (1 a 2 meses)",
        itens=[
            ("Parar de devolver o objeto de erro do PostgREST e passar a correlacionar por requestId",
             "F13 — 19 call sites expoem tabela, coluna, constraint e fragmento de SQL a qualquer autenticado."),
            ("Refletir hub.challenge como text/plain, com allowlist de caracteres e nosniff",
             "F11 — XSS refletido na origem do backend para quem conhece o verify token."),
            ("Corrigir sanitizeReturnPath para rejeitar '//' e validar a origem final",
             "F12 — open redirect por URL protocolo-relativa."),
            ("Reduzir o limite global de corpo JSON para <= 2 MB e elevar apenas por rota",
             "F14 — 150 MB no parser global, alcancavel em webhook nao autenticado."),
            ("Padronizar timingSafeEqual em toda comparacao de segredo e remover o segredo da query string",
             "F15 — canal lateral de tempo e vazamento de segredo em access log."),
            ("Publicar CSP restritiva para o frontend e adotar DOMPurify como dependencia obrigatoria",
             "F16, F18 — sessao em localStorage sem lib de sanitizacao no projeto."),
            ("Resolver papel na tabela (nao na claim) nas policies mais sensiveis, ou invalidar sessao ao trocar papel",
             "F17 — janela de privilegio residual de ate uma expiracao de token apos rebaixamento."),
        ],
    ),
    dict(
        prioridade="P4",
        prazo="Melhoria continua",
        itens=[
            ("Criar um wrapper tipado obrigatorio para consultas com service_role, exigindo acesId explicito",
             "Transforma em erro de compilacao a classe de falha de F06 e F07, hoje detectavel so em revisao."),
            ("Estender as FKs compostas (id, aces_id) do schema collections aos schemas crm, agents e meta",
             "O padrao de 20260903205231 e o mais forte do repositorio e deveria ser a regra, nao a excecao."),
            ("Adicionar teste de contrato que percorra as rotas e falhe quando faltar authMiddleware ou guarda de papel",
             "Fecharia por construcao o tipo de lacuna de F05."),
            ("Remover o componente chart.tsx, hoje sem uso, ou validar suas cores por allowlist",
             "F18 — reduz superficie de injecao de CSS."),
        ],
    ),
]
