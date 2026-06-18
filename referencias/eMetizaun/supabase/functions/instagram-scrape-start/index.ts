import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import {
  corsHeaders,
  ensureOrgAccess,
  getApifyActorReferences,
  getApifyToken,
  getAuthContext,
  HttpError,
  jsonResponse,
  mapApifyStatus,
  sanitizeInstagramUsername,
} from "../_shared/research.ts";

type ScrapeStartPayload = {
  profileUsername?: string;
  organizationId?: string;
  filters?: {
    postsLimit?: number;
    sortBy?: "most_liked" | "most_viewed" | "recent";
    onlyPostsNewerThan?: string | null;
    includeComments?: boolean;
    includeCaptions?: boolean;
  };
};

type ApifyRunStartResult = {
  runId: string;
  status: string;
  actorRef: string;
};

async function startApifyRun(
  actorReferences: string[],
  apifyToken: string,
  actorInput: Record<string, unknown>,
): Promise<ApifyRunStartResult> {
  const errors: string[] = [];

  for (const actorRef of actorReferences) {
    const response = await fetch(
      `https://api.apify.com/v2/acts/${actorRef}/runs?token=${apifyToken}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(actorInput),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      errors.push(`${actorRef}: ${response.status} ${errorText}`);
      continue;
    }

    const data = await response.json();
    const runId = data?.data?.id as string | undefined;
    const status = data?.data?.status as string | undefined;

    if (!runId) {
      errors.push(`${actorRef}: response missing run id`);
      continue;
    }

    return {
      runId,
      status: mapApifyStatus(status),
      actorRef,
    };
  }

  throw new HttpError(
    502,
    `Failed to start Apify run. Attempted actors: ${errors.join(" | ")}`,
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as ScrapeStartPayload;
    const rawUsername = typeof body.profileUsername === "string" ? body.profileUsername : "";
    const profileUsername = sanitizeInstagramUsername(rawUsername);

    if (!profileUsername) {
      throw new HttpError(400, "profileUsername is required");
    }

    const postsLimit = Math.min(50, Math.max(1, Number(body.filters?.postsLimit || 24)));
    const sortBy = body.filters?.sortBy || "recent";
    const onlyPostsNewerThanRaw = typeof body.filters?.onlyPostsNewerThan === "string"
      ? body.filters.onlyPostsNewerThan.trim()
      : "";
    const onlyPostsNewerThan = onlyPostsNewerThanRaw || null;
    const includeComments = Boolean(body.filters?.includeComments);
    const includeCaptions = body.filters?.includeCaptions !== false;

    const auth = await getAuthContext(req);
    const organizationId = body.organizationId || auth.defaultOrganizationId;
    ensureOrgAccess(auth.organizationIds, organizationId);

    const apifyToken = getApifyToken();
    const actorReferences = getApifyActorReferences();
    if (!actorReferences.length) {
      throw new HttpError(500, "No valid Apify actor reference configured");
    }

    const actorInput = {
      directUrls: [`https://www.instagram.com/${profileUsername}/`],
      resultsType: "posts",
      resultsLimit: postsLimit,
      addParentData: false,
      ...(onlyPostsNewerThan ? { onlyPostsNewerThan } : {}),
    };
    const apifyRun = await startApifyRun(actorReferences, apifyToken, actorInput);

    const filters = {
      postsLimit,
      sortBy,
      onlyPostsNewerThan,
      includeComments,
      includeCaptions,
      actorRef: apifyRun.actorRef,
    };

    const { data: createdJob, error: insertError } = await auth.supabaseAdmin
      .schema("research")
      .from("scrape_jobs")
      .insert({
        organization_id: organizationId,
        created_by_user_id: auth.userId,
        profile_username: profileUsername,
        apify_run_id: apifyRun.runId,
        status: apifyRun.status,
        filters,
      })
      .select("id, status, apify_run_id")
      .single();

    if (insertError || !createdJob) {
      throw new HttpError(500, insertError?.message || "Failed to create scrape job");
    }

    return jsonResponse(200, {
      jobId: createdJob.id,
      status: createdJob.status,
      apifyRunId: createdJob.apify_run_id,
      actorRef: apifyRun.actorRef,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse(error.status, { error: error.message });
    }

    const message = error instanceof Error ? error.message : "internal_error";
    return jsonResponse(500, { error: message });
  }
});
