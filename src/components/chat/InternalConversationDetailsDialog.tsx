import { useEffect, useMemo, useState } from "react";
import { Archive, Loader2, RotateCcw, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  addInternalConversationMember,
  listInternalChatUsers,
  removeInternalConversationMember,
  updateInternalConversation,
  updateInternalConversationMember,
} from "@/services/internalChatService";
import type { InternalChatUser, InternalConversation } from "@/types/internalChat";

export function InternalConversationDetailsDialog({
  conversation,
  open,
  canManage,
  onOpenChange,
  onChanged,
}: {
  conversation: InternalConversation;
  open: boolean;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void> | void;
}) {
  const [name, setName] = useState(conversation.name ?? "");
  const [users, setUsers] = useState<InternalChatUser[]>([]);
  const [newMemberId, setNewMemberId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(conversation.name ?? "");
  }, [conversation.name]);

  useEffect(() => {
    if (!open || conversation.kind !== "group" || !canManage) return;
    void listInternalChatUsers().then(setUsers).catch(() => setUsers([]));
  }, [canManage, conversation.kind, open]);

  const availableUsers = useMemo(() => {
    const currentIds = new Set(conversation.members.map((member) => member.userId));
    return users.filter((user) => !currentIds.has(user.id));
  }, [conversation.members, users]);

  const runChange = async (operation: () => Promise<unknown>, successMessage: string) => {
    setSaving(true);
    try {
      await operation();
      await onChanged();
      toast.success(successMessage);
    } catch (error) {
      toast.error("Nao foi possivel atualizar a conversa", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-[var(--color-surface-1)] shadow-modal">
        <DialogHeader>
          <DialogTitle>{conversation.kind === "group" ? "Detalhes do grupo" : "Detalhes da conversa"}</DialogTitle>
          <DialogDescription>{conversation.members.length} participante{conversation.members.length === 1 ? "" : "s"}</DialogDescription>
        </DialogHeader>

        {conversation.kind === "group" && canManage ? (
          <div className="flex gap-2">
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} aria-label="Nome do grupo" />
            <Button variant="outline" disabled={saving || !name.trim() || name.trim() === conversation.name} onClick={() => void runChange(() => updateInternalConversation(conversation.id, { name: name.trim() }), "Grupo renomeado")}>Salvar</Button>
          </div>
        ) : null}

        {conversation.kind === "group" && canManage && availableUsers.length > 0 ? (
          <div className="flex gap-2">
            <Select value={newMemberId} onValueChange={setNewMemberId}>
              <SelectTrigger className="flex-1"><SelectValue placeholder="Adicionar pessoa" /></SelectTrigger>
              <SelectContent>{availableUsers.map((user) => <SelectItem key={user.id} value={user.id}>{user.name || user.email}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" disabled={!newMemberId || saving} onClick={() => void runChange(async () => { await addInternalConversationMember(conversation.id, newMemberId); setNewMemberId(""); }, "Participante adicionado")}><UserPlus className="h-4 w-4" /> Adicionar</Button>
          </div>
        ) : null}

        <div className="max-h-72 space-y-1 overflow-y-auto rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-2)] p-2">
          {conversation.members.map((member) => (
            <div key={member.userId} className="flex items-center gap-3 rounded-[var(--radius-lg)] px-3 py-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-3)] text-sm font-bold text-[var(--color-gray-700)]">{member.name.charAt(0).toUpperCase()}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[var(--color-gray-800)]">{member.name}{member.isCurrentUser ? " (voce)" : ""}</span><span className="block truncate text-xs text-[var(--color-gray-500)]">{member.isAdmin ? "Administrador do grupo" : member.email}</span></span>
              {conversation.kind === "group" && canManage ? (
                <div className="flex gap-1">
                  <button type="button" disabled={saving} aria-label={member.isAdmin ? `Remover ${member.name} da administracao` : `Promover ${member.name} a administrador`} onClick={() => void runChange(() => updateInternalConversationMember(conversation.id, member.userId, { isAdmin: !member.isAdmin }), member.isAdmin ? "Administrador removido" : "Administrador adicionado")} className="chat-tool-button h-9 w-9 focus-ring"><ShieldCheck className={member.isAdmin ? "h-4 w-4 text-[var(--color-primary-600)]" : "h-4 w-4"} /></button>
                  <button type="button" disabled={saving || member.isCurrentUser} aria-label={`Remover ${member.name} do grupo`} onClick={() => void runChange(() => removeInternalConversationMember(conversation.id, member.userId), "Participante removido")} className="chat-tool-button h-9 w-9 focus-ring disabled:opacity-40"><UserMinus className="h-4 w-4" /></button>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <DialogFooter className="justify-between sm:justify-between">
          {canManage ? (
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => void runChange(
                () => updateInternalConversation(conversation.id, { archived: !conversation.archivedAt }),
                conversation.archivedAt ? "Conversa restaurada" : "Conversa arquivada",
              )}
            >
              {conversation.archivedAt ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              {conversation.archivedAt ? "Restaurar" : "Arquivar"}
            </Button>
          ) : <span />}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
