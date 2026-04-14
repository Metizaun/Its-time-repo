import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { notifyLeadsUpdated } from "@/hooks/useLeads";

export type BuscarLeadResult = {
  externalId?: string;
  name: string;
  phone: string | null;
  email: string | null;
  website?: string | null;
  rating?: number | null;
  reviewsCount?: number | null;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  isImported?: boolean;
  isDuplicate?: boolean;
};

export type BuscarLeadsStartPayload = {
  searchStrings: string[];
  locationQuery: string;
  country: string;
  radiusKm: number;
  minimumStars: number;
  maxResults: number;
  language: string;
  fields: string[];
  instancia: string;
};

export type BuscarLeadsStatusResponse = {
  runId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  message?: string;
  center?: { lat: number; lng: number; label: string };
  results?: BuscarLeadResult[];
  totals?: {
    fetched: number;
    withPhone: number;
    inserted: number;
    duplicates: number;
  };
};

type BuscarFunctionPayload =
  | { action: "counter" }
  | { action: "start"; payload: BuscarLeadsStartPayload }
  | { action: "status"; runId: string; payload: BuscarLeadsStartPayload };

async function callBuscarFunction<T>(payload: BuscarFunctionPayload): Promise<T> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new Error(sessionError.message || "Nao foi possivel validar a sessao");
  }

  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    throw new Error("Sessao expirada. Faca login novamente.");
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Configuracao do Supabase ausente no frontend");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/buscar-leads`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const backendMessage =
      typeof data?.error === "string"
        ? data.error
        : typeof data?.message === "string"
          ? data.message
          : null;
    throw new Error(backendMessage ?? `Erro ao executar busca (${response.status})`);
  }

  return (data ?? {}) as T;
}

export function useBuscarLeads() {
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [loadingCounter, setLoadingCounter] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<BuscarLeadsStatusResponse["status"] | "idle">("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [results, setResults] = useState<BuscarLeadResult[]>([]);
  const [center, setCenter] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [totals, setTotals] = useState<BuscarLeadsStatusResponse["totals"] | null>(null);
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const activePayloadRef = useRef<BuscarLeadsStartPayload | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const fetchCounter = useCallback(async () => {
    try {
      setLoadingCounter(true);
      const data = await callBuscarFunction<{ total: number }>({ action: "counter" });
      setMonthlyTotal(data.total ?? 0);
    } catch (error: any) {
      console.error("Erro ao carregar contador mensal:", error);
      toast.error("Erro ao carregar contador", { description: error.message });
    } finally {
      setLoadingCounter(false);
    }
  }, []);

  const pollStatus = useCallback(async () => {
    const runId = activeRunIdRef.current;
    const payload = activePayloadRef.current;

    if (!runId || !payload) return;

    try {
      const data = await callBuscarFunction<BuscarLeadsStatusResponse>({
        action: "status",
        runId,
        payload,
      });

      setStatus(data.status);
      setProgress(data.progress ?? 0);
      setMessage(data.message);
      setCenter(data.center ?? null);
      setResults(data.results ?? []);
      setTotals(data.totals ?? null);

      if (data.status === "running" || data.status === "queued") {
        pollingRef.current = setTimeout(() => {
          void pollStatus();
        }, 3000);
        return;
      }

      stopPolling();
      setSubmitting(false);

      if (data.status === "succeeded") {
        if ((data.totals?.inserted ?? 0) > 0) {
          notifyLeadsUpdated();
          void fetchCounter();
        }

        toast.success("Busca concluída", {
          description: `${data.totals?.inserted ?? 0} lead(s) importado(s), ${data.totals?.duplicates ?? 0} duplicata(s) ignorada(s).`,
        });
      } else if (data.status === "failed") {
        toast.error("Busca falhou", { description: data.message ?? "Falha ao processar a busca" });
      }
    } catch (error: any) {
      stopPolling();
      setSubmitting(false);
      setStatus("failed");
      setMessage(error.message);
      console.error("Erro ao consultar status da busca:", error);
      toast.error("Erro ao consultar busca", { description: error.message });
    }
  }, [fetchCounter, stopPolling]);

  const startSearch = useCallback(async (payload: BuscarLeadsStartPayload) => {
    try {
      stopPolling();
      setSubmitting(true);
      setStatus("queued");
      setProgress(5);
      setMessage("Iniciando busca...");
      setResults([]);
      setTotals(null);
      activePayloadRef.current = payload;

      const data = await callBuscarFunction<{
        runId: string;
        status: "queued" | "running";
        progress?: number;
        center?: { lat: number; lng: number; label: string };
      }>({
        action: "start",
        payload,
      });

      activeRunIdRef.current = data.runId;
      setStatus(data.status);
      setProgress(data.progress ?? 5);
      setCenter(data.center ?? null);
      setMessage("Busca em processamento...");

      pollingRef.current = setTimeout(() => {
        void pollStatus();
      }, 1500);
    } catch (error: any) {
      setSubmitting(false);
      setStatus("failed");
      setMessage(error.message);
      console.error("Erro ao iniciar busca:", error);
      toast.error("Erro ao iniciar busca", { description: error.message });
    }
  }, [pollStatus, stopPolling]);

  useEffect(() => {
    void fetchCounter();
    return () => stopPolling();
  }, [fetchCounter, stopPolling]);

  const importedCount = useMemo(() => results.filter((item) => item.isImported).length, [results]);

  return {
    monthlyTotal,
    loadingCounter,
    submitting,
    status,
    progress,
    message,
    results,
    center,
    totals,
    importedCount,
    fetchCounter,
    startSearch,
  };
}
