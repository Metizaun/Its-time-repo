import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOrganizationContext } from "@/hooks/useOrganizationContext";

import type {
  ResearchProject,
  ResearchProjectDocument,
  ResearchScrapeItem,
} from "@/features/instagram-analyzer/types";

export type ResearchProjectStats = ResearchProject & {
  saved_items_count: number;
  documents_count: number;
  preview_thumbnail_url: string | null;
};

export type ResearchSavedItemView = {
  relationId: string;
  selectedAt: string;
  selectedByUserId: string;
  item: ResearchScrapeItem;
};

export type ResearchProjectDetail = {
  project: ResearchProject;
  savedItems: ResearchSavedItemView[];
  documents: ResearchProjectDocument[];
};

export function useInstagramProjects() {
  const { user } = useAuth();
  const { currentOrganization } = useOrganizationContext();

  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    if (!currentOrganization?.id) {
      setProjects([]);
      return;
    }

    setLoading(true);
    try {
      const { data, error: fetchError } = await supabase
        .schema("research")
        .from("projects")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("updated_at", { ascending: false });

      if (fetchError) {
        throw fetchError;
      }

      setProjects((data || []) as ResearchProject[]);
      setError(null);
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : "Failed to fetch projects";
      setError(message);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, [currentOrganization?.id]);

  const fetchProjectsWithStats = useCallback(async (): Promise<ResearchProjectStats[]> => {
    if (!currentOrganization?.id) {
      return [];
    }

    const { data: projectRows, error: projectError } = await supabase
      .schema("research")
      .from("projects")
      .select("*")
      .eq("organization_id", currentOrganization.id)
      .order("updated_at", { ascending: false });

    if (projectError) {
      throw projectError;
    }

    const projectsList = (projectRows || []) as ResearchProject[];
    if (!projectsList.length) {
      return [];
    }

    const projectIds = projectsList.map((project) => project.id);

    const [{ data: savedRows, error: savedError }, { data: documentRows, error: documentError }] = await Promise.all([
      supabase
        .schema("research")
        .from("project_saved_items")
        .select("project_id, scrape_item_id, created_at")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false })
        .in("project_id", projectIds),
      supabase
        .schema("research")
        .from("project_documents")
        .select("project_id")
        .eq("organization_id", currentOrganization.id)
        .in("project_id", projectIds),
    ]);

    if (savedError) {
      throw savedError;
    }
    if (documentError) {
      throw documentError;
    }

    const previewItemIds = [...new Set((savedRows || []).map((row) => row.scrape_item_id))];
    let previewItemsById = new Map<string, { thumbnail_url: string | null; display_url: string | null }>();

    if (previewItemIds.length) {
      const { data: previewRows, error: previewError } = await supabase
        .schema("research")
        .from("scrape_items")
        .select("id, thumbnail_url, display_url")
        .eq("organization_id", currentOrganization.id)
        .in("id", previewItemIds);

      if (previewError) {
        throw previewError;
      }

      previewItemsById = new Map(
        (previewRows || []).map((row) => [
          row.id,
          {
            thumbnail_url: row.thumbnail_url,
            display_url: row.display_url,
          },
        ]),
      );
    }

    const savedCountMap = new Map<string, number>();
    const previewByProjectMap = new Map<string, string>();
    for (const row of savedRows || []) {
      const current = savedCountMap.get(row.project_id) || 0;
      savedCountMap.set(row.project_id, current + 1);

      if (!previewByProjectMap.has(row.project_id)) {
        const preview = previewItemsById.get(row.scrape_item_id);
        const previewUrl = preview?.thumbnail_url || preview?.display_url;
        if (previewUrl) {
          previewByProjectMap.set(row.project_id, previewUrl);
        }
      }
    }

    const documentsCountMap = new Map<string, number>();
    for (const row of documentRows || []) {
      const current = documentsCountMap.get(row.project_id) || 0;
      documentsCountMap.set(row.project_id, current + 1);
    }

    return projectsList.map((project) => ({
      ...project,
      saved_items_count: savedCountMap.get(project.id) || 0,
      documents_count: documentsCountMap.get(project.id) || 0,
      preview_thumbnail_url: previewByProjectMap.get(project.id) || null,
    }));
  }, [currentOrganization?.id]);

  const createProject = useCallback(
    async (payload: { name: string; competitorUsername?: string; description?: string | null }) => {
      if (!currentOrganization?.id || !user?.id) {
        throw new Error("User not authenticated or organization not selected");
      }

      let competitorSource = payload.competitorUsername?.trim() || "";

      if (!competitorSource) {
        const { data: latestJob, error: latestJobError } = await supabase
          .schema("research")
          .from("scrape_jobs")
          .select("profile_username")
          .eq("organization_id", currentOrganization.id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestJobError) {
          throw latestJobError;
        }

        competitorSource = latestJob?.profile_username?.trim() || "";
      }

      const normalizedUsername = competitorSource
        .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
        .replace(/^@/, "")
        .replace(/\/$/, "")
        .toLowerCase()
        .trim();

      if (!normalizedUsername) {
        throw new Error("Competitor username not found from scrape context");
      }

      const { data, error: insertError } = await supabase
        .schema("research")
        .from("projects")
        .insert({
          organization_id: currentOrganization.id,
          created_by_user_id: user.id,
          name: payload.name.trim(),
          competitor_username: normalizedUsername,
          description: payload.description || null,
          status: "active",
        })
        .select("*")
        .single();

      if (insertError || !data) {
        throw insertError || new Error("Failed to create project");
      }

      await fetchProjects();
      return data as ResearchProject;
    },
    [currentOrganization?.id, fetchProjects, user?.id],
  );

  const updateProject = useCallback(
    async (projectId: string, updates: Partial<Pick<ResearchProject, "name" | "description" | "status">>) => {
      if (!currentOrganization?.id) {
        throw new Error("Organization not selected");
      }

      const { data, error: updateError } = await supabase
        .schema("research")
        .from("projects")
        .update(updates)
        .eq("organization_id", currentOrganization.id)
        .eq("id", projectId)
        .select("*")
        .single();

      if (updateError || !data) {
        throw updateError || new Error("Failed to update project");
      }

      await fetchProjects();
      return data as ResearchProject;
    },
    [currentOrganization?.id, fetchProjects],
  );

  const saveItemsToProject = useCallback(
    async (projectId: string, scrapeItemIds: string[]) => {
      if (!currentOrganization?.id || !user?.id) {
        throw new Error("User not authenticated or organization not selected");
      }

      if (!scrapeItemIds.length) return;

      const rows = [...new Set(scrapeItemIds)].map((scrapeItemId) => ({
        organization_id: currentOrganization.id,
        project_id: projectId,
        scrape_item_id: scrapeItemId,
        selected_by_user_id: user.id,
      }));

      const { error: upsertError } = await supabase
        .schema("research")
        .from("project_saved_items")
        .upsert(rows, { onConflict: "project_id,scrape_item_id" });

      if (upsertError) {
        throw upsertError;
      }
    },
    [currentOrganization?.id, user?.id],
  );

  const fetchProjectDetail = useCallback(
    async (projectId: string): Promise<ResearchProjectDetail> => {
      if (!currentOrganization?.id) {
        throw new Error("Organization not selected");
      }

      const [{ data: projectRow, error: projectError }, { data: savedRows, error: savedError }, { data: documentRows, error: documentError }] =
        await Promise.all([
          supabase
            .schema("research")
            .from("projects")
            .select("*")
            .eq("organization_id", currentOrganization.id)
            .eq("id", projectId)
            .single(),
          supabase
            .schema("research")
            .from("project_saved_items")
            .select("*")
            .eq("organization_id", currentOrganization.id)
            .eq("project_id", projectId)
            .order("created_at", { ascending: false }),
          supabase
            .schema("research")
            .from("project_documents")
            .select("*")
            .eq("organization_id", currentOrganization.id)
            .eq("project_id", projectId)
            .order("updated_at", { ascending: false }),
        ]);

      if (projectError || !projectRow) {
        throw projectError || new Error("Project not found");
      }
      if (savedError) {
        throw savedError;
      }
      if (documentError) {
        throw documentError;
      }

      const scrapeItemIds = (savedRows || []).map((row) => row.scrape_item_id);
      let scrapeItemsById = new Map<string, ResearchScrapeItem>();

      if (scrapeItemIds.length) {
        const { data: scrapeRows, error: scrapeError } = await supabase
          .schema("research")
          .from("scrape_items")
          .select("*")
          .in("id", scrapeItemIds);

        if (scrapeError) {
          throw scrapeError;
        }

        scrapeItemsById = new Map(
          ((scrapeRows || []) as ResearchScrapeItem[]).map((item) => [item.id, item]),
        );
      }

      const savedItems: ResearchSavedItemView[] = (savedRows || [])
        .map((row) => {
          const item = scrapeItemsById.get(row.scrape_item_id);
          if (!item) return null;
          return {
            relationId: row.id,
            selectedAt: row.created_at,
            selectedByUserId: row.selected_by_user_id,
            item,
          };
        })
        .filter(Boolean) as ResearchSavedItemView[];

      return {
        project: projectRow as ResearchProject,
        savedItems,
        documents: (documentRows || []) as ResearchProjectDocument[],
      };
    },
    [currentOrganization?.id],
  );

  const createDocument = useCallback(
    async (projectId: string, payload: { title: string; docType: "analysis" | "notes" | "script"; contentMd?: string }) => {
      if (!currentOrganization?.id || !user?.id) {
        throw new Error("User not authenticated or organization not selected");
      }

      const { data, error: insertError } = await supabase
        .schema("research")
        .from("project_documents")
        .insert({
          organization_id: currentOrganization.id,
          project_id: projectId,
          title: payload.title,
          doc_type: payload.docType,
          content_md: payload.contentMd || "",
          created_by_user_id: user.id,
        })
        .select("*")
        .single();

      if (insertError || !data) {
        throw insertError || new Error("Failed to create document");
      }

      return data as ResearchProjectDocument;
    },
    [currentOrganization?.id, user?.id],
  );

  const updateDocument = useCallback(
    async (documentId: string, updates: Partial<Pick<ResearchProjectDocument, "title" | "content_md">>) => {
      const { data, error: updateError } = await supabase
        .schema("research")
        .from("project_documents")
        .update(updates)
        .eq("id", documentId)
        .select("*")
        .single();

      if (updateError || !data) {
        throw updateError || new Error("Failed to update document");
      }

      return data as ResearchProjectDocument;
    },
    [],
  );

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (!currentOrganization?.id) {
      return;
    }

    const channel = supabase
      .channel(`research-projects-${currentOrganization.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "research",
          table: "projects",
          filter: `organization_id=eq.${currentOrganization.id}`,
        },
        () => {
          void fetchProjects();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentOrganization?.id, fetchProjects]);

  return {
    projects,
    loading,
    error,
    fetchProjects,
    fetchProjectsWithStats,
    createProject,
    updateProject,
    saveItemsToProject,
    fetchProjectDetail,
    createDocument,
    updateDocument,
  };
}
