import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

type TableSchema = {
  description: string;
  columns: string[];
  foreignKeys?: Record<string, string>;
};

const CRM_SCHEMA: Record<string, TableSchema> = {
  leads: {
    description: "Leads do CRM",
    columns: [
      "id",
      "organization_id",
      "user_id",
      "first_name",
      "last_name",
      "email",
      "phone",
      "company",
      "website",
      "title",
      "industry",
      "location",
      "source",
      "status",
      "score",
      "notes",
      "created_at",
      "updated_at",
    ],
    foreignKeys: {
      organization_id: "organizations.id",
    },
  },
  lead_sources: {
    description: "Fontes de leads",
    columns: [
      "id",
      "organization_id",
      "name",
      "description",
      "created_at",
      "updated_at",
    ],
    foreignKeys: {
      organization_id: "organizations.id",
    },
  },
  lead_lists: {
    description: "Listas de leads",
    columns: [
      "id",
      "organization_id",
      "user_id",
      "name",
      "description",
      "type",
      "criteria",
      "created_at",
      "updated_at",
    ],
    foreignKeys: {
      organization_id: "organizations.id",
    },
  },
  lead_list_members: {
    description: "Relacao entre leads e listas",
    columns: [
      "id",
      "list_id",
      "lead_id",
      "added_by",
      "added_at",
    ],
    foreignKeys: {
      list_id: "lead_lists.id",
      lead_id: "leads.id",
    },
  },
  deals: {
    description: "Negociacoes / oportunidades",
    columns: [
      "id",
      "organization_id",
      "user_id",
      "company_id",
      "contact_id",
      "title",
      "description",
      "value",
      "stage",
      "status",
      "probability",
      "expected_close_date",
      "actual_close_date",
      "notes",
      "created_at",
      "updated_at",
    ],
    foreignKeys: {
      organization_id: "organizations.id",
      company_id: "companies.id",
      contact_id: "contacts.id",
    },
  },
  notes: {
    description: "Anotacoes",
    columns: [
      "id",
      "organization_id",
      "user_id",
      "company_id",
      "contact_id",
      "title",
      "content",
      "tags",
      "is_pinned",
      "created_at",
      "updated_at",
    ],
    foreignKeys: {
      organization_id: "organizations.id",
      company_id: "companies.id",
      contact_id: "contacts.id",
    },
  },
  tasks: {
    description: "Tarefas",
    columns: [
      "id",
      "organization_id",
      "user_id",
      "assigned_to",
      "company_id",
      "contact_id",
      "deal_id",
      "title",
      "description",
      "status",
      "priority",
      "due_date",
      "completed_at",
      "notes",
      "created_at",
      "updated_at",
    ],
    foreignKeys: {
      organization_id: "organizations.id",
      company_id: "companies.id",
      contact_id: "contacts.id",
      deal_id: "deals.id",
    },
  },
  partners: {
    description: "Parceiros",
    columns: [
      "id",
      "organization_id",
      "user_id",
      "name",
      "company_name",
      "contact_person",
      "email",
      "phone",
      "website",
      "industry",
      "partnership_type",
      "status",
      "address",
      "city",
      "state",
      "country",
      "postal_code",
      "notes",
      "created_at",
      "updated_at",
    ],
    foreignKeys: {
      organization_id: "organizations.id",
    },
  },
  partner_contracts: {
    description: "Contratos de parceiros",
    columns: [
      "id",
      "organization_id",
      "user_id",
      "partner_id",
      "title",
      "contract_number",
      "contract_type",
      "description",
      "contract_value",
      "currency",
      "start_date",
      "end_date",
      "renewal_date",
      "status",
      "payment_terms",
      "file_url",
      "notes",
      "created_at",
      "updated_at",
    ],
    foreignKeys: {
      organization_id: "organizations.id",
      partner_id: "partners.id",
    },
  },
  companies: {
    description: "Empresas",
    columns: [
      "id",
      "organization_id",
      "user_id",
      "name",
      "industry",
      "website",
      "phone",
      "email",
      "address",
      "city",
      "state",
      "country",
      "postal_code",
      "employee_count",
      "annual_revenue",
      "notes",
      "created_at",
      "updated_at",
    ],
    foreignKeys: {
      organization_id: "organizations.id",
    },
  },
  contacts: {
    description: "Contatos",
    columns: [
      "id",
      "organization_id",
      "user_id",
      "company_id",
      "first_name",
      "last_name",
      "email",
      "phone",
      "company",
      "position",
      "birthday",
      "anniversary",
      "important_dates",
      "notes",
      "personal_notes",
      "created_at",
      "updated_at",
    ],
    foreignKeys: {
      organization_id: "organizations.id",
      company_id: "companies.id",
    },
  },
};

