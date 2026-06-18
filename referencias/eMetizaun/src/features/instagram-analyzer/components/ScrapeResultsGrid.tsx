import { useMemo, useState } from "react";
import { ExternalLink, Eye, MessageCircle, PlayCircle, ThumbsUp } from "lucide-react";

import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

import type { ResearchScrapeItem } from "@/features/instagram-analyzer/types";

type ScrapeResultsGridProps = {
  items: ResearchScrapeItem[];
  loading: boolean;
  selectedIds: Set<string>;
  onToggleSelection: (itemId: string, selected: boolean) => void;
};

type NormalizedComment = {
  key: string;
  author: string;
  text: string;
  dateLabel?: string;
};

function formatNumber(value: number | null) {
  if (typeof value !== "number") return "-";
  return new Intl.NumberFormat("pt-BR").format(value);
}

function getPreviewUrl(item: ResearchScrapeItem) {
  return item.thumbnail_url || item.display_url || "";
}

function getNestedValue(source: unknown, path: string) {
  if (!source || typeof source !== "object") return undefined;

  const parts = path.split(".");
  let current: unknown = source;

  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function pickString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function formatCommentDate(raw: unknown) {
  if (raw === null || raw === undefined) return undefined;

  let date: Date | null = null;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    const timestamp = raw > 10_000_000_000 ? raw : raw * 1000;
    date = new Date(timestamp);
  } else if (typeof raw === "string" && raw.trim()) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      const timestamp = numeric > 10_000_000_000 ? numeric : numeric * 1000;
      date = new Date(timestamp);
    } else {
      date = new Date(raw);
    }
  }

  if (!date || Number.isNaN(date.getTime())) {
    return undefined;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function normalizeComment(comment: unknown, index: number): NormalizedComment {
  if (typeof comment === "string") {
    return {
      key: `comment-${index}-${comment.slice(0, 24)}`,
      author: "Usuario",
      text: comment.trim() || "Comentario sem conteudo legivel",
    };
  }

  if (!comment || typeof comment !== "object") {
    return {
      key: `comment-${index}-unknown`,
      author: "Usuario",
      text: "Comentario sem conteudo legivel",
    };
  }

  const author = pickString(
    getNestedValue(comment, "username"),
    getNestedValue(comment, "ownerUsername"),
    getNestedValue(comment, "owner.username"),
    getNestedValue(comment, "user.username"),
    getNestedValue(comment, "author.username"),
    getNestedValue(comment, "from.username"),
    getNestedValue(comment, "author"),
    getNestedValue(comment, "owner"),
    getNestedValue(comment, "user"),
    getNestedValue(comment, "from"),
  ) || "Usuario";

  const text = pickString(
    getNestedValue(comment, "text"),
    getNestedValue(comment, "content"),
    getNestedValue(comment, "comment"),
    getNestedValue(comment, "body"),
    getNestedValue(comment, "message"),
  ) || "Comentario sem conteudo legivel";

  const dateLabel = formatCommentDate(
    getNestedValue(comment, "timestamp") ??
      getNestedValue(comment, "created_at") ??
      getNestedValue(comment, "createdAt") ??
      getNestedValue(comment, "time"),
  );

  return {
    key: `comment-${index}-${author}-${text.slice(0, 20)}`,
    author,
    text,
    dateLabel,
  };
}

export function ScrapeResultsGrid({
  items,
  loading,
  selectedIds,
  onToggleSelection,
}: ScrapeResultsGridProps) {
  const [commentsItem, setCommentsItem] = useState<ResearchScrapeItem | null>(null);
  const [mediaItem, setMediaItem] = useState<ResearchScrapeItem | null>(null);

  const normalizedComments = useMemo(() => {
    if (!commentsItem?.comments || !Array.isArray(commentsItem.comments)) {
      return [];
    }

    return commentsItem.comments.map((comment, index) => normalizeComment(comment, index));
  }, [commentsItem?.comments]);

  return (
    <div className="h-full min-h-0 overflow-hidden bg-muted/20">
      <div className="flex h-full min-h-0 flex-col">
        <ScrollArea className="h-full">
          <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {loading
              ? Array.from({ length: 6 }).map((_, index) => (
                  <Card key={`skeleton-${index}`} className="overflow-hidden">
                    <CardHeader className="pb-2">
                      <Skeleton className="h-4 w-1/2" />
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Skeleton className="h-40 w-full" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-2/3" />
                    </CardContent>
                  </Card>
                ))
              : null}

            {!loading && !items.length ? (
              <div className="col-span-full rounded-xl border border-dashed bg-card p-8 text-center">
                <p className="text-sm font-medium">Nenhum resultado ainda</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Defina um perfil e execute o scrape para carregar os cards.
                </p>
              </div>
            ) : null}

            {!loading &&
              items.map((item) => {
                const previewUrl = getPreviewUrl(item);
                const hasComments = Array.isArray(item.comments) && item.comments.length > 0;
                const itemCommentsLength = Array.isArray(item.comments) ? item.comments.length : 0;

                return (
                  <Card key={item.id} className="group overflow-hidden shadow-sm">
                    <CardHeader className="space-y-2 pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-sm">{item.type === "reel" ? "Reel" : "Foto"}</CardTitle>
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {item.type}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between rounded-md bg-muted/30 px-2 py-1">
                        <label className="text-xs font-medium">Selecionar para IA</label>
                        <Checkbox
                          checked={selectedIds.has(item.id)}
                          onCheckedChange={(checked) => onToggleSelection(item.id, Boolean(checked))}
                        />
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-3">
                      <button
                        type="button"
                        onClick={() => setMediaItem(item)}
                        className="block w-full overflow-hidden rounded-lg border text-left"
                      >
                        <AspectRatio ratio={4 / 5}>
                          {previewUrl ? (
                            <img
                              src={previewUrl}
                              alt={item.caption?.slice(0, 40) || item.permalink}
                              className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                              loading="lazy"
                            />
                          ) : item.type === "reel" && item.video_url ? (
                            <div className="flex h-full flex-col items-center justify-center gap-2 bg-muted text-xs text-muted-foreground">
                              <PlayCircle className="h-6 w-6" />
                              <span>Reel sem thumbnail</span>
                            </div>
                          ) : (
                            <div className="flex h-full items-center justify-center bg-muted text-xs text-muted-foreground">
                              Sem preview
                            </div>
                          )}
                        </AspectRatio>
                      </button>

                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="flex items-center gap-1 rounded bg-muted/40 px-2 py-1">
                          <ThumbsUp className="h-3.5 w-3.5" />
                          <span>{formatNumber(item.likes_count)}</span>
                        </div>
                        <button
                          type="button"
                          className="flex items-center gap-1 rounded bg-muted/40 px-2 py-1 text-left hover:bg-muted"
                          onClick={() => setCommentsItem(item)}
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                          <span>{formatNumber(item.comments_count)}</span>
                        </button>
                        <div className="flex items-center gap-1 rounded bg-muted/40 px-2 py-1">
                          <Eye className="h-3.5 w-3.5" />
                          <span>{formatNumber(item.views_count)}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button asChild size="sm" variant="outline" className="flex-1">
                          <a href={item.permalink} target="_blank" rel="noreferrer">
                            <ExternalLink className="mr-1 h-3.5 w-3.5" />
                            Abrir post
                          </a>
                        </Button>
                        {hasComments ? (
                          <Badge variant="secondary" className="text-[10px]">
                            {itemCommentsLength} comentarios
                          </Badge>
                        ) : null}
                      </div>

                      {item.caption ? (
                        <p className="line-clamp-3 text-xs text-muted-foreground">{item.caption}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Legenda nao coletada.</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        </ScrollArea>
      </div>

      <Dialog open={Boolean(commentsItem)} onOpenChange={(open) => !open && setCommentsItem(null)}>
        <DialogContent className="max-h-[80vh] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Comentarios do post</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-2 pr-3">
              {normalizedComments.length ? (
                normalizedComments.map((comment) => (
                  <div key={comment.key} className="rounded-lg border bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{comment.author}</p>
                      {comment.dateLabel ? (
                        <p className="text-xs text-muted-foreground">{comment.dateLabel}</p>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-foreground/90">{comment.text}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Nao ha comentarios disponiveis para este item.</p>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(mediaItem)} onOpenChange={(open) => !open && setMediaItem(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{mediaItem?.type === "reel" ? "Reproducao do reel" : "Preview da foto"}</DialogTitle>
          </DialogHeader>

          {mediaItem?.type === "reel" && mediaItem.video_url ? (
            <div className="overflow-hidden rounded-lg border">
              <video src={mediaItem.video_url} controls className="h-full w-full" />
            </div>
          ) : mediaItem ? (
            <div className="overflow-hidden rounded-lg border">
              {getPreviewUrl(mediaItem) ? (
                <AspectRatio ratio={4 / 5}>
                  <img
                    src={getPreviewUrl(mediaItem)}
                    alt={mediaItem.caption?.slice(0, 40) || mediaItem.permalink}
                    className="h-full w-full object-cover"
                  />
                </AspectRatio>
              ) : (
                <div className="flex h-64 items-center justify-center bg-muted text-sm text-muted-foreground">
                  Sem preview disponivel.
                </div>
              )}
            </div>
          ) : null}

          {mediaItem?.type === "reel" && !mediaItem.video_url ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <PlayCircle className="h-4 w-4" />
                URL de video nao disponivel para este reel.
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
