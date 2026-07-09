import { supabase } from "@/integrations/supabase/client";
import { getCrmBackend, postCrmBackend } from "@/services/crmBackend";

export type AutomationMediaAsset = {
  id: string;
  instance_name: string;
  display_name: string;
  source_url: string;
  media_kind: "image" | "document";
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
  kind: "image" | "document";
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
    throw new Error("Use apenas imagem ou PDF na automacao");
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
