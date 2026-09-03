import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { createInternalConversation, listInternalChatUsers } from "@/services/internalChatService";
import type { InternalChatUser, InternalConversationKind } from "@/types/internalChat";

export function InternalConversationDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (conversationId: string) => void;
}) {
  const { user } = useAuth();
  const [kind, setKind] = useState<InternalConversationKind>("direct");
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<InternalChatUser[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    void listInternalChatUsers()
      .then(setUsers)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Nao foi possivel listar o Time"))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) {
      setKind("direct");
      setName("");
      setSearch("");
      setSelectedIds([]);
      setError(null);
    }
  }, [open]);

  const availableUsers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return users
      .filter((item) => item.auth_user_id !== user?.id)
      .filter((item) => !query || `${item.name ?? ""} ${item.email}`.toLocaleLowerCase("pt-BR").includes(query));
  }, [search, user?.id, users]);

  const toggleUser = (userId: string) => {
    setSelectedIds((current) => {
      if (kind === "direct") return current.includes(userId) ? [] : [userId];
      return current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId];
    });
  };

  const submit = async () => {
    if (selectedIds.length < 1 || (kind === "group" && !name.trim())) return;
    setSaving(true);
    setError(null);
    try {
      const result = await createInternalConversation({ kind, name: kind === "group" ? name : null, memberIds: selectedIds });
      onOpenChange(false);
      onCreated(result.conversationId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Nao foi possivel criar a conversa");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-[var(--color-surface-1)] shadow-modal">
        <DialogHeader>
          <DialogTitle>Nova conversa do Time</DialogTitle>
          <DialogDescription>Converse com pessoas da mesma conta, mesmo que estejam em empresas diferentes.</DialogDescription>
        </DialogHeader>

        <div className="flex rounded-[var(--radius-lg)] bg-[var(--color-bg-subtle)] p-1 shadow-inset" role="group" aria-label="Tipo de conversa">
          {(["direct", "group"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              onClick={() => {
                setKind(option);
                setSelectedIds((current) => option === "direct" ? current.slice(0, 1) : current);
              }}
              className={cn(
                "flex-1 rounded-[var(--radius-md)] px-3 py-2 text-sm font-semibold transition-all focus-ring",
                kind === option ? "bg-[var(--color-surface-1)] text-[var(--color-gray-900)] shadow-sm" : "text-[var(--color-gray-600)]",
              )}
            >
              {option === "direct" ? "Conversa direta" : "Grupo"}
            </button>
          ))}
        </div>

        {kind === "group" ? (
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Nome do grupo" aria-label="Nome do grupo" />
        ) : null}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-gray-500)]" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar pessoas" className="pl-10" />
        </div>

        <ScrollArea className="h-64 rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-2)]">
          <div className="space-y-1 p-2">
            {loading ? (
              <div className="flex h-40 items-center justify-center" role="status"><Loader2 className="h-5 w-5 animate-spin text-[var(--color-primary-500)]" /><span className="sr-only">Carregando pessoas</span></div>
            ) : availableUsers.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-[var(--color-gray-500)]"><Users className="h-6 w-6" /><p className="text-sm">Nenhuma pessoa encontrada</p></div>
            ) : availableUsers.map((item) => {
              const selected = selectedIds.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleUser(item.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[var(--radius-lg)] px-3 py-2.5 text-left transition-all focus-ring",
                    selected ? "bg-[var(--color-primary-50)] shadow-sm" : "hover:bg-[var(--color-bg-subtle)]",
                  )}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-3)] text-sm font-bold text-[var(--color-gray-700)]">{(item.name || item.email).charAt(0).toUpperCase()}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[var(--color-gray-800)]">{item.name || item.email}</span><span className="block truncate text-xs text-[var(--color-gray-500)]">{item.email}</span></span>
                  {selected ? <Check className="h-4 w-4 text-[var(--color-primary-600)]" /> : null}
                </button>
              );
            })}
          </div>
        </ScrollArea>

        {error ? <p role="alert" className="text-sm text-[var(--color-error-600)]">{error}</p> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => void submit()} disabled={saving || selectedIds.length < 1 || (kind === "group" && !name.trim())}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Criar conversa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
