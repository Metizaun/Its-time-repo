import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";
import { geminiUsageLineItems, tryRecordAiUsage } from "./ai-costs.js";
import { requireAiBudget } from "./ai-budget.js";

import type { RbConnectionRecord } from "./rb-connection-service.js";

const execFileAsync = promisify(execFile);
const VISAGISM_BUCKET = "visagism-catalog";

export type ReverseVisagismAnalysis = {
  product_name: string;
  color: string;
  shape: string;
  material: string;
  style: string;
  recommended_face_shapes: string[];
  recommended_personality_traits: string[];
  recommended_perception: string[];
  recommended_style_profiles: string[];
  recommendation_description: string;
};

export type VisagismCatalogDraft = {
  draftId: string;
  previewUrl: string;
  analysis: ReverseVisagismAnalysis;
};

type VisagismCatalogRow = {
  id: string;
  storage_bucket: string | null;
  storage_path: string | null;
  display_order: number;
};

export type RbVisagismServiceConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  geminiApiKey?: string;
  model?: string;
  maxSourceBytes?: number;
  maxStoredBytes?: number;
  ffmpegPath?: string;
};

function requiredString(value: unknown, field: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`Gemini nao retornou o campo ${field}`);
  return normalized;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function parseAnalysis(text: string): ReverseVisagismAnalysis {
  const normalized = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const value = JSON.parse(normalized) as Record<string, unknown>;
  return {
    product_name: requiredString(value.product_name, "product_name"),
    color: requiredString(value.color, "color"),
    shape: requiredString(value.shape, "shape"),
    material: requiredString(value.material, "material"),
    style: requiredString(value.style, "style"),
    recommended_face_shapes: stringArray(value.recommended_face_shapes),
    recommended_personality_traits: stringArray(value.recommended_personality_traits),
    recommended_perception: stringArray(value.recommended_perception),
    recommended_style_profiles: stringArray(value.recommended_style_profiles),
    recommendation_description: requiredString(
      value.recommendation_description,
      "recommendation_description",
    ),
  };
}

function decodeBase64Image(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is);
  const encoded = match?.[2] ?? trimmed;
  if (!/^[a-z0-9+/=\r\n]+$/i.test(encoded)) {
    throw new Error("Imagem base64 invalida");
  }
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length === 0) throw new Error("Imagem vazia");
  return buffer;
}

function safePathSegment(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized.slice(0, 80) || "armacao";
}

function buildDescription(model: string, analysis: ReverseVisagismAnalysis) {
  return [
    `Nome/Modelo: ${model || analysis.product_name}`,
    `Cor: ${analysis.color}`,
    `Formato: ${analysis.shape}`,
    `Material: ${analysis.material}`,
    `Descricao visagista: ${analysis.recommendation_description}`,
  ].join("\n");
}

export class RbVisagismService {
  private readonly supabase;
  private readonly agentsClient;
  private readonly crmClient;
  private readonly gemini: GoogleGenerativeAI | null;
  private readonly model: string;
  private readonly maxSourceBytes: number;
  private readonly maxStoredBytes: number;
  private readonly ffmpegPath: string;

