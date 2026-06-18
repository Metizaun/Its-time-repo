import { Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type { InstagramScrapeFilters, ResearchScrapeJob } from "@/features/instagram-analyzer/types";

type ScrapeFiltersPanelProps = {
  profileUsername: string;
  filters: InstagramScrapeFilters;
  loading: boolean;
  syncing: boolean;
  job: ResearchScrapeJob | null;
  onProfileUsernameChange: (value: string) => void;
  onFiltersChange: (updates: Partial<InstagramScrapeFilters>) => void;
  onStartScrape: () => Promise<void>;
};

export function ScrapeFiltersPanel({
  profileUsername,
  filters,
  loading,
  syncing,
  job,
  onProfileUsernameChange,
  onFiltersChange,
  onStartScrape,
}: ScrapeFiltersPanelProps) {
  const isBusy = loading || syncing;
  const progressValue = (() => {
    if (loading) return 12;
    if (job?.status === "queued") return 28;
    if (job?.status === "running") return 62;
    if (syncing) return 85;
    if (job?.status === "succeeded") return 100;
    if (job?.status === "failed") return 100;
    return 0;
  })();

  const progressLabel = (() => {
    if (loading) return "Iniciando coleta...";
    if (job?.status === "queued") return "Fila iniciada. Aguarde alguns segundos...";
    if (job?.status === "running") return "Coletando publicacoes...";
    if (syncing) return "Processando resultados...";
    if (job?.status === "succeeded") return "Coleta concluida.";
    if (job?.status === "failed") return "Falha na coleta. Tente novamente.";
    return "Defina o perfil e inicie a coleta.";
  })();

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-card">
      <Card className="h-full rounded-none border-0 shadow-none">
        <CardContent className="space-y-5 pt-4">
          <div className="space-y-2">
            <Label htmlFor="instagram-profile">Perfil</Label>
            <Input
              id="instagram-profile"
              placeholder="@concorrente ou URL"
              value={profileUsername}
              onChange={(event) => onProfileUsernameChange(event.target.value)}
              disabled={isBusy}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="posts-limit">Quantas postagens trazer</Label>
            <Input
              id="posts-limit"
              type="number"
              min={1}
              max={50}
              value={filters.postsLimit}
              onChange={(event) =>
                onFiltersChange({
                  postsLimit: Number(event.target.value || 24),
                })
              }
              disabled={isBusy}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="only-posts-newer-than">Data inicial</Label>
            <Input
              id="only-posts-newer-than"
              type="date"
              value={filters.onlyPostsNewerThan || ""}
              onChange={(event) =>
                onFiltersChange({
                  onlyPostsNewerThan: event.target.value || null,
                })
              }
              disabled={isBusy}
            />
          </div>

          <div className="space-y-2">
            <Label>Ordenacao</Label>
            <Select
              value={filters.sortBy}
              onValueChange={(value) =>
                onFiltersChange({
                  sortBy: value as InstagramScrapeFilters["sortBy"],
                })
              }
              disabled={isBusy}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Mais recentes</SelectItem>
                <SelectItem value="most_liked">Trazer mais curtidos</SelectItem>
                <SelectItem value="most_viewed">Trazer mais vistos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="include-comments" className="text-sm">
                Comentarios
              </Label>
              <Checkbox
                id="include-comments"
                checked={filters.includeComments}
                onCheckedChange={(checked) =>
                  onFiltersChange({
                    includeComments: Boolean(checked),
                  })
                }
                disabled={isBusy}
              />
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="include-captions" className="text-sm">
                Legendas
              </Label>
              <Checkbox
                id="include-captions"
                checked={filters.includeCaptions}
                onCheckedChange={(checked) =>
                  onFiltersChange({
                    includeCaptions: Boolean(checked),
                  })
                }
                disabled={isBusy}
              />
            </div>
          </div>

          <Button
            className="w-full"
            onClick={() => {
              void onStartScrape();
            }}
            disabled={!profileUsername.trim() || isBusy}
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            Iniciar scrape
          </Button>

          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">Progresso da coleta</p>
              <p className="text-xs text-muted-foreground">{progressValue}%</p>
            </div>
            <Progress value={progressValue} className={job?.status === "failed" ? "[&>div]:bg-destructive" : ""} />
            <p className="text-xs text-muted-foreground">{progressLabel}</p>
            {job?.status === "failed" && job?.error ? (
              <p className="text-xs text-destructive">{job.error}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
