import { supabase } from "@/integrations/supabase/client";

const CRM_BACKEND_URL =
  (import.meta.env.VITE_CRM_BACKEND_URL as string | undefined)?.replace(/\/$/, "") ?? "";

function buildBackendUrl(path: string) {
  if (!CRM_BACKEND_URL) {
    throw new Error("Configuracao do backend CRM ausente no frontend");
  }

  return `${CRM_BACKEND_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

async function getAccessToken() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new Error(sessionError.message || "Nao foi possivel validar a sessao");
  }

  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    throw new Error("Sessao expirada. Faca login novamente.");
  }

  return accessToken;
}

async function parseBackendResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const backendMessage =
      typeof data?.error === "string"
        ? data.error
        : typeof data?.message === "string"
          ? data.message
          : null;

    throw new Error(backendMessage ?? `Falha ao comunicar com o backend CRM (${response.status})`);
  }

  return (data ?? {}) as T;
}

export async function getCrmBackend<T>(path: string): Promise<T> {
  const accessToken = await getAccessToken();
  const response = await fetch(buildBackendUrl(path), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return parseBackendResponse<T>(response);
}

export async function postCrmBackend<T>(path: string, body: unknown): Promise<T> {
  const accessToken = await getAccessToken();
  const response = await fetch(buildBackendUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body ?? {}),
  });

  return parseBackendResponse<T>(response);
}

export async function patchCrmBackend<T>(path: string, body: unknown): Promise<T> {
  const accessToken = await getAccessToken();
  const response = await fetch(buildBackendUrl(path), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body ?? {}),
  });

  return parseBackendResponse<T>(response);
}
