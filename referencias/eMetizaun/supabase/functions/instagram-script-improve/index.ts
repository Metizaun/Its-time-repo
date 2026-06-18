import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import {
  callGeminiText,
  corsHeaders,
  ensureOrgAccess,
  getAuthContext,
  HttpError,
  jsonResponse,
} from "../_shared/research.ts";

type ScriptImprovePayload = {
  projectId?: string;
  originalScript?: string;
  improvementGoal?: string;
};

type ProjectRow = {
  id: string;
  organization_id: string;
  competitor_username: string;
};

function buildFallbackScript(originalScript: string, improvementGoal: string) {
  const cleanedGoal = improvementGoal.trim() || "melhorar clareza e conversao";
  const baseScript = originalScript.trim();

  const improvedScript = [
    "GANCHO (0-3s):",
    "Voce esta cometendo esse erro comum e perdendo vendas todos os dias.",
    "",
    "CONTEXTO (3-12s):",
    baseScript || "Explique rapidamente a dor principal do publico e o impacto no negocio.",
    "",
    "PROVA/EXEMPLO (12-25s):",
    "Mostre um caso real, antes/depois ou dado objetivo que comprove o ponto.",
    "",
    "CTA (25-30s):",
    "Comente 'quero' para receber o passo a passo e salvar esse video para aplicar hoje.",
  ].join("\n");

  const rationale = [
    `Ajuste principal aplicado: ${cleanedGoal}.`,
    "Estrutura em 4 blocos para elevar retencao (gancho -> contexto -> prova -> CTA).",
    "Copy mais direta e orientada a acao para aumentar comentarios e salvamentos.",
  ].join(" ");

  return { improvedScript, rationale };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as ScriptImprovePayload;
    const projectId = body.projectId;
    const originalScript = String(body.originalScript || "").trim();
    const improvementGoal = String(body.improvementGoal || "").trim();

    if (!projectId) {
      throw new HttpError(400, "projectId is required");
    }

    if (!originalScript) {
      throw new HttpError(400, "originalScript is required");
    }

    const auth = await getAuthContext(req);

    const { data: projectRow, error: projectError } = await auth.supabaseAdmin
      .schema("research")
      .from("projects")
      .select("id, organization_id, competitor_username")
      .eq("id", projectId)
      .single();

    if (projectError || !projectRow) {
      throw new HttpError(404, "Project not found");
    }

    const project = projectRow as ProjectRow;
    ensureOrgAccess(auth.organizationIds, project.organization_id);

    const { data: savedRows } = await auth.supabaseAdmin
      .schema("research")
      .from("project_saved_items")
      .select("scrape_item_id")
      .eq("organization_id", project.organization_id)
      .eq("project_id", project.id)
      .limit(12);

    const scrapeItemIds = (savedRows || []).map((row) => row.scrape_item_id);
    let referenceCaptions: string[] = [];

    if (scrapeItemIds.length) {
      const { data: itemRows } = await auth.supabaseAdmin
        .schema("research")
        .from("scrape_items")
        .select("caption")
        .in("id", scrapeItemIds);

      referenceCaptions = (itemRows || [])
        .map((row) => (row.caption || "").trim())
        .filter(Boolean)
        .slice(0, 8);
    }

    let improvedScript = "";
    let rationale = "";

    const llmPrompt = [
      "Voce e um estrategista de roteiros curtos para Instagram Reels.",
      "Escreva em portugues-BR com tom objetivo, claro e persuasivo.",
      `Concorrente em analise: @${project.competitor_username}.`,
      `Objetivo de melhoria: ${improvementGoal || "elevar retencao e conversao"}.`,
      "",
      "Roteiro original:",
      originalScript,
      "",
      "Referencias de estilo (legendas do concorrente):",
      JSON.stringify(referenceCaptions),
      "",
      "Entrega obrigatoria:",
      "1) Versao melhorada do roteiro com blocos GANCHO/CONTEXTO/PROVA/CTA.",
      "2) Breve racional com ate 4 bullets.",
      "",
      "Formato de resposta:",
      "### improved_script",
      "<roteiro>",
      "### rationale",
      "<bullets>",
    ].join("\n");

    try {
      const llmResponse = await callGeminiText(llmPrompt);
      if (llmResponse) {
        const scriptMatch = llmResponse.match(/###\s*improved_script([\s\S]*?)###\s*rationale/i);
        const rationaleMatch = llmResponse.match(/###\s*rationale([\s\S]*)$/i);
        improvedScript = scriptMatch?.[1]?.trim() || llmResponse.trim();
        rationale = rationaleMatch?.[1]?.trim() || "Roteiro refinado para melhorar clareza, ritmo e CTA.";
      }
    } catch (llmError) {
      console.error("instagram-script-improve llm fallback:", llmError);
    }

    if (!improvedScript) {
      const fallback = buildFallbackScript(originalScript, improvementGoal);
      improvedScript = fallback.improvedScript;
      rationale = fallback.rationale;
    }

    const title = `Roteiro melhorado ${new Date().toLocaleDateString("pt-BR")}`;
    const scriptDocContent = `# ${title}\n\n${improvedScript}\n\n## Racional\n${rationale}`;

    const { data: insertedDoc, error: docError } = await auth.supabaseAdmin
      .schema("research")
      .from("project_documents")
      .insert({
        organization_id: project.organization_id,
        project_id: project.id,
        title,
        doc_type: "script",
        content_md: scriptDocContent,
        created_by_user_id: auth.userId,
      })
      .select("id")
      .single();

    if (docError || !insertedDoc) {
      throw new HttpError(500, docError?.message || "Failed to save improved script");
    }

    const { data: aiNote } = await auth.supabaseAdmin
      .schema("research")
      .from("project_ai_notes")
      .insert({
        organization_id: project.organization_id,
        project_id: project.id,
        input_context: {
          improvementGoal,
          hasReferenceCaptions: referenceCaptions.length > 0,
        },
        output_text: scriptDocContent,
        created_by_user_id: auth.userId,
      })
      .select("id")
      .single();

    await auth.supabaseAdmin
      .schema("research")
      .from("vector_queue")
      .insert([
        {
          organization_id: project.organization_id,
          project_id: project.id,
          source_type: "project_document",
          source_id: insertedDoc.id,
          payload_text: scriptDocContent,
          metadata: {
            doc_type: "script",
          },
          status: "pending",
        },
        ...(aiNote?.id
          ? [
              {
                organization_id: project.organization_id,
                project_id: project.id,
                source_type: "project_ai_note",
                source_id: aiNote.id,
                payload_text: scriptDocContent,
                metadata: {
                  type: "script_improve",
                },
                status: "pending",
              },
            ]
          : []),
      ]);

    return jsonResponse(200, {
      improvedScript,
      rationale,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse(error.status, { error: error.message });
    }

    const message = error instanceof Error ? error.message : "internal_error";
    return jsonResponse(500, { error: message });
  }
});