  constructor(config: RbVisagismServiceConfig) {
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    this.supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, options);
    this.agentsClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      ...options,
      db: { schema: "agents" },
    });
    this.crmClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      ...options,
      db: { schema: "crm" },
    });
    this.gemini = config.geminiApiKey ? new GoogleGenerativeAI(config.geminiApiKey) : null;
    this.model = config.model?.trim() || "gemini-2.5-flash";
    this.maxSourceBytes = config.maxSourceBytes ?? 10 * 1024 * 1024;
    this.maxStoredBytes = config.maxStoredBytes ?? 1_500_000;
    this.ffmpegPath = config.ffmpegPath?.trim() || "ffmpeg";
  }

  async analyzeAndSave(input: {
    connection: RbConnectionRecord;
    base64: string;
    modelo: string;
  }) {
    const draft = await this.analyzeDraft({
      acesId: input.connection.aces_id,
      base64: input.base64,
      modelo: input.modelo,
    });
    const content = buildDescription(input.modelo.trim(), draft.analysis);
    await this.saveDraft({
      acesId: input.connection.aces_id,
      draftId: draft.draftId,
      modelo: input.modelo,
      recommendationDescription: content,
      attributes: {
        source: "rb_ai",
        analysis_type: "reverse_visagism",
        analyzed_at: new Date().toISOString(),
        ...draft.analysis,
      },
    });
    return { content };
  }

  async analyzeDraft(input: {
    acesId: number;
    base64: string;
    modelo: string;
  }): Promise<VisagismCatalogDraft> {
    const modelo = input.modelo.trim();
    if (!modelo) throw new Error("modelo e obrigatorio");
    const source = decodeBase64Image(input.base64);
    if (source.length > this.maxSourceBytes) {
      throw new Error("Imagem excede o limite de 10 MB");
    }

    const draftId = randomUUID();
    const compressed = await this.compressImage(source);
    const analysis = await this.analyzeImage(compressed, modelo, input.acesId, draftId);
    const objectPath = `${input.acesId}/drafts/${draftId}.webp`;
    const { error: uploadError } = await this.supabase.storage
      .from(VISAGISM_BUCKET)
      .upload(objectPath, compressed, {
        contentType: "image/webp",
        cacheControl: "31536000",
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { data: signed, error: signedError } = await this.supabase.storage
      .from(VISAGISM_BUCKET)
      .createSignedUrl(objectPath, 15 * 60);
    if (signedError || !signed?.signedUrl) {
      await this.supabase.storage.from(VISAGISM_BUCKET).remove([objectPath]);
      throw signedError ?? new Error("Nao foi possivel gerar a previa da armacao");
    }

    return { draftId, previewUrl: signed.signedUrl, analysis };
  }

  async saveDraft(input: {
    acesId: number;
    draftId: string;
    modelo: string;
    recommendationDescription: string;
    attributes: Record<string, unknown>;
    displayOrder?: number;
  }) {
    const modelo = input.modelo.trim();
    const description = input.recommendationDescription.trim();
    if (!modelo || !description) throw new Error("modelo e descricao sao obrigatorios");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.draftId)) {
      throw new Error("rascunho de visagismo invalido");
    }

    const objectPath = `${input.acesId}/drafts/${input.draftId}.webp`;
    const { data: storedFile, error: downloadError } = await this.supabase.storage
      .from(VISAGISM_BUCKET)
      .download(objectPath);
    if (downloadError || !storedFile) {
      throw downloadError ?? new Error("Imagem analisada nao encontrada no Storage");
    }
    const fileSize = storedFile.size;
    const existing = await this.findCatalogItem(input.acesId, modelo);
    const { data, error: catalogError } = await this.agentsClient
      .from("visagism_catalog_items")
      .upsert(
        {
          aces_id: input.acesId,
          product_code: modelo,
          recommendation_description: description,
          attributes: input.attributes,
          source_url: "",
          storage_bucket: VISAGISM_BUCKET,
          storage_path: objectPath,
          mime_type: "image/webp",
          file_size: fileSize,
          display_order: input.displayOrder ?? existing?.display_order ?? 0,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "aces_id,product_code" },
      )
      .select("*")
      .single();
    if (catalogError) throw catalogError;

    if (
      existing?.storage_bucket &&
      existing.storage_path &&
      existing.storage_path !== objectPath
    ) {
      const { error: cleanupError } = await this.supabase.storage
        .from(existing.storage_bucket)
        .remove([existing.storage_path]);
      if (cleanupError) {
        console.warn("[rb-visagism] Falha ao remover imagem substituida:", cleanupError.message);
      }
    }
    return data;
  }

  async deleteByModel(connection: RbConnectionRecord, modelo: string) {
    const normalizedModel = modelo.trim();
    if (!normalizedModel) throw new Error("modelo e obrigatorio");
    const existing = await this.findCatalogItem(connection.aces_id, normalizedModel);

    const { error: deactivateError } = await this.agentsClient
      .from("visagism_catalog_items")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("aces_id", connection.aces_id)
      .eq("product_code", normalizedModel);
    if (deactivateError) throw deactivateError;

    if (existing?.storage_bucket && existing.storage_path) {
      const { error: storageError } = await this.supabase.storage
        .from(existing.storage_bucket)
        .remove([existing.storage_path]);
      if (storageError) {
        const { error: restoreError } = await this.agentsClient
          .from("visagism_catalog_items")
          .update({ is_active: true, updated_at: new Date().toISOString() })
          .eq("aces_id", connection.aces_id)
          .eq("product_code", normalizedModel);
        if (restoreError) {
          console.error("[rb-visagism] Falha ao restaurar item apos erro no Storage:", restoreError.message);
        }
        throw storageError;
      }
    }

    const { error } = await this.agentsClient
      .from("visagism_catalog_items")
      .delete()
      .eq("aces_id", connection.aces_id)
      .eq("product_code", normalizedModel);
    if (error) throw error;
    return { resultado: "Apagado com sucesso" };
  }

  private async findCatalogItem(acesId: number, modelo: string) {
    const { data, error } = await this.agentsClient
      .from("visagism_catalog_items")
      .select("id, storage_bucket, storage_path, display_order")
      .eq("aces_id", acesId)
      .eq("product_code", modelo)
      .maybeSingle();
    if (error) throw error;
    return (data as VisagismCatalogRow | null) ?? null;
  }

  private async compressImage(source: Buffer) {
    const directory = await mkdtemp(join(tmpdir(), "rb-visagism-"));
    const inputPath = join(directory, "source-image");
    const outputPath = join(directory, "frame.webp");
    try {
      await writeFile(inputPath, source);
      await this.runFfmpeg(inputPath, outputPath, 1600, 80);
      let output = await readFile(outputPath);
      if (output.length > this.maxStoredBytes) {
        await this.runFfmpeg(inputPath, outputPath, 1280, 65);
        output = await readFile(outputPath);
      }
      if (output.length > this.maxStoredBytes) {
        throw new Error("Imagem comprimida excede o limite de 1,5 MB");
      }
      return output;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async runFfmpeg(inputPath: string, outputPath: string, maxDimension: number, quality: number) {
    try {
      await execFileAsync(this.ffmpegPath, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-vf",
        `scale='min(${maxDimension},iw)':'min(${maxDimension},ih)':force_original_aspect_ratio=decrease`,
        "-frames:v",
        "1",
        "-c:v",
        "libwebp",
        "-quality",
        String(quality),
        "-compression_level",
        "6",
        outputPath,
      ]);
    } catch (error) {
      throw new Error("Nao foi possivel comprimir a imagem com FFmpeg", { cause: error });
    }
  }

  private async analyzeImage(image: Buffer, modelo: string, acesId: number, draftId: string) {
    if (!this.gemini) throw new Error("GEMINI_API_KEY nao configurada");
    await requireAiBudget(this.crmClient, acesId);
    const model = this.gemini.getGenerativeModel({
      model: this.model,
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    });
    const prompt = [
      "Analise somente a armacao de oculos da imagem para um catalogo de visagismo reverso.",
      `O codigo informado pelo sistema e: ${modelo}.`,
      "Descreva caracteristicas visuais observaveis e os perfis de rosto, estilo, personalidade e percepcao que a armacao favorece.",
      "Nao infira atributos sensiveis, identidade, saude, etnia, genero ou idade da pessoa fotografada.",
      "Retorne apenas JSON valido com estas chaves:",
      "product_name, color, shape, material, style, recommended_face_shapes, recommended_personality_traits, recommended_perception, recommended_style_profiles, recommendation_description.",
      "Os quatro campos recommended_* devem ser arrays curtos de strings. recommendation_description deve ser uma descricao natural em portugues, pronta para a IA recomendar a armacao ao cliente.",
    ].join("\n");
    const result = await model.generateContent([
      prompt,
      { inlineData: { data: image.toString("base64"), mimeType: "image/webp" } },
    ]);
    const response = result.response as unknown as Record<string, unknown>;
    await tryRecordAiUsage(this.crmClient, {
      idempotencyKey: `rb-visagism:${draftId}:analysis`,
      acesId,
      featureKey: "rb_visagism_analysis",
      provider: "google_gemini",
      model: this.model,
      lineItems: geminiUsageLineItems(response.usageMetadata),
      metadata: { draft_id: draftId, product_code: modelo },
    });
    return parseAnalysis(result.response.text());
  }
}

export const rbVisagismInternals = {
  buildDescription,
  decodeBase64Image,
  parseAnalysis,
  safePathSegment,
};
