import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import {
  corsHeaders,
  ensureOrgAccess,
  getApifyToken,
  getAuthContext,
  HttpError,
  jsonResponse,
  mapApifyStatus,
  sanitizeInstagramUsername,
  sortScrapeItems,
  toInt,
  toIsoTimestamp,
} from "../_shared/research.ts";

type ScrapeSyncPayload = {
  jobId?: string;
};

type ScrapeJobRow = {
  id: string;
  organization_id: string;
  profile_username: string;
  apify_run_id: string;
  status: string;
  filters: {
    postsLimit?: number;
    sortBy?: "most_liked" | "most_viewed" | "recent";
    onlyPostsNewerThan?: string | null;
    includeComments?: boolean;
    includeCaptions?: boolean;
  } | null;
};

const APIFY_DEFAULT_ITEMS_LIMIT = 24;

function pickFirstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function getObjectValue(source: unknown, path: string) {
  if (!source || typeof source !== "object") return undefined;

  const parts = path.split(".");
  let current: unknown = source;

  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function pickImageFromVersions(source: unknown) {
  const candidates = [
    getObjectValue(source, "image_versions2.candidates"),
    getObjectValue(source, "imageVersions2.candidates"),
    getObjectValue(source, "image_versions.candidates"),
    getObjectValue(source, "images"),
  ];

  for (const candidateList of candidates) {
    if (!Array.isArray(candidateList)) continue;
    for (const item of candidateList) {
      if (!item || typeof item !== "object") continue;
      const url = pickFirstString(
        (item as Record<string, unknown>).url,
        (item as Record<string, unknown>).src,
      );
      if (url) return url;
    }
  }

  return null;
}

function mapApifyItem(
  item: Record<string, unknown>,
  organizationId: string,
  scrapeJobId: string,
  profileUsername: string,
  includeComments: boolean,
  includeCaptions: boolean,
) {
  const shortCode = (item.shortCode || item.shortcode) as string | undefined;
  const permalink =
    (item.url as string | undefined) ||
    (item.postUrl as string | undefined) ||
    (shortCode ? `https://www.instagram.com/p/${shortCode}/` : null);

  if (!permalink) {
    return null;
  }

  const videoUrl =
    pickFirstString(
      item.videoUrl,
      item.video_url,
      item.video_url_hd,
      item.videoPlayUrl,
      item.playback_url,
      getObjectValue(item, "video_versions.0.url"),
      getObjectValue(item, "videoVersions.0.url"),
    );

  const staticImageUrl = pickFirstString(
    item.displayUrl,
    item.display_url,
    item.thumbnailSrc,
    item.thumbnail_url,
    item.imageUrl,
    item.image_url,
    item.coverUrl,
    item.cover_url,
    item.poster_url,
    getObjectValue(item, "cover.url"),
    getObjectValue(item, "thumbnail.url"),
    getObjectValue(item, "media.thumbnail_url"),
    getObjectValue(item, "media.image_url"),
    pickImageFromVersions(item),
  );

  const displayUrl = staticImageUrl;
  const thumbnailUrl = pickFirstString(
    item.thumbnailSrc,
    item.thumbnail_url,
    item.displayUrl,
    item.display_url,
    item.imageUrl,
    item.image_url,
    item.coverUrl,
    item.cover_url,
    displayUrl,
  );

  const type =
    videoUrl || item.isVideo === true || String(item.type || "").toLowerCase().includes("video")
      ? "reel"
      : "photo";

  const comments =
    includeComments
      ? (item.comments ?? item.latestComments ?? null)
      : null;

  const captionRaw =
    (item.caption as string | undefined) ||
    (item.captionText as string | undefined) ||
    "";

  const caption = includeCaptions ? captionRaw : null;

  const postTimestamp =
    toIsoTimestamp(item.timestamp) ||
    toIsoTimestamp(item.takenAtTimestamp) ||
    toIsoTimestamp(item.createdAt);

  return {
    organization_id: organizationId,
    scrape_job_id: scrapeJobId,
    profile_username: sanitizeInstagramUsername(profileUsername),
    platform_post_id: (item.id as string | undefined) || shortCode || null,
    type,
    permalink,
    thumbnail_url: thumbnailUrl,
    display_url: displayUrl,
    video_url: videoUrl,
    caption,
    likes_count: toInt(item.likesCount ?? item.likes),
    comments_count: toInt(item.commentsCount ?? item.comments_count),
    views_count: toInt(item.videoViewCount ?? item.videoPlayCount ?? item.viewsCount ?? item.playCount),
    posted_at: postTimestamp,
    comments,
    raw_metrics: item,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as ScrapeSyncPayload;
    const jobId = body.jobId;
    if (!jobId) {
      throw new HttpError(400, "jobId is required");
    }

    const auth = await getAuthContext(req);
    const apifyToken = getApifyToken();

    const { data: job, error: jobError } = await auth.supabaseAdmin
      .schema("research")
      .from("scrape_jobs")
      .select("id, organization_id, profile_username, apify_run_id, status, filters")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      throw new HttpError(404, "Scrape job not found");
    }

    const typedJob = job as ScrapeJobRow;
    ensureOrgAccess(auth.organizationIds, typedJob.organization_id);

    const runResponse = await fetch(
      `https://api.apify.com/v2/actor-runs/${typedJob.apify_run_id}?token=${apifyToken}`,
    );

    if (!runResponse.ok) {
      const errorText = await runResponse.text();
      throw new HttpError(502, `Failed to read Apify run: ${errorText}`);
    }

    const runData = await runResponse.json();
    const run = runData?.data as Record<string, unknown> | undefined;
    const mappedStatus = mapApifyStatus(run?.status as string | undefined);

    const statusPatch: Record<string, unknown> = {
      status: mappedStatus,
      error: mappedStatus === "failed" ? String(run?.statusMessage || "Apify run failed") : null,
    };

    await auth.supabaseAdmin
      .schema("research")
      .from("scrape_jobs")
      .update(statusPatch)
      .eq("id", typedJob.id);

    if (mappedStatus === "failed") {
      return jsonResponse(200, {
        jobId: typedJob.id,
        status: "failed",
        imported: 0,
      });
    }

    if (mappedStatus !== "succeeded") {
      return jsonResponse(200, {
        jobId: typedJob.id,
        status: mappedStatus,
        imported: 0,
      });
    }

    const datasetId = run?.defaultDatasetId as string | undefined;
    if (!datasetId) {
      throw new HttpError(502, "Apify run has no dataset id");
    }

    const postsLimit = Math.min(
      50,
      Math.max(
        1,
        Number(typedJob.filters?.postsLimit || APIFY_DEFAULT_ITEMS_LIMIT),
      ),
    );
    const includeComments = Boolean(typedJob.filters?.includeComments);
    const includeCaptions = typedJob.filters?.includeCaptions !== false;
    const sortBy = typedJob.filters?.sortBy || "recent";

    const itemsResponse = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}&clean=true&format=json&limit=${postsLimit}`,
    );

    if (!itemsResponse.ok) {
      const errorText = await itemsResponse.text();
      throw new HttpError(502, `Failed to load Apify dataset: ${errorText}`);
    }

    const datasetItems = (await itemsResponse.json()) as Array<Record<string, unknown>>;
    const mappedItems = datasetItems
      .map((item) =>
        mapApifyItem(
          item,
          typedJob.organization_id,
          typedJob.id,
          typedJob.profile_username,
          includeComments,
          includeCaptions,
        ),
      )
      .filter(Boolean) as Array<Record<string, unknown>>;

    const sortedItems = sortScrapeItems(
      mappedItems as Array<{
        likes_count: number | null;
        views_count: number | null;
        posted_at: string | null;
      }>,
      sortBy,
    );

    if (sortedItems.length) {
      const { error: upsertError } = await auth.supabaseAdmin
        .schema("research")
        .from("scrape_items")
        .upsert(sortedItems, {
          onConflict: "organization_id,scrape_job_id,permalink",
        });

      if (upsertError) {
        throw new HttpError(500, upsertError.message || "Failed to persist scrape items");
      }
    }

    await auth.supabaseAdmin
      .schema("research")
      .from("scrape_jobs")
      .update({
        status: "succeeded",
        result_count: sortedItems.length,
        error: null,
      })
      .eq("id", typedJob.id);

    return jsonResponse(200, {
      jobId: typedJob.id,
      status: "succeeded",
      imported: sortedItems.length,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse(error.status, { error: error.message });
    }

    const message = error instanceof Error ? error.message : "internal_error";
    return jsonResponse(500, { error: message });
  }
});
