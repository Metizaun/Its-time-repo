import { useMemo, useState } from "react";
import { Loader2, Plus, Search, Tags, X } from "lucide-react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLeadTags, type LeadTag } from "@/hooks/useLeadTags";
import { cn } from "@/lib/utils";

interface ConversationTagsProps {
  leadId: string;
  variant?: "compact" | "editor";
}

function getTagToneClass(urgencia: number | null) {
  switch (urgencia) {
    case 1:
      return "border-[var(--color-success-border)] bg-[var(--color-success-bg)] text-[var(--color-success-600)]";
    case 3:
      return "border-[var(--color-error-border)] bg-[var(--color-error-bg)] text-[var(--color-error-600)]";
    case 4:
      return "border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] text-[var(--color-warning-600)]";
    case 2:
    default:
      return "border-[var(--border-default)] bg-[var(--color-surface-3)] text-[var(--color-gray-600)]";
  }
}

function TagPill({
  tag,
  onRemove,
  disabled,
}: {
  tag: LeadTag;
  onRemove: (tagId: string) => void;
  disabled?: boolean;
}) {
  return (
    <span className={cn("chat-tag-pill group", getTagToneClass(tag.urgencia))}>
      <span className="max-w-28 truncate">{tag.name}</span>
      <button
        type="button"
        aria-label={`Remover tag ${tag.name}`}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onRemove(tag.id);
        }}
        className="ml-1 hidden rounded-full text-current opacity-70 transition-opacity hover:opacity-100 focus:opacity-100 focus:outline-none group-hover:inline-flex group-focus-within:inline-flex"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

export function ConversationTags({ leadId, variant = "compact" }: ConversationTagsProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingTagId, setPendingTagId] = useState<string | null>(null);
  const { leadTags, availableTags, selectedTagIds, loading, saving, addTag, removeTag } = useLeadTags(leadId);

  const isEditor = variant === "editor";
  const visibleTags = isEditor ? leadTags : leadTags.slice(0, 3);
  const hiddenCount = Math.max(0, leadTags.length - visibleTags.length);

  const filteredTags = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return availableTags;
    }

    return availableTags.filter((tag) => tag.name.toLowerCase().includes(query));
  }, [availableTags, searchQuery]);

  const handleToggleTag = async (tagId: string) => {
    setPendingTagId(tagId);

    try {
      if (selectedTagIds.has(tagId)) {
        await removeTag(tagId);
      } else {
        await addTag(tagId);
      }
    } catch (error) {
      toast.error("Erro ao atualizar tags", {
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setPendingTagId(null);
    }
  };

  return (
    <div className={cn("flex min-w-0 items-center gap-2", isEditor && "flex-wrap")}>
      <div className={cn(isEditor ? "flex min-w-0 flex-1 flex-wrap items-center gap-1.5" : "chat-tags-row")}>
        {visibleTags.map((tag) => (
          <TagPill
            key={tag.id}
            tag={tag}
            disabled={saving}
            onRemove={(tagId) => {
              void handleToggleTag(tagId);
            }}
          />
        ))}

        {hiddenCount > 0 && <span className="chat-tag-pill border-[var(--border-default)]">+{hiddenCount}</span>}
        {isEditor && !loading && visibleTags.length === 0 && (
          <span className="text-sm text-[var(--color-text-secondary)]">Nenhuma tag vinculada</span>
        )}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Editar tags"
                className={cn(
                  "chat-tool-button h-8 w-8 focus-ring",
                  isEditor && "h-9 w-auto gap-2 rounded-[var(--radius-lg)] px-3 text-sm font-semibold"
                )}
              >
                {leadTags.length > 0 ? <Tags className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {isEditor && <span>Editar tags</span>}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Editar tags</TooltipContent>
        </Tooltip>

        <PopoverContent
          align="start"
          side="bottom"
          className="w-[320px] max-w-[calc(100vw_-_var(--space-8))] rounded-2xl border-[var(--border-default)] bg-[var(--color-surface-1)] p-0 text-[var(--color-gray-900)] shadow-md"
        >
          <div className="border-b border-[var(--border-default)] p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-gray-500)]" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Buscar tag"
                className="h-9 pl-9 text-sm"
              />
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-4 text-sm text-[var(--color-gray-500)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando tags
              </div>
            ) : filteredTags.length === 0 ? (
              <p className="px-3 py-4 text-sm text-[var(--color-gray-500)]">Nenhuma tag encontrada</p>
            ) : (
              filteredTags.map((tag) => {
                const checked = selectedTagIds.has(tag.id);
                const pending = pendingTagId === tag.id;

                return (
                  <div
                    key={tag.id}
                    role="button"
                    tabIndex={pendingTagId ? -1 : 0}
                    aria-disabled={Boolean(pendingTagId)}
                    onClick={() => void handleToggleTag(tag.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void handleToggleTag(tag.id);
                      }
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--color-bg-subtle)] focus-ring",
                      pendingTagId && "pointer-events-none opacity-70"
                    )}
                  >
                    <Checkbox checked={checked} tabIndex={-1} className="pointer-events-none" />
                    <span className={cn("chat-tag-pill", getTagToneClass(tag.urgencia))}>{tag.name}</span>
                    {pending && <Loader2 className="ml-auto h-4 w-4 animate-spin text-[var(--color-primary-500)]" />}
                  </div>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
