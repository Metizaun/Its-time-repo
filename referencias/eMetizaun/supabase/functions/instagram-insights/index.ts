import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import {
  callGeminiText,
  corsHeaders,
  ensureOrgAccess,
  getAuthContext,
  HttpError,
  jsonResponse,
} from "../_shared/research.ts";

type InsightsPayload = {
  projectId?: string;
  focus?: "posicionamento" | "conteudo" | "copy" | "formato_video";
};

type ProjectRow = {
  id: string;
  organization_id: string;
  name: string;
  competitor_username: string;
};

type ScrapeItemRow = {
  id: string;
  type: "photo" | "reel";
  caption: string | null;
  likes_count: number | null;
  comments_count: number | null;
  views_count: number | null;
  posted_at: string | null;
  permalink: string;
};

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildFallbackInsights(
  project: ProjectRow,
  items: ScrapeItemRow[],
  focus: string,
) {
  const reels = items.filter((item) => item.type === "reel");
  const photos = items.filter((item) => item.type === "photo");

  const avgLikes = Math.round(average(items.map((item) => item.likes_count || 0)));
  const avgComments = Math.round(average(items.map((item) => item.comments_count || 0)));
  const avgViews = Math.round(average(reels.map((item) => item.views_count || 0)));

  const topByEngagement = [...items]
    .sort((a, b) => {
      const aScore = (a.likes_count || 0) + (a.comments_count || 0) * 2;
      const bScore = (b.likes_count || 0) + (b.comments_count || 0) * 2;
      return bScore - aScore;
    })
    .slice(0, 5);

  const avgCaptionLength = Math.round(
    average(
      items
        .map((item) => (item.caption || "").trim())
        .filter(Boolean)
        .map((caption) => caption.length),
    ),
  );

  const ctaCount = items.filter((item) =>
    /(comente|salve|curta|compartilhe|clique|fale comigo|manda|dm)/i.test(item.caption || ""),
  ).length;

  const emojiCount = items.filter((item) => /[\u{1F300}-\u{1FAFF}]/u.test(item.caption || "")).length;

  const strategyBullets = [
    reels.length > photos.length
      ? "Priorizar formato em video curto para manter alcance no topo do funil."
      : "Aumentar proporcao de reels para destravar alcance de descoberta.",
    avgCaptionLength > 180
      ? "Manter legendas mais longas para educacao e contexto, mas testar versoes curtas para CTA direto."
      : "Testar legendas um pouco mais densas para elevar retencao e autoridade.",
    ctaCount < Math.ceil(items.length * 0.5)
      ? "Adicionar CTA explicito em pelo menos metade dos posts."
      : "Refinar CTAs para maior especificidade (acao unica por post).",
    emojiCount > Math.ceil(items.length * 0.6)
      ? "Reduzir emojis em conteudos de conversao para ganho de percepcao premium."
      : "Usar emojis de forma pontual para escaneabilidade sem poluir a copy.",
  ];

  const topList = topByEngagement
    .map((item, index) => {
      const score = (item.likes_count || 0) + (item.comments_count || 0) * 2;
      return `${index + 1}. ${item.type.toUpperCase()} | score ${score} | ${item.permalink}`;
    })
    .join("\n");

  return [
    `# Analise de posicionamento - @${project.competitor_username}`,
    "",
    `Foco solicitado: **${focus}**`,
    "",
    "## Panorama de conteudo",
    `- Total de posts analisados: ${items.length}`,
    `- Reels: ${reels.length}`,
    `- Fotos: ${photos.length}`,
    `- Media de likes: ${avgLikes}`,
    `- Media de comentarios: ${avgComments}`,
    `- Media de views (reels): ${avgViews}`,
    `- Tamanho medio de legenda: ${avgCaptionLength} caracteres`,
    "",
    "## Leitura de posicionamento",
    "- O concorrente reforca consistencia visual e narrativa por repeticao de temas.",
    "- Engajamento tende a concentrar em formatos com gancho forte no inicio.",
    "- Copy performa melhor quando combina contexto rapido + CTA direto.",
    "",
    "## Top referencias para replicar",
    topList || "- Sem itens suficientes para ranking.",
    "",
    "## Estrategias acionaveis para seu time",
    ...strategyBullets.map((item) => `- ${item}`),
    "",
    "## Proximo experimento recomendado",
    "- Criar 3 variacoes de roteiro com o mesmo tema: autoridade, dor e prova social.",
    "- Publicar em janela de 7 dias e comparar taxa de salvamento/comentario.",
  ].join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as InsightsPayload;
    const projectId = body.projectId;
    const focus = body.focus || "posicionamento";

    if (!projectId) {
      throw new HttpError(400, "projectId is required");
    }

    const auth = await getAuthContext(req);

    const { data: projectRow, error: projectError } = await auth.supabaseAdmin
      .schema("research")
      .from("projects")
      .select("id, organization_id, name, competitor_username")
      .eq("id", projectId)
      .single();

    if (projectError || !projectRow) {
      throw new HttpError(404, "Project not found");
    }

    const project = projectRow as ProjectRow;
    ensureOrgAccess(auth.organizationIds, project.organization_id);

    const { data: savedRows, error: savedError } = await auth.supabaseAdmin
      .schema("research")
      .from("project_saved_items")
      .select("scrape_item_id")
      .eq("organization_id", project.organization_id)
      .eq("project_id", project.id);

    if (savedError) {
      throw new HttpError(500, savedError.message || "Failed to load saved items");
    }

    const scrapeItemIds = (savedRows || []).map((row) => row.scrape_item_id);
    let items: ScrapeItemRow[] = [];

    if (scrapeItemIds.length) {
      const { data: itemRows, error: itemError } = await auth.supabaseAdmin
        .schema("research")
        .from("scrape_items")
        .select("id, type, caption, likes_count, comments_count, views_count, posted_at, permalink")
        .in("id", scrapeItemIds);

      if (itemError) {
        throw new HttpError(500, itemError.message || "Failed to load scrape item data");
      }

      items = (itemRows || []) as ScrapeItemRow[];
    }

    let analysisText = buildFallbackInsights(project, items, focus);

    const sampleCaptions = items
      .map((item) => (item.caption || "").trim())
      .filter(Boolean)
      .slice(0, 12);

    const llmPrompt = [
      "Voce e um estrategista de marketing de conteudo para Instagram.",
      "Responda em portugues-BR, formato markdown, tom pratico e instrutivo.",
      "Objetivo: gerar analise acionavel para CRM de inteligencia competitiva.",
      `Foco: ${focus}.`,
      `Concorrente: @${project.competitor_username}.`,
      `Total de posts selecionados: ${items.length}.`,
      "",
      "Dados resumidos dos posts:",
      JSON.stringify(items.slice(0, 30)),
      "",
      "Legendas de referencia:",
      JSON.stringify(sampleCaptions),
      "",
      "Entregue:",
      "1) leitura de posicionamento;",
      "2) padroes de conteudo e copy;",
      "3) estrategias replicaveis sem copiar literalmente;",
      "4) plano de 7 dias com prioridades.",
    ].join("\n");

    try {
      const llmResult = await callGeminiText(llmPrompt);
      if (llmResult) {
        analysisText = llmResult;
      }
    } catch (llmError) {
      console.error("instagram-insights llm fallback:", llmError);
    }

    const now = new Date();
    const title = `Analise posicional ${now.toLocaleDateString("pt-BR")}`;

    const { data: insertedDoc, error: documentError } = await auth.supabaseAdmin
      .schema("research")
      .from("project_documents")
      .insert({
        organization_id: project.organization_id,
        project_id: project.id,
        title,
        doc_type: "analysis",
        content_md: analysisText,
        created_by_user_id: auth.userId,
      })
      .select("id")
      .single();

    if (documentError || !insertedDoc) {
      throw new HttpError(500, documentError?.message || "Failed to save analysis document");
    }

    const inputContext = {
      focus,
      item_count: items.length,
      competitor_username: project.competitor_username,
    };

    const { data: aiNote } = await auth.supabaseAdmin
      .schema("research")
      .from("project_ai_notes")
      .insert({
        organization_id: project.organization_id,
        project_id: project.id,
        input_context: inputContext,
        output_text: analysisText,
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
          payload_text: analysisText,
          metadata: {
            doc_type: "analysis",
            focus,
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
                payload_text: analysisText,
                metadata: {
                  focus,
                },
                status: "pending",
              },
            ]
          : []),
      ]);

    return jsonResponse(200, {
      analysisDocumentId: insertedDoc.id,
      analysisText,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse(error.status, { error: error.message });
    }

    const message = error instanceof Error ? error.message : "internal_error";
    return jsonResponse(500, { error: message });
  }
});

