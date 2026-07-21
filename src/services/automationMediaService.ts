import { supabase } from "@/integrations/supabase/client";
import { getCrmBackend, postCrmBackend } from "@/services/crmBackend";

export type AutomationMediaAsset = {
  id: string;
  instance_name: string;
  display_name: string;
  source_url: string;
  media_kind: "image" | "video" | "document";
  mime_type: string | null;
  file_name: string | null;
  file_size: number | null;
  default_caption: string | null;
};

type ListAutomationMediaAssetsResponse = {
  assets?: AutomationMediaAsset[];
};

type AutomationMediaUploadIntent = {
  success: boolean;
  assetId: string;
  bucket: string;
  storagePath: string;
  uploadUrl: string;
  uploadToken: string;
  maxFileSize: number;
  mimeType: string;
  kind: "image" | "video" | "document";
};

type CompleteAutomationMediaUploadResponse = {
  success: boolean;
  asset: AutomationMediaAsset;
};

function normalizeMediaMimeType(file: File) {
  const raw = file.type.trim().toLowerCase();
  if (raw) {
    return raw;
  }

  if (file.name.toLowerCase().endsWith(".pdf")) {
    return "application/pdf";
  }

  if (file.name.toLowerCase().endsWith(".mp4")) {
    return "video/mp4";
  }

  return "";
}

function resolveAutomationMediaKind(file: File) {
  const mimeType = normalizeMediaMimeType(file);
  if (mimeType === "application/pdf") {
    return { kind: "document" as const, mimeType };
  }

  if (mimeType.startsWith("image/")) {
    return { kind: "image" as const, mimeType };
  }

  if (mimeType === "video/mp4") {
    return { kind: "video" as const, mimeType };
  }

  return null;
}

export async function listAutomationMediaAssets(instanceName?: string | null) {
  const query = instanceName ? `?instanceName=${encodeURIComponent(instanceName)}` : "";
  const response = await getCrmBackend<ListAutomationMediaAssetsResponse>(`/api/automation/media-assets${query}`);
  return response.assets ?? [];
}

export async function uploadAutomationMediaAsset(params: {
  instanceName: string;
  file: File;
}) {
  const resolved = resolveAutomationMediaKind(params.file);
  if (!resolved) {
    throw new Error("Use apenas imagem, video MP4 ou PDF na automacao");
  }

  const maxFileSize =
    resolved.kind === "image"
      ? 5 * 1024 * 1024
      : resolved.kind === "video"
        ? 16 * 1024 * 1024
        : 100 * 1024 * 1024;
  if (params.file.size > maxFileSize) {
    const limit = resolved.kind === "image" ? "5 MB" : resolved.kind === "video" ? "16 MB" : "100 MB";
    throw new Error(`O arquivo excede o limite de ${limit}`);
  }

  const uploadIntent = await postCrmBackend<AutomationMediaUploadIntent>("/api/automation/media-assets/upload-url", {
    instanceName: params.instanceName,
    fileName: params.file.name,
    mimeType: resolved.mimeType,
    fileSize: params.file.size,
    kind: resolved.kind,
  });

  const { error: uploadError } = await supabase.storage
    .from(uploadIntent.bucket)
    .uploadToSignedUrl(uploadIntent.storagePath, uploadIntent.uploadToken, params.file, {
      contentType: uploadIntent.mimeType,
      upsert: false,
    });

  if (uploadError) {
    throw uploadError;
  }

  const response = await postCrmBackend<CompleteAutomationMediaUploadResponse>("/api/automation/media-assets/complete-upload", {
    assetId: uploadIntent.assetId,
  });

  return response.asset;
}