const ALLOWED_TABLES = Object.keys(CRM_SCHEMA);
const INSERT_TABLES = ["tasks", "notes"];

type GeminiPart =
  | { text: string }
  | {
      functionCall: {
        name: string;
        args?: Record<string, unknown> | string;
      };
    }
  | {
      functionResponse: {
        name: string;
        response: { content: unknown };
      };
    };

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
};

type CrmFilter = {
  column?: string;
  op?: "eq" | "ilike" | "gte" | "lte" | "in";
  value?: unknown;
};

type CrmOrder = {
  column?: string;
  ascending?: boolean;
};

type CrmQueryArgs = {
  table?: string;
  select?: string[];
  filters?: CrmFilter[];
  order_by?: CrmOrder[];
  limit?: number;
  offset?: number;
  aggregate?: { type?: "count"; column?: string };
};

type CrmInsertArgs = {
  table?: string;
  values?: Record<string, unknown>;
};

function getTextFromParts(parts?: GeminiPart[]) {
  if (!parts) return "";
  const textParts = parts.filter((part) => "text" in part) as Array<{
    text: string;
  }>;
  return textParts.map((part) => part.text).join("\n").trim();
}

function coerceArgs(args?: Record<string, unknown> | string) {
  if (!args) return {};
  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch {
      return {};
    }
  }
  return args;
}

function formatSchema(schema: Record<string, TableSchema>) {
  const lines: string[] = [];
  for (const table of ALLOWED_TABLES) {
    const meta = schema[table];
    if (!meta) continue;
    const fkText = meta.foreignKeys
      ? ` | FKs: ${Object.entries(meta.foreignKeys)
        .map(([col, ref]) => `${col}->${ref}`)
        .join(", ")}`
      : "";
    lines.push(
      `- ${table}: ${meta.description}. Colunas: ${meta.columns.join(", ")}${fkText}`,
    );
  }
  return lines.join("\n");
}

function hasOrganizationId(table: string) {
  return CRM_SCHEMA[table]?.columns.includes("organization_id") ?? false;
}

function validateColumns(table: string, columns: string[]) {
  const meta = CRM_SCHEMA[table];
  if (!meta) return "Table not allowed";
  const invalid = columns.filter(
    (column) => column !== "*" && !meta.columns.includes(column),
  );
  if (invalid.length) {
    return `Invalid columns: ${invalid.join(", ")}`;
  }
  return null;
}

function getLimit(limit?: number) {
  const safe = typeof limit === "number" ? Math.floor(limit) : 20;
  if (safe <= 0) return 20;
  return Math.min(safe, 50);
}

function isCountIntent(message: string) {
  const text = message.toLowerCase();
  return /(quantos|quantas|total|numero|percentual|porcentagem)/.test(text);
}

function isCreateIntent(message: string) {
  const text = message.toLowerCase();
  return /(criar|crie|adicionar|adicione|nova|novo)/.test(text);
}

function detectEntity(message: string) {
  const text = message.toLowerCase();
  if (/(tarefa|tasks?)/.test(text)) return "tasks";
  if (/(nota|notas)/.test(text)) return "notes";
  if (/(negocio|negocios|deals?)/.test(text)) return "deals";
  if (/(contato|contatos|contacts?)/.test(text)) return "contacts";
  if (/(empresa|empresas|companies?)/.test(text)) return "companies";
  if (/(parceiro|parceiros|partners?)/.test(text)) return "partners";
  if (/(lista de leads|lead list|lead_lists?)/.test(text)) return "lead_lists";
  if (/(lead source|lead_sources?|fonte de lead|fontes de lead)/.test(text)) {
    return "lead_sources";
  }
  if (/(leads?)/.test(text)) return "leads";
  return null;
}

