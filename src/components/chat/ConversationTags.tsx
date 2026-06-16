import { KeyboardEvent, useMemo, useState } from "react";
import { ChevronDown, Loader2, MoreHorizontal, Plus, Search, Tags, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useLeadTags, type LeadTag } from "@/hooks/useLeadTags";
import { cn } from "@/lib/utils";

interface ConversationTagsProps {
  leadId: string;
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

function normalizeTagName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function TagPill({
  tag,
  removable = false,
  onRemove,
  disabled,
}: {
  tag: LeadTag;
  removable?: boolean;
  onRemove?: (tagId: string) => void;
  disabled?: boolean;
}) {
  return (
    <span className={cn("chat-tag-pill group", getTagToneClass(tag.urgencia))}>
      <span className="max-w-28 truncate">{tag.name}</span>
      {removable && onRemove && (
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
      )}
    </span>
  );
}

function TagActionMenu({
  tag,
  disabled,
  onDelete,
}: {
  tag: LeadTag;
  disabled?: boolean;
  onDelete: (tagId: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Acoes da tag ${tag.name}`}
          disabled={disabled}
          className="chat-tool-button h-8 w-8 shrink-0 cursor-pointer text-[var(--color-gray-500)] focus-ring hover:text-[var(--color-gray-900)]"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={6} className="select-content w-40 p-1">
        <DropdownMenuItem
          onClick={() => onDelete(tag.id)}
          className="chat-tag-delete-item flex items-center gap-2 px-2 py-1.5 text-sm outline-none"
        >
          <Trash2 className="h-4 w-4" />
          Apagar tag
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TagRow({
  tag,
  checked,
  pendingToggle,
  pendingDelete,
  saving,
  onToggle,
  onDelete,
}: {
  tag: LeadTag;
  checked: boolean;
  pendingToggle: boolean;
  pendingDelete: boolean;
  saving: boolean;
  onToggle: (tagId: string) => void;
  onDelete: (tagId: string) => void;
}) {
  const busy = pendingToggle || pendingDelete || saving;

  return (
    <div
      className={cn(
        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-[var(--color-bg-subtle)]",
        busy && "opacity-75"
      )}
    >
      <button
        type="button"
        disabled={busy}
        onClick={() => onToggle(tag.id)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left focus-ring"
      >
        <Checkbox checked={checked} tabIndex={-1} className="pointer-events-none" />
        <span className={cn("chat-tag-pill", getTagToneClass(tag.urgencia))}>{tag.name}</span>
        {pendingToggle && <Loader2 className="ml-auto h-4 w-4 animate-spin text-[var(--color-primary-500)]" />}
      </button>

      {pendingDelete ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--color-gray-500)]" />
      ) : (
        <TagActionMenu tag={tag} disabled={busy} onDelete={onDelete} />
      )}
    </div>
  );
}

export function ConversationTags({ leadId }: ConversationTagsProps) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [createValue, setCreateValue] = useState("");
  const [pendingTagId, setPendingTagId] = useState<string | null>(null);
  const [pendingDeleteTagId, setPendingDeleteTagId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const { leadTags, availableTags, selectedTagIds, loading, saving, addTag, removeTag, deleteTag } =
    useLeadTags(leadId);

  const summaryTags = leadTags.slice(0, 2);
  const hiddenCount = Math.max(0, leadTags.length - summaryTags.length);

  const filteredTags = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return availableTags;
    }

    return availableTags.filter((tag) => tag.name.toLowerCase().includes(query));
  }, [availableTags, searchQuery]);

  const createName = normalizeTagName(createValue);
  const matchedExistingTag = useMemo(
    () => availableTags.find((tag) => tag.name.trim().toLowerCase() === createName.toLowerCase()) ?? null,
    [availableTags, createName]
  );

  const isBusy = loading || saving || isCreating || pendingTagId !== null || pendingDeleteTagId !== null;
  const canCreate = Boolean(createName) && !isBusy;

  const handleToggleTag = async (tagId: string) => {
    setPendingTagId(tagId);

    try {
      if (selectedTagIds.has(tagId)) {
        await removeTag(tagId);
      } else {
        await addTag(tagId);
      }

      return true;
    } catch (error) {
      toast.error("Erro ao atualizar tags", {
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
      return false;
    } finally {
      setPendingTagId(null);
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    setPendingDeleteTagId(tagId);

    try {
      await deleteTag(tagId);
      toast.success("Tag apagada.");
    } catch (error) {
      toast.error("Erro ao apagar tag", {
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setPendingDeleteTagId(null);
    }
  };

  const handleCreateTag = async () => {
    if (!canCreate) {
      return;
    }

    if (matchedExistingTag) {
      if (selectedTagIds.has(matchedExistingTag.id)) {
        toast.success("Tag ja vinculada ao lead.");
      } else {
        const updated = await handleToggleTag(matchedExistingTag.id);
        if (updated) {
          toast.success("Tag vinculada ao lead.");
        }
      }

      setCreateValue("");
      return;
    }

    const acesId = Number(session?.user?.app_metadata?.aces_id);
    if (!Number.isFinite(acesId)) {
      toast.error("Nao foi possivel identificar a conta desta sessao.");
      return;
    }

    setIsCreating(true);

    try {
      const { data, error } = await supabase
        .from("tags")
        .insert({
          aces_id: acesId,
          name: createName,
          urgencia: null,
        })
        .select("id, name, urgencia")
        .single();

      if (error) {
        throw error;
      }

      await addTag(data.id);
      toast.success("Tag criada e vinculada ao lead.");
      setCreateValue("");
      setSearchQuery("");
    } catch (error) {
      toast.error("Erro ao criar tag", {
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleCreateTag();
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);

        if (!nextOpen) {
          setSearchQuery("");
          setCreateValue("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Selecionar tags do lead"
          className={cn(
            "select-trigger flex w-full items-center justify-between gap-3 px-4 py-2 text-left",
            open && "border-[var(--border-focus)]"
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <Tags className="h-4 w-4 shrink-0 text-[var(--color-gray-500)]" />
            {leadTags.length === 0 ? (
              <span className="truncate text-sm text-[var(--color-text-secondary)]">Selecione ou crie tags</span>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                {summaryTags.map((tag) => (
                  <TagPill key={tag.id} tag={tag} />
                ))}
                {hiddenCount > 0 && <span className="chat-tag-pill border-[var(--border-default)]">+{hiddenCount}</span>}
              </div>
            )}
          </div>

          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-gray-500)]" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" side="bottom" className="select-content w-[min(100vw-2rem,480px)] p-0">
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

        {leadTags.length > 0 && (
          <div className="border-b border-[var(--border-default)] px-3 py-2">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-secondary)]">
              Tags vinculadas
            </div>
            <div className="flex flex-wrap gap-1.5">
              {leadTags.map((tag) => (
                <TagPill
                  key={tag.id}
                  tag={tag}
                  removable
                  disabled={saving || pendingTagId === tag.id}
                  onRemove={(tagId) => {
                    void handleToggleTag(tagId);
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <div className="max-h-64 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-4 text-sm text-[var(--color-gray-500)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando tags
            </div>
          ) : filteredTags.length === 0 ? (
            <p className="px-3 py-4 text-sm text-[var(--color-gray-500)]">Nenhuma tag encontrada</p>
          ) : (
            filteredTags.map((tag) => (
              <TagRow
                key={tag.id}
                tag={tag}
                checked={selectedTagIds.has(tag.id)}
                pendingToggle={pendingTagId === tag.id}
                pendingDelete={pendingDeleteTagId === tag.id}
                saving={saving}
                onToggle={(tagId) => {
                  void handleToggleTag(tagId);
                }}
                onDelete={(tagId) => {
                  void handleDeleteTag(tagId);
                }}
              />
            ))
          )}
        </div>

        <div className="border-t border-[var(--border-default)] p-3">
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-secondary)]">
              Criar tag
            </div>
            <div className="flex gap-2">
              <Input
                value={createValue}
                onChange={(event) => setCreateValue(event.target.value)}
                onKeyDown={handleCreateKeyDown}
                placeholder="Nome da nova tag"
                className="h-9"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleCreateTag()}
                disabled={!canCreate}
                className="shrink-0 gap-2"
              >
                {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Criar
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
