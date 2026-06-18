import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useOrganizationContext } from "@/hooks/useOrganizationContext";

import type {
  InstagramScrapeFilters,
  InstagramScrapeStartResult,
  InstagramScrapeStatusResult,
  ResearchScrapeItem,
  ResearchScrapeJob,
} from "@/features/instagram-analyzer/types";
import { DEFAULT_INSTAGRAM_FILTERS } from "@/features/instagram-analyzer/types";

async function getFunctionsAuthHeaders() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new Error(error.message || "Falha ao obter sessao");
  }

  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error("Sessao expirada. Faca login novamente.");
  }

  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

async function getEdgeFunctionErrorMessage(error: unknown, fallback: string) {
  if (!error) return fallback;

  const maybeError = error as {
    message?: string;
    context?: {
      clone?: () => { json?: () => Promise<unknown> };
      json?: () => Promise<unknown>;
    };
  };

  const context = maybeError.context;
  if (context) {
    try {
      const payload = context.clone
        ? await context.clone().json?.()
        : await context.json?.();

      if (payload && typeof payload === "object") {
        const candidate =
          (payload as { error?: unknown; message?: unknown }).error ??
          (payload as { message?: unknown }).message;

        if (typeof candidate === "string" && candidate.trim()) {
          return candidate;
        }
      }
    } catch {
      // Ignore payload parse issues and fallback below.
    }
  }

  if (typeof maybeError.message === "string" && maybeError.message.trim()) {
    return maybeError.message;
  }

  return fallback;
}

export function useInstagramScrape() {
  const { currentOrganization } = useOrganizationContext();

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [job, setJob] = useState<ResearchScrapeJob | null>(null);
  const [items, setItems] = useState<ResearchScrapeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const syncedJobsRef = useRef(new Set<string>());

  const isRunning = useMemo(() => job?.status === "queued" || job?.status === "running", [job?.status]);

  const fetchStatus = useCallback(
    async (jobId?: string) => {
      const targetJobId = jobId || activeJobId;
      if (!targetJobId) {
        return null;
      }

      const { data, error: invokeError } = await supabase.functions.invoke<InstagramScrapeStatusResult>(
        "instagram-scrape-status",
        {
          headers: await getFunctionsAuthHeaders(),
          body: {
            jobId: targetJobId,
          },
        },
      );

      if (invokeError) {
        const message = await getEdgeFunctionErrorMessage(invokeError, "Failed to load scrape status");
        throw new Error(message);
      }

      if (!data?.job) {
        throw new Error("Invalid scrape status payload");
      }

      setJob(data.job);
      setItems(data.items || []);
      setError(null);
      return data;
    },
    [activeJobId],
  );

  const syncJob = useCallback(
    async (jobId?: string) => {
      const targetJobId = jobId || activeJobId;
      if (!targetJobId) return;

      setSyncing(true);
      try {
        const { error: invokeError } = await supabase.functions.invoke("instagram-scrape-sync", {
          headers: await getFunctionsAuthHeaders(),
          body: { jobId: targetJobId },
        });

        if (invokeError) {
          const message = await getEdgeFunctionErrorMessage(invokeError, "Failed to sync scrape data");
          throw new Error(message);
        }

        await fetchStatus(targetJobId);
      } finally {
        setSyncing(false);
      }
    },
    [activeJobId, fetchStatus],
  );

  const startScrape = useCallback(
    async (profileUsername: string, filters?: Partial<InstagramScrapeFilters>) => {
      if (!currentOrganization?.id) {
        throw new Error("Organization not selected");
      }

      setLoading(true);
      setError(null);

      try {
        const mergedFilters = {
          ...DEFAULT_INSTAGRAM_FILTERS,
          ...filters,
        };

        const { data, error: invokeError } = await supabase.functions.invoke<InstagramScrapeStartResult>(
          "instagram-scrape-start",
          {
            headers: await getFunctionsAuthHeaders(),
            body: {
              profileUsername,
              organizationId: currentOrganization.id,
              filters: mergedFilters,
            },
          },
        );

        if (invokeError) {
          const message = await getEdgeFunctionErrorMessage(invokeError, "Failed to start scrape");
          throw new Error(message);
        }

        if (!data?.jobId) {
          throw new Error("Invalid scrape start payload");
        }

        setActiveJobId(data.jobId);
        syncedJobsRef.current.delete(data.jobId);
        await fetchStatus(data.jobId);
        return data;
      } catch (startError) {
        const message = startError instanceof Error ? startError.message : "Failed to start scrape";
        setError(message);
        throw startError;
      } finally {
        setLoading(false);
      }
    },
    [currentOrganization?.id, fetchStatus],
  );

  const clearScrape = useCallback(() => {
    setActiveJobId(null);
    setJob(null);
    setItems([]);
    setError(null);
  }, []);

  useEffect(() => {
    if (!activeJobId) {
      return;
    }

    if (!isRunning) {
      return;
    }

    const interval = window.setInterval(() => {
      void fetchStatus(activeJobId);
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, [activeJobId, fetchStatus, isRunning]);

  useEffect(() => {
    if (!job?.id) {
      return;
    }

    if (job.status !== "succeeded") {
      return;
    }

    if (items.length > 0) {
      return;
    }

    if (syncedJobsRef.current.has(job.id)) {
      return;
    }

    syncedJobsRef.current.add(job.id);
    void syncJob(job.id);
  }, [items.length, job?.id, job?.status, syncJob]);

  return {
    activeJobId,
    job,
    items,
    loading,
    syncing,
    isRunning,
    error,
    startScrape,
    syncJob,
    fetchStatus,
    clearScrape,
    setActiveJobId,
  };
}