function isOpenTasksIntent(message: string) {
  const text = message.toLowerCase();
  return /(em aberto|pendente|pendentes|pending|abertas|aberto)/.test(text);
}

function extractCompanyName(message: string) {
  const text = message.toLowerCase();
  const match = text.match(/empresa\s+([^?\.\n]+)/);
  if (!match) return "";
  return match[1].replace(/\s+$/, "").trim();
}

function extractTitle(message: string) {
  const quoted = message.match(/["“”']([^"“”']+)["“”']/);
  if (quoted) return quoted[1].trim();
  const named = message.match(/(?:chamada|chamado|titulo|título)\s+([^.\n]+)/i);
  if (named) return named[1].trim();
  return "";
}

async function callGemini(
  apiKey: string,
  contents: Array<{ role: string; parts: GeminiPart[] }>,
  systemInstruction: string,
) {
  const response = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      tools,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Gemini API error: ${response.status} ${response.statusText} ${errorText}`,
    );
  }

  return (await response.json()) as GeminiResponse;
}

async function runCrmQuery(
  supabase: ReturnType<typeof createClient>,
  organizationId: string,
  args: CrmQueryArgs,
) {
  const table = String(args.table ?? "");
  if (!ALLOWED_TABLES.includes(table)) {
    return { error: "Table not allowed" };
  }
  const select = Array.isArray(args.select) ? args.select : [];
  const selectColumns = select.length ? select : ["*"];
  const columnError = validateColumns(table, selectColumns);
  if (columnError) return { error: columnError };

  const aggregate = args.aggregate;
  const isCount = aggregate?.type === "count";
  if (aggregate?.column) {
    const aggError = validateColumns(table, [aggregate.column]);
    if (aggError) return { error: aggError };
  }

  let query = supabase.from(table).select(
    isCount ? aggregate?.column ?? "id" : selectColumns.join(","),
    isCount ? { count: "exact", head: true } : undefined,
  );

  const filters = Array.isArray(args.filters) ? args.filters : [];
  for (const filter of filters) {
    const column = String(filter.column ?? "");
    const op = filter.op ?? "eq";
    if (!column) continue;
    const colError = validateColumns(table, [column]);
    if (colError) return { error: colError };

    if (op === "eq") {
      query = query.eq(column, filter.value);
    } else if (op === "ilike") {
      query = query.ilike(column, String(filter.value ?? ""));
    } else if (op === "gte") {
      query = query.gte(column, filter.value as string | number);
    } else if (op === "lte") {
      query = query.lte(column, filter.value as string | number);
    } else if (op === "in") {
      if (Array.isArray(filter.value)) {
        query = query.in(column, filter.value);
      } else {
        return { error: "Filter value must be array for in" };
      }
    } else {
      return { error: "Invalid filter operation" };
    }
  }

  if (hasOrganizationId(table)) {
    query = query.eq("organization_id", organizationId);
  }

  const orderBy = Array.isArray(args.order_by) ? args.order_by : [];
  for (const order of orderBy) {
    const column = String(order.column ?? "");
    if (!column) continue;
    const colError = validateColumns(table, [column]);
    if (colError) return { error: colError };
    query = query.order(column, { ascending: order.ascending ?? true });
  }

  if (!isCount) {
    const limit = getLimit(args.limit);
    const offset =
      typeof args.offset === "number" ? Math.max(0, Math.floor(args.offset)) : 0;
    query = offset ? query.range(offset, offset + limit - 1) : query.limit(limit);
  }

  const { data, error, count } = await query;
  if (error) return { error: error.message };
  if (isCount) return { count: count ?? 0 };
  return data ?? [];
}

async function runCrmInsert(
  supabase: ReturnType<typeof createClient>,
  organizationId: string,
  userId: string,
  args: CrmInsertArgs,
) {
  const table = String(args.table ?? "");
  if (!INSERT_TABLES.includes(table)) {
    return { error: "Insert table not allowed" };
  }
  const meta = CRM_SCHEMA[table];
  if (!meta) return { error: "Table not allowed" };
  if (typeof args.values !== "object" || args.values === null) {
    return { error: "Values must be an object" };
  }
  const values = { ...(args.values as Record<string, unknown>) };
  const keys = Object.keys(values);
  const columnError = validateColumns(table, keys);
  if (columnError) return { error: columnError };

  if (meta.columns.includes("organization_id")) {
    values.organization_id = organizationId;
  }
  if (meta.columns.includes("user_id")) {
    values.user_id = userId;
  }
  if (table === "tasks" && values.status === undefined) {
    values.status = "Pending";
  }

  const title = String(values.title ?? "").trim();
  if (!title) {
    return { error: "missing_title" };
  }

  const { data, error } = await supabase.from(table).insert(values).select("*");
  if (error) return { error: error.message };
  return data ?? [];
}

const tools = [
  {
    functionDeclarations: [
      {
        name: "crm_query",
        description: "Consulta generica em tabelas CRM.",
        parameters: {
          type: "object",
          properties: {
            table: { type: "string", enum: ALLOWED_TABLES },
            select: {
              type: "array",
              items: { type: "string" },
            },
            filters: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  column: { type: "string" },
                  op: {
                    type: "string",
                    enum: ["eq", "ilike", "gte", "lte", "in"],
                  },
                  value: {},
                },
                required: ["column", "op", "value"],
              },
            },
            order_by: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  column: { type: "string" },
                  ascending: { type: "boolean" },
                },
                required: ["column"],
              },
            },
            limit: { type: "number" },
            offset: { type: "number" },
            aggregate: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["count"] },
                column: { type: "string" },
              },
              required: ["type"],
            },
          },
          required: ["table"],
        },
      },
      {
        name: "crm_insert",
        description: "Insere dados no CRM (somente tasks e notes).",
        parameters: {
          type: "object",
          properties: {
            table: { type: "string", enum: INSERT_TABLES },
            values: { type: "object" },
          },
          required: ["table", "values"],
        },
      },
    ],
  },
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { message, deepSearch, history } = await req.json();

    if (!message) {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({ error: "Supabase environment not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "User not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roles, error: rolesError } = await supabase
      .from("user_roles")
      .select("organization_id")
      .eq("user_id", userData.user.id)
      .limit(1);

    if (rolesError || !roles || roles.length === 0) {
      return new Response(JSON.stringify({ error: "No organization found" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const organizationId = roles[0].organization_id as string;
    const schemaText = formatSchema(CRM_SCHEMA);

    const systemInstruction = [
      "Voce e um agente de dados CRM conectado ao Supabase.",
      "Sempre use crm_query ou crm_insert para ler e escrever.",
      "Nunca invente tabelas ou colunas. Use apenas o schema fornecido.",
      "Respeite as foreign keys. Se nao houver relacao, nao faça join.",
      "Se faltar titulo ao criar task ou nota, pergunte ao usuario o titulo.",
      deepSearch
        ? "Responda com mais profundidade, detalhando raciocinio e recomendacoes."
        : "Responda de forma direta e objetiva.",
      "",
      "Schema permitido:",
      schemaText,
      "",
      "Exemplos:",
      "- Usuario: 'Quem sao meus contatos?' -> crm_query em contacts, order_by created_at desc.",
      "- Usuario: 'Quantas tasks em aberto?' -> crm_query em tasks com filter status Pending e aggregate count.",
      "- Usuario: 'Empresa Acme tem quantas tasks?' -> crm_query em companies para pegar id, depois crm_query em tasks com company_id.",
      "- Usuario: 'Crie uma task chamada \"Follow up\"' -> crm_insert em tasks com title.",
      "- Usuario: 'Crie uma nota sobre negociacao X' -> crm_insert em notes com title e content.",
    ].join("\n");

    const contents: Array<{ role: string; parts: GeminiPart[] }> = [];
    if (Array.isArray(history)) {
      for (const item of history) {
        if (!item || typeof item !== "object") continue;
        const role = String((item as { role?: string }).role ?? "");
        const content = String((item as { content?: string }).content ?? "");
        if ((role === "user" || role === "assistant") && content.trim()) {
          contents.push({ role, parts: [{ text: content }] });
        }
      }
    }
    contents.push({ role: "user", parts: [{ text: message }] });

    let finalText = "";
    let iteration = 0;

    while (iteration < 3) {
      const geminiResponse = await callGemini(
        apiKey,
        contents,
        systemInstruction,
      );
      const parts = geminiResponse.candidates?.[0]?.content?.parts || [];
      const functionCalls = parts.filter(
        (part) => "functionCall" in part,
      ) as Array<{
        functionCall: { name: string; args?: Record<string, unknown> | string };
      }>;

      if (functionCalls.length === 0) {
        if (iteration === 0) {
          const entity = detectEntity(message);
          const createIntent = isCreateIntent(message);
          const countIntent = isCountIntent(message);

          if (createIntent && (entity === "tasks" || entity === "notes")) {
            const title = extractTitle(message);
            if (!title) {
              finalText =
                entity === "tasks"
                  ? "Qual o nome da tarefa?"
                  : "Qual o titulo da nota?";
              break;
            }
            const values: Record<string, unknown> = { title };
            const result = await runCrmInsert(
              supabase,
              organizationId,
              userData.user.id,
              { table: entity, values },
            );
            contents.push({
              role: "user",
              parts: [
                {
                  functionResponse: {
                    name: "crm_insert",
                    response: { content: result },
                  },
                },
              ],
            });
            iteration += 1;
            continue;
          }

          if (entity) {
            const args: CrmQueryArgs = {
              table: entity,
              order_by: [{ column: "created_at", ascending: false }],
              limit: 10,
            };

            if (entity === "tasks" && isOpenTasksIntent(message)) {
              args.filters = [
                { column: "status", op: "eq", value: "Pending" },
              ];
            }

            if (countIntent) {
              args.aggregate = { type: "count", column: "id" };
            }

            const companyName = extractCompanyName(message);
            if (companyName && entity === "tasks") {
              const companyResult = await runCrmQuery(supabase, organizationId, {
                table: "companies",
                select: ["id", "name"],
                filters: [
                  { column: "name", op: "ilike", value: `%${companyName}%` },
                ],
                limit: 1,
              });
              if (
                Array.isArray(companyResult) &&
                companyResult.length > 0 &&
                (companyResult[0] as { id?: string }).id
              ) {
                args.filters = [
                  ...(args.filters ?? []),
                  {
                    column: "company_id",
                    op: "eq",
                    value: (companyResult[0] as { id: string }).id,
                  },
                ];
              }
            }

            const result = await runCrmQuery(
              supabase,
              organizationId,
              args,
            );
            contents.push({
              role: "user",
              parts: [
                {
                  functionResponse: {
                    name: "crm_query",
                    response: { content: result },
                  },
                },
              ],
            });
            iteration += 1;
            continue;
          }
        }

        finalText = getTextFromParts(parts);
        break;
      }

      for (const call of functionCalls) {
        const name = call.functionCall.name;
        const args = coerceArgs(call.functionCall.args);
        let result: unknown = [];

        try {
          if (name === "crm_query") {
            result = await runCrmQuery(
              supabase,
              organizationId,
              args as CrmQueryArgs,
            );
          } else if (name === "crm_insert") {
            result = await runCrmInsert(
              supabase,
              organizationId,
              userData.user.id,
              args as CrmInsertArgs,
            );
            if (
              typeof result === "object" &&
              result !== null &&
              "error" in result &&
              (result as { error?: string }).error === "missing_title"
            ) {
              finalText =
                (args as CrmInsertArgs).table === "tasks"
                  ? "Qual o nome da tarefa?"
                  : "Qual o titulo da nota?";
              break;
            }
          } else {
            result = { error: `Unknown function: ${name}` };
          }
        } catch (error) {
          result = {
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }

        if (finalText) {
          break;
        }

        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name,
                response: { content: result },
              },
            },
          ],
        });
      }

      if (finalText) break;
      iteration += 1;
    }

    if (!finalText) {
      finalText =
        "Desculpe, nao consegui gerar uma resposta agora. Tente novamente.";
    }

    return new Response(JSON.stringify({ response: finalText }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in AI function:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
