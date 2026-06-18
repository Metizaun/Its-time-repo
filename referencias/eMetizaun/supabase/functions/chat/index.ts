import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

type ChatMessage = { role: string; content: string };

type MetadataRow = {
  schema_name: string;
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: boolean;
  column_default: string | null;
};

const LOG_PREFIX = "[nl2sql-chat]";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { messages, conversationId: _conversationId } = await req.json();

    console.log(`${LOG_PREFIX} request`, {
      hasConversationId: Boolean(_conversationId),
      messagesCount: Array.isArray(messages) ? messages.length : 0,
    });

    if (!Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages_required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: "supabase_env_missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!geminiApiKey) {
      return new Response(JSON.stringify({ error: "gemini_key_missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "not_authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roles } = await supabaseUser
      .from("user_roles")
      .select("organization_id")
      .eq("user_id", userData.user.id)
      .limit(1);

    const organizationId = roles?.[0]?.organization_id as string | undefined;
    console.log(`${LOG_PREFIX} auth`, {
      hasUser: Boolean(userData?.user?.id),
      hasOrganization: Boolean(organizationId),
    });

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: settings } = await supabaseAdmin
      .from("llm_settings")
      .select("provider, model, temperature, system_prompt")
      .eq("is_active", true)
      .eq("organization_id", organizationId ?? "")
      .limit(1)
      .maybeSingle();

    const model = settings?.model || "gemini-2.5-flash";
    const temperature = typeof settings?.temperature === "number" ? settings.temperature : 0.2;

    let metadataRows = await loadMetadataCache(supabaseAdmin);
    console.log(`${LOG_PREFIX} metadata_cache`, {
      cachedRows: metadataRows.length,
    });
    if (!metadataRows.length) {
      const { data: metadata } = await supabaseAdmin.rpc("get_database_metadata");
      if (Array.isArray(metadata) && metadata.length) {
        await supabaseAdmin.from("database_metadata_cache").insert(
          metadata.map((row: MetadataRow) => ({
            schema_name: row.schema_name,
            table_name: row.table_name,
            column_name: row.column_name,
            data_type: row.data_type,
            is_nullable: row.is_nullable,
            column_default: row.column_default,
          }))
        );
        metadataRows = metadata as MetadataRow[];
      }
    }
    console.log(`${LOG_PREFIX} metadata_final`, {
      finalRows: metadataRows.length,
    });

    const metadataContext = metadataRows.length
      ? `\n\nEstrutura disponivel:\n${formatMetadata(metadataRows)}`
      : "";

    const basePrompt = [
      "Voce e um assistente especializado em dados de negocios.",
      "Responda de forma natural e objetiva.",
      "Sua funcao principal e gerar insights acionaveis para apoiar decisoes.",
      "Nao mencione SQL, tabelas, colunas, schemas ou termos tecnicos.",
      "Saudacoes e conversas gerais devem ser respondidas normalmente, sem consultas.",
      "Somente use consultas quando o usuario pedir dados ou uma acao.",
      "Nunca recuse ajuda por falta de contexto; quando faltar contexto, faca perguntas de aprofundamento claras e objetivas.",
      "Quando a pergunta for avaliativa (ex: 'essa taxa de conversao e boa?'), responda com analise condicional e solicite os dados faltantes em formato de checklist curto.",
      "Quando possivel, proponha proximos passos praticos para melhorar o indicador.",
      "Permissoes: consultas gerais e criacao/atualizacao para leads, deals, tasks, notes, companies, contacts, lead_lists e partners.",
      "Mapeamento de negocio: People = contacts, Lists = lead_lists.",
      "Nunca gere comandos destrutivos.",
      "Quando o usuario pedir dados, gere a consulta para buscar os resultados.",
      "Use SEMPRE a tag [AUTO_EXECUTE] antes da consulta.",
      "Gere apenas UMA instrucao SQL por resposta.",
      "A consulta deve estar sempre dentro de um unico bloco ```sql ... ```.",
      "A resposta deve terminar imediatamente apos o bloco SQL.",
      "Nao use ponto e virgula.",
      "Para criacoes ou atualizacoes, use RETURNING *.",
      "Para INSERT em companies, contacts, leads, lead_lists, deals, partners, tasks e notes, inclua user_id e organization_id.",
      "Use auth.uid() para user_id e (SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1) para organization_id.",
      "Para UPDATE, priorize filtro por organization_id com a mesma expressao.",
      "Nunca exponha a consulta para o usuario.",
      metadataContext,
    ].join("\n");

    const systemPrompt = settings?.system_prompt
      ? `${basePrompt}\n\nInstrucoes adicionais:\n${settings.system_prompt}`
      : basePrompt;

    console.log(`${LOG_PREFIX} llm_request`, {
      model,
      temperature,
      systemPromptLength: systemPrompt.length,
      messageCount: messages.length,
    });

    const llmText = await callGeminiOnce(
      geminiApiKey,
      model,
      temperature,
      systemPrompt,
      messages as ChatMessage[],
    );

    return toSseResponse(llmText);
  } catch (error) {
    console.error("Chat error:", error);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function loadMetadataCache(
  supabaseAdmin: ReturnType<typeof createClient>,
): Promise<MetadataRow[]> {
  const { data } = await supabaseAdmin
    .from("database_metadata_cache")
    .select("schema_name, table_name, column_name, data_type, is_nullable, column_default")
    .order("schema_name, table_name, column_name");

  if (!Array.isArray(data)) return [];
  return data as MetadataRow[];
}

function formatMetadata(metadata: MetadataRow[]): string {
  const grouped: Record<string, Record<string, string[]>> = {};

  for (const row of metadata) {
    if (!grouped[row.schema_name]) {
      grouped[row.schema_name] = {};
    }
    if (!grouped[row.schema_name][row.table_name]) {
      grouped[row.schema_name][row.table_name] = [];
    }
    grouped[row.schema_name][row.table_name].push(
      `${row.column_name} (${row.data_type}${row.is_nullable ? ", nullable" : ""})`,
    );
  }

  let result = "";
  for (const [schema, tables] of Object.entries(grouped)) {
    result += `\nSchema: ${schema}\n`;
    for (const [table, columns] of Object.entries(tables)) {
      result += `  Tabela: ${table}\n`;
      result += `    Colunas: ${columns.join(", ")}\n`;
    }
  }
  return result;
}

async function callGeminiOnce(
  apiKey: string,
  model: string,
  temperature: number,
  systemPrompt: string,
  messages: ChatMessage[],
) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const contents = messages.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { temperature },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`${LOG_PREFIX} llm_error`, {
      status: response.status,
      bodyLength: errorText.length,
    });
    throw new Error("llm_error");
  }

  console.log(`${LOG_PREFIX} llm_response`, {
    status: response.status,
    contentType: response.headers.get("content-type"),
  });

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((part: { text?: string }) => typeof part?.text === "string")
    .map((part: { text: string }) => part.text)
    .join("\n")
    .trim();

  console.log(`${LOG_PREFIX} llm_text`, {
    length: text.length,
    hasAutoExecute: text.includes("[AUTO_EXECUTE]"),
    hasSqlFence: /```sql/i.test(text),
    preview: text.slice(0, 220),
  });

  return text || "Desculpe, nao consegui responder agora.";
}

function toSseResponse(text: string) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const sseData = JSON.stringify({
        choices: [{ delta: { content: text } }],
      });
      controller.enqueue(encoder.encode(`data: ${sseData}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
  });
}
