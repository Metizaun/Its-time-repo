import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type ResearchScrapeJob = Tables<{ schema: "research" }, "scrape_jobs">;
export type ResearchScrapeItem = Tables<{ schema: "research" }, "scrape_items">;
export type ResearchProject = Tables<{ schema: "research" }, "projects">;
export type ResearchProjectSavedItem = Tables<{ schema: "research" }, "project_saved_items">;
export type ResearchProjectDocument = Tables<{ schema: "research" }, "project_documents">;

export type ResearchProjectInsert = TablesInsert<{ schema: "research" }, "projects">;
export type ResearchProjectUpdate = TablesUpdate<{ schema: "research" }, "projects">;
export type ResearchProjectDocumentInsert = TablesInsert<{ schema: "research" }, "project_documents">;
export type ResearchProjectDocumentUpdate = TablesUpdate<{ schema: "research" }, "project_documents">;

export type InstagramSortBy = "most_liked" | "most_viewed" | "recent";

export type InstagramScrapeFilters = {
  postsLimit: number;
  sortBy: InstagramSortBy;
  onlyPostsNewerThan: string | null;
  includeComments: boolean;
  includeCaptions: boolean;
};

export type ScrapeJobStatus = "queued" | "running" | "succeeded" | "failed";

export type InstagramScrapeStartResult = {
  jobId: string;
  status: ScrapeJobStatus;
  apifyRunId: string;
};

export type InstagramScrapeStatusResult = {
  job: ResearchScrapeJob;
  items: ResearchScrapeItem[];
};

export type InstagramInsightsFocus = "posicionamento" | "conteudo" | "copy" | "formato_video";

export type InstagramInsightsResult = {
  analysisDocumentId: string;
  analysisText: string;
};

export type InstagramScriptImproveResult = {
  improvedScript: string;
  rationale: string;
};

export const DEFAULT_INSTAGRAM_FILTERS: InstagramScrapeFilters = {
  postsLimit: 24,
  sortBy: "recent",
  onlyPostsNewerThan: null,
  includeComments: true,
  includeCaptions: true,
};
