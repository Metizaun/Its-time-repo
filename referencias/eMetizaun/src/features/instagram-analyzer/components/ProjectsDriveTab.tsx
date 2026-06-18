import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type { ResearchProjectStats } from "@/features/instagram-analyzer/hooks/useInstagramProjects";

type ProjectsDriveTabProps = {
  projects: ResearchProjectStats[];
  loading: boolean;
  onOpenCreateDialog: () => void;
};

type StatusFilter = "all" | "active" | "archived";

export function ProjectsDriveTab({ projects, loading, onOpenCreateDialog }: ProjectsDriveTabProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesStatus = statusFilter === "all" || project.status === statusFilter;
      if (!matchesStatus) return false;

      if (!normalizedQuery) return true;
      return (
        project.name.toLowerCase().includes(normalizedQuery) ||
        project.competitor_username.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [projects, query, statusFilter]);

  return (
    <Card className="h-full min-h-0 overflow-hidden">
      <CardHeader className="border-b pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">Projetos</CardTitle>
          <Button size="sm" onClick={onOpenCreateDialog}>
            <Plus className="mr-1 h-4 w-4" />
            Novo projeto
          </Button>
        </div>

        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_170px]">
          <Input
            placeholder="Buscar por nome ou @concorrente"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value="archived">Arquivados</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <ScrollArea className="h-full">
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {loading ? (
            <div className="col-span-full rounded-lg border border-dashed p-6 text-center">
              <p className="text-sm text-muted-foreground">Carregando projetos...</p>
            </div>
          ) : null}

          {!loading && !filteredProjects.length ? (
            <div className="col-span-full rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm font-medium">Nenhum projeto encontrado</p>
              <p className="text-xs text-muted-foreground">
                Ajuste os filtros ou crie um novo projeto com base no scrape.
              </p>
            </div>
          ) : null}

          {filteredProjects.map((project) => (
            <Link
              key={project.id}
              to={`/instagram-analyzer/projects/${project.id}`}
              className="block rounded-lg border p-3 text-left transition hover:bg-muted/30"
            >
              <div className="overflow-hidden rounded-md border bg-muted/20">
                {project.preview_thumbnail_url ? (
                  <img
                    src={project.preview_thumbnail_url}
                    alt={project.name}
                    className="h-36 w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-36 items-center justify-center text-xs text-muted-foreground">
                    Sem thumbnail
                  </div>
                )}
              </div>

              <div className="mt-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-2 text-sm font-medium">{project.name}</p>
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {project.status}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">@{project.competitor_username}</p>
                <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded bg-muted/40 px-2 py-1">{project.saved_items_count} posts</span>
                  <span className="rounded bg-muted/40 px-2 py-1">{project.documents_count} arquivos</span>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Atualizado em {new Date(project.updated_at).toLocaleDateString("pt-BR")}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </ScrollArea>
    </Card>
  );
}
