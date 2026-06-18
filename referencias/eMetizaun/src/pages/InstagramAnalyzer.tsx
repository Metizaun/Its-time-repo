import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, MessageSquare } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useToast } from "@/hooks/use-toast";

import { ScrapeFiltersPanel } from "@/features/instagram-analyzer/components/ScrapeFiltersPanel";
import { ScrapeResultsGrid } from "@/features/instagram-analyzer/components/ScrapeResultsGrid";
import { InstagramAIFab } from "@/features/instagram-analyzer/components/InstagramAIFab";
import { CreateProjectFromScrapeDialog } from "@/features/instagram-analyzer/components/CreateProjectFromScrapeDialog";
import { ProjectsDriveTab } from "@/features/instagram-analyzer/components/ProjectsDriveTab";
import { useInstagramScrape } from "@/features/instagram-analyzer/hooks/useInstagramScrape";
import {
  useInstagramProjects,
  type ResearchProjectStats,
} from "@/features/instagram-analyzer/hooks/useInstagramProjects";
import { useInstagramInsights } from "@/features/instagram-analyzer/hooks/useInstagramInsights";
import {
  DEFAULT_INSTAGRAM_FILTERS,
  type InstagramScrapeFilters,
} from "@/features/instagram-analyzer/types";

function normalizeInstagramUsername(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/$/, "")
    .split(/[/?#]/)[0]
    .trim()
    .toLowerCase();
}

export default function InstagramAnalyzer() {
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<"scrap" | "projects">("scrap");
  const [profileUsername, setProfileUsername] = useState("");
  const [filters, setFilters] = useState<InstagramScrapeFilters>(DEFAULT_INSTAGRAM_FILTERS);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [projectStats, setProjectStats] = useState<ResearchProjectStats[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);

  const {
    job,
    items,
    loading: scrapeLoading,
    syncing,
    error: scrapeError,
    startScrape,
  } = useInstagramScrape();

  const {
    projects,
    loading: projectsLoading,
    createProject,
    saveItemsToProject,
    fetchProjectsWithStats,
  } = useInstagramProjects();
  const { generateInsights } = useInstagramInsights();

  const selectedItemArray = useMemo(() => Array.from(selectedItemIds), [selectedItemIds]);

  const scrapeCompetitorUsername = useMemo(() => {
    const fromJob = normalizeInstagramUsername(job?.profile_username || "");
    if (fromJob) return fromJob;
    return normalizeInstagramUsername(profileUsername);
  }, [job?.profile_username, profileUsername]);

  const hasScrapeContext = Boolean(scrapeCompetitorUsername) && items.length > 0;

  const loadProjectStats = useCallback(async () => {
    try {
      const stats = await fetchProjectsWithStats();
      setProjectStats(stats);
    } catch (error) {
      toast({
        title: "Falha ao carregar projetos",
        description: error instanceof Error ? error.message : "Nao foi possivel carregar estatisticas de projetos.",
        variant: "destructive",
      });
    }
  }, [fetchProjectsWithStats, toast]);

  useEffect(() => {
    void loadProjectStats();
  }, [loadProjectStats, projects.length]);

  useEffect(() => {
    if (!scrapeError) {
      return;
    }

    toast({
      title: "Erro no scrape",
      description: scrapeError,
      variant: "destructive",
    });
  }, [scrapeError, toast]);

  const handleStartScrape = async () => {
    try {
      setSelectedItemIds(new Set());
      await startScrape(profileUsername, filters);
      toast({
        title: "Scrape iniciado",
        description: "A coleta foi iniciada. Aguarde a barra de progresso concluir.",
      });
    } catch (error) {
      toast({
        title: "Falha ao iniciar scrape",
        description: error instanceof Error ? error.message : "Nao foi possivel iniciar a coleta.",
        variant: "destructive",
      });
    }
  };

  const handleToggleSelection = (itemId: string, selected: boolean) => {
    setSelectedItemIds((previous) => {
      const next = new Set(previous);
      if (selected) {
        next.add(itemId);
      } else {
        next.delete(itemId);
      }
      return next;
    });
  };

  const handleCreateProjectFromScrape = async (projectName: string) => {
    if (!hasScrapeContext) {
      throw new Error("Scrape context not found");
    }

    setCreatingProject(true);
    try {
      let initialAnalysisFailed = false;
      const created = await createProject({
        name: projectName,
        competitorUsername: scrapeCompetitorUsername,
      });

      const fallbackAllIds = items.map((item) => item.id);
      const idsToSave = selectedItemArray.length ? selectedItemArray : fallbackAllIds;

      if (!idsToSave.length) {
        throw new Error("Nenhum item disponivel para salvar no projeto.");
      }

      await saveItemsToProject(created.id, idsToSave);

      try {
        await generateInsights({
          projectId: created.id,
          focus: "posicionamento",
        });
      } catch {
        initialAnalysisFailed = true;
      }

      await loadProjectStats();

      setSelectedItemIds(new Set());
      setCreateDialogOpen(false);
      setActiveTab("projects");

      if (initialAnalysisFailed) {
        toast({
          title: "Projeto criado com ressalva",
          description: `${idsToSave.length} item(ns) foram salvos, mas a analise inicial falhou. Gere novamente na aba Arquivos do projeto.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Projeto criado",
          description: `${idsToSave.length} item(ns) foram salvos e a analise inicial foi gerada.`,
        });
      }
    } catch (error) {
      toast({
        title: "Falha ao criar projeto",
        description: error instanceof Error ? error.message : "Nao foi possivel criar o projeto.",
        variant: "destructive",
      });
    } finally {
      setCreatingProject(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={activeTab === "scrap" ? "default" : "outline"}
          onClick={() => setActiveTab("scrap")}
          aria-pressed={activeTab === "scrap"}
        >
          Scrap
        </Button>

        <Button
          type="button"
          size="sm"
          variant={activeTab === "projects" ? "default" : "outline"}
          onClick={() => setActiveTab("projects")}
          aria-pressed={activeTab === "projects"}
        >
          Projetos
        </Button>

        <Button asChild size="sm" variant="outline">
          <Link to="/instagram-analyzer/chat">
            <MessageSquare className="mr-1 h-4 w-4" />
            Chat
          </Link>
        </Button>

        <Button asChild size="sm" variant="default">
          <Link to="/create">
            <Bot className="mr-1 h-4 w-4" />
            Criar conteudo
          </Link>
        </Button>
      </div>

      {activeTab === "scrap" ? (
        <div className="h-full min-h-0">
          <div className="h-full min-h-0 overflow-hidden rounded-lg border bg-background">
            <ResizablePanelGroup direction="horizontal" className="h-full min-h-0 w-full">
              <ResizablePanel defaultSize={22} minSize={18}>
                <ScrapeFiltersPanel
                  profileUsername={profileUsername}
                  filters={filters}
                  loading={scrapeLoading}
                  syncing={syncing}
                  job={job}
                  onProfileUsernameChange={setProfileUsername}
                  onFiltersChange={(updates) => setFilters((current) => ({ ...current, ...updates }))}
                  onStartScrape={handleStartScrape}
                />
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel defaultSize={78} minSize={40}>
                <div className="relative h-full min-h-0">
                  <ScrapeResultsGrid
                    items={items}
                    loading={scrapeLoading || syncing}
                    selectedIds={selectedItemIds}
                    onToggleSelection={handleToggleSelection}
                  />
                  <InstagramAIFab
                    visible={items.length > 0}
                    disabled={!hasScrapeContext}
                    onClick={() => setCreateDialogOpen(true)}
                  />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </div>
      ) : null}

      {activeTab === "projects" ? (
        <div className="h-full min-h-0">
          <ProjectsDriveTab
            projects={projectStats}
            loading={projectsLoading}
            onOpenCreateDialog={() => setCreateDialogOpen(true)}
          />
        </div>
      ) : null}

      <CreateProjectFromScrapeDialog
        open={createDialogOpen}
        saving={creatingProject}
        hasScrapeContext={hasScrapeContext}
        competitorUsername={scrapeCompetitorUsername || null}
        onOpenChange={setCreateDialogOpen}
        onSubmit={handleCreateProjectFromScrape}
      />
    </div>
  );
}
