import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import {
  corsHeaders,
  ensureOrgAccess,
  getApifyToken,
  getAuthContext,
  HttpError,
  jsonResponse,
  mapApifyStatus,
  sortScrapeItems,
} from "../_shared/research.ts";

type ScrapeStatusPayload = {
  jobId?: string;
};

type ScrapeJobRow = {
  id: string;
  organization_id: string;
  profile_username: string;
  apify_run_id: string;
  status: string;
  result_count: number;
  filters: {
    postsLimit?: number;
    sortBy?: "most_liked" | "most_viewed" | "recent";
  } | null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as ScrapeStatusPayload;
    const jobId = body.jobId;
    if (!jobId) {
      throw new HttpError(400, "jobId is required");
    }

    const auth = await getAuthContext(req);

    const { data: jobRow, error: jobError } = await auth.supabaseAdmin
      .schema("research")
      .from("scrape_jobs")
      .select("id, organization_id, profile_username, apify_run_id, status, result_count, filters, error, created_at, updated_at")
      .eq("id", jobId)
      .single();

    if (jobError || !jobRow) {
      throw new HttpError(404, "Scrape job not found");
    }

    const job = jobRow as ScrapeJobRow & Record<string, unknown>;
    ensureOrgAccess(auth.organizationIds, job.organization_id);

    const apifyToken = Deno.env.get("APIFY_TOKEN")?.trim() ? getApifyToken() : null;
    if (apifyToken && job.apify_run_id && job.status !== "succeeded" && job.status !== "failed") {
      const runResponse = await fetch(
        `https://api.apify.com/v2/actor-runs/${job.apify_run_id}?token=${apifyToken}`,
      );

      if (runResponse.ok) {
        const runData = await runResponse.json();
        const run = runData?.data as Record<string, unknown> | undefined;
        const mappedStatus = mapApifyStatus(run?.status as string | undefined);

        if (mappedStatus !== job.status) {
          await auth.supabaseAdmin
            .schema("research")
            .from("scrape_jobs")
            .update({
              status: mappedStatus,
              error: mappedStatus === "failed" ? String(run?.statusMessage || "Apify run failed") : null,
            })
            .eq("id", job.id);

          job.status = mappedStatus;
        }
      }
    }

    const limit = Math.min(50, Math.max(1, Number(job.filters?.postsLimit || 24)));

    const { data: itemRows, error: itemsError } = await auth.supabaseAdmin
      .schema("research")
      .from("scrape_items")
      .select("*")
      .eq("organization_id", job.organization_id)
      .eq("scrape_job_id", job.id)
      .limit(limit);

    if (itemsError) {
      throw new HttpError(500, itemsError.message || "Failed to load scrape items");
    }

    const sortBy = job.filters?.sortBy || "recent";
    const sortedItems = sortScrapeItems(
      ((itemRows || []) as Array<Record<string, unknown>>).map((item) => ({
        ...item,
        likes_count: typeof item.likes_count === "number" ? item.likes_count : null,
        views_count: typeof item.views_count === "number" ? item.views_count : null,
        posted_at: typeof item.posted_at === "string" ? item.posted_at : null,
      })),
      sortBy,
    );

    return jsonResponse(200, {
      job: {
        ...jobRow,
        status: job.status,
      },
      items: sortedItems,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse(error.status, { error: error.message });
    }

    const message = error instanceof Error ? error.message : "internal_error";
    return jsonResponse(500, { error: message });
  }
});
