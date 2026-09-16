import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  Copy,
  Globe,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { useAgents } from "@/hooks/useAgents";
import { useAuth } from "@/contexts/AuthContext";
import {
  createWebsiteWidgetConnection,
  deleteWebsiteWidgetConnection,
  listWebsiteWidgetConnections,
  rotateWebsiteWidgetKey,
  updateWebsiteWidgetConnection,
  type WebsiteWidgetConnection,
} from "@/services/websiteWidgetService";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type EditorState = {
  id: string | null;
  name: string;
  agentId: string;
  allowedDomains: string;
  welcomeMessage: string;
  color: string;
  displayName: string;
  footerUrl: string;
  avatarUrl: string;
  footerText: string;
};

type InstallReveal = {
  snippet: string;
  title: string;
  description: string;
};

const DEFAULT_COLOR = "#1f6feb";

const emptyEditor: EditorState = {
  id: null,
  name: "",
  agentId: "",
  allowedDomains: "",
  welcomeMessage: "",
  color: DEFAULT_COLOR,
  displayName: "",
  avatarUrl: "",
  footerText: "",
  footerUrl: "",
};

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Nao foi possivel concluir a operacao.";
}

function parseDomains(value: string) {
  return value
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function themeValue(connection: WebsiteWidgetConnection, key: string, fallback = "") {
  const value = connection.theme?.[key];
  return typeof value === "string" && value ? value : fallback;
}

async function copyText(value: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
  } catch {
    toast.error("Nao foi possivel copiar o valor");
  }
}

export function WebsiteWidgetConnections() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const { agents, loading: agentsLoading } = useAgents();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState>(emptyEditor);
  const [saving, setSaving] = useState(false);
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [installReveal, setInstallReveal] = useState<InstallReveal | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<WebsiteWidgetConnection | null>(null);

  const connectionsQuery = useQuery({
    queryKey: ["website-widget-connections"],
    queryFn: listWebsiteWidgetConnections,
    enabled: Boolean(session),
  });

  const availableAgents = agents.filter(
    (agent) =>
      agent.agent_type === "primary" &&
      agent.is_active &&
      Boolean(agent.instance_name?.trim()),
  );
  const soleAvailableAgentId =
    availableAgents.length === 1 ? availableAgents[0].id : null;
  const selectedAgent =
    availableAgents.find((agent) => agent.id === editor.agentId) ?? null;

  useEffect(() => {
    if (!editorOpen || editor.agentId || !soleAvailableAgentId) return;
    setEditor((current) => ({ ...current, agentId: soleAvailableAgentId }));
  }, [editor.agentId, editorOpen, soleAvailableAgentId]);

  const refreshConnections = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["website-widget-connections"],
    });
  };

  const openCreate = () => {
    setFormError(null);
    setEditor({
      ...emptyEditor,
      agentId: availableAgents.length === 1 ? availableAgents[0].id : "",
    });
    setEditorOpen(true);
  };

  const openEdit = (connection: WebsiteWidgetConnection) => {
    setFormError(null);
    setEditor({
      id: connection.id,
      name: connection.name,
      agentId: connection.agentId ?? "",
      allowedDomains: connection.allowedDomains.join("\n"),
      welcomeMessage: connection.welcomeMessage ?? "",
      color: themeValue(connection, "color", DEFAULT_COLOR),
      displayName: themeValue(connection, "agentName"),
      avatarUrl: themeValue(connection, "avatarUrl"),
      footerText: themeValue(connection, "footerText"),
      footerUrl: themeValue(connection, "footerUrl"),
    });
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const domains = parseDomains(editor.allowedDomains);
    if (!editor.name.trim() || !editor.agentId || domains.length === 0) {
      setFormError("Informe o nome, o agente e ao menos um site autorizado.");
      return;
    }

    try {
      setSaving(true);
      setFormError(null);
      const payload = {
        name: editor.name.trim(),
        agentId: editor.agentId,
        allowedDomains: domains,
        welcomeMessage: editor.welcomeMessage.trim() || null,
        theme: {
          color: editor.color,
          agentName: editor.displayName.trim(),
          avatarUrl: editor.avatarUrl.trim(),
          footerText: editor.footerText.trim(),
          footerUrl: editor.footerUrl.trim(),
        },
      };

      if (editor.id) {
        await updateWebsiteWidgetConnection(editor.id, payload);
        toast.success("Agente no site atualizado");
      } else {
        const connection = await createWebsiteWidgetConnection(payload);
        setInstallReveal({
          snippet: connection.embedSnippet,
          title: "Agente no site criado",
          description:
            "Cole este código antes do fechamento do body, em cada site autorizado.",
        });
        toast.success("Agente no site criado");
      }
      setEditorOpen(false);
      setEditor(emptyEditor);
      await refreshConnections();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (connection: WebsiteWidgetConnection) => {
    try {
      setBusyConnectionId(connection.id);
      await updateWebsiteWidgetConnection(connection.id, {
        status: connection.status === "active" ? "paused" : "active",
      });
      toast.success(
        connection.status === "active"
          ? "Agente no site pausado"
          : "Agente no site ativado",
      );
      await refreshConnections();
    } catch (error) {
      toast.error("Não foi possível alterar o agente no site", {
        description: errorMessage(error),
      });
    } finally {
      setBusyConnectionId(null);
    }
  };

  const handleRotate = async (connection: WebsiteWidgetConnection) => {
    try {
      setBusyConnectionId(connection.id);
      const updated = await rotateWebsiteWidgetKey(connection.id);
      setInstallReveal({
        snippet: updated.embedSnippet,
        title: "Chave renovada",
        description:
          "O código anterior parou de funcionar agora. Substitua nos sites autorizados.",
      });
      toast.success("Chave renovada");
      await refreshConnections();
    } catch (error) {
      toast.error("Não foi possível renovar a chave", {
        description: errorMessage(error),
      });
    } finally {
      setBusyConnectionId(null);
    }
  };

  const handleRemove = async () => {
    if (!pendingRemoval) return;
    try {
      setBusyConnectionId(pendingRemoval.id);
      await deleteWebsiteWidgetConnection(pendingRemoval.id);
      toast.success("Agente no site removido");
      setPendingRemoval(null);
      await refreshConnections();
    } catch (error) {
      toast.error("Não foi possível remover", {
        description: errorMessage(error),
      });
    } finally {
      setBusyConnectionId(null);
    }
  };

  return (
    <section className="mt-8 space-y-4" aria-labelledby="website-widget-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-primary-600)]">
            Integrações
          </p>
          <h2
            id="website-widget-title"
            className="mt-1 text-2xl font-semibold text-[var(--color-gray-900)]"
          >
            Agente no site
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-[var(--color-gray-500)]">
            Coloque o agente para atender visitantes no seu site. Ele pede nome e
            telefone, cria o contato e continua a conversa pelo WhatsApp.
          </p>
        </div>
        <Button
          type="button"
          onClick={openCreate}
          disabled={availableAgents.length === 0}
        >
          <Plus className="h-4 w-4" />
          Novo agente no site
        </Button>
      </div>

      {availableAgents.length === 0 && !agentsLoading ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Ative um agente principal com instância configurada para colocá-lo no
            seu site.
          </span>
        </div>
      ) : null}

      {connectionsQuery.isLoading ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-[var(--color-gray-500)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </CardContent>
        </Card>
      ) : connectionsQuery.isError ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-4 py-6 text-sm text-[var(--color-gray-600)]">
            Não foi possível carregar os agentes no site.
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void connectionsQuery.refetch()}
            >
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      ) : connectionsQuery.data?.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {connectionsQuery.data.map((connection) => {
            const busy = busyConnectionId === connection.id;
            return (
              <Card key={connection.id} className="overflow-hidden">
                <CardHeader className="gap-3 border-b border-[var(--border-default)] pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-50)] text-[var(--color-primary-600)]">
                        <Globe className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="truncate text-lg">
                          {connection.name}
                        </CardTitle>
                        <CardDescription className="mt-1">
                          {connection.agentName ?? "Agente indisponível"}
                          {connection.instanceName
                            ? ` · ${connection.instanceName}`
                            : ""}
                        </CardDescription>
                      </div>
                    </div>
                    <p className="shrink-0 text-sm font-medium text-[var(--color-gray-600)]">
                      {connection.status === "active" ? "Atendendo" : "Pausado"}
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                  {!connection.ready ? (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        {connection.configurationIssue}. Corrija para voltar a
                        atender visitantes.
                      </span>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <Label htmlFor={`website-widget-snippet-${connection.id}`}>
                      Código de instalação
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id={`website-widget-snippet-${connection.id}`}
                        value={connection.embedSnippet}
                        readOnly
                        className="min-w-0 font-mono text-xs"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() =>
                          void copyText(
                            connection.embedSnippet,
                            "Código copiado",
                          )
                        }
                        aria-label="Copiar código de instalação"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 text-sm sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <p className="text-xs text-[var(--color-gray-500)]">
                        Sites autorizados
                      </p>
                      <p className="mt-1 font-medium text-[var(--color-gray-800)]">
                        {connection.allowedDomains.join(", ") || "Nenhum"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--color-gray-500)]">
                        Instância derivada
                      </p>
                      <p className="mt-1 font-medium text-[var(--color-gray-800)]">
                        {connection.instanceName || "Indisponível"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--color-gray-500)]">
                        Primeira mensagem
                      </p>
                      <p className="mt-1 font-medium text-[var(--color-gray-800)]">
                        {connection.welcomeMessage ?? "Padrão"}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 border-t border-[var(--border-default)] pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit(connection)}
                      disabled={busy}
                    >
                      <Pencil className="h-4 w-4" />
                      Editar
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleToggle(connection)}
                      disabled={busy}
                    >
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : connection.status === "active" ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                      {connection.status === "active" ? "Pausar" : "Ativar"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleRotate(connection)}
                      disabled={busy}
                    >
                      <RotateCw className="h-4 w-4" />
                      Renovar chave
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingRemoval(connection)}
                      disabled={busy}
                    >
                      <Trash2 className="h-4 w-4" />
                      Remover
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-primary-50)] text-[var(--color-primary-600)]">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-[var(--color-gray-900)]">
                Nenhum site configurado
              </p>
              <p className="mt-1 text-sm text-[var(--color-gray-500)]">
                Escolha um agente e informe o endereço do seu site para começar.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          if (!open && !saving) setEditorOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editor.id ? "Editar agente no site" : "Novo agente no site"}
            </DialogTitle>
            <DialogDescription>
              O visitante informa nome e telefone antes de começar a conversa.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="website-widget-name">Nome</Label>
              <Input
                id="website-widget-name"
                value={editor.name}
                onChange={(event) =>
                  setEditor((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Ex.: Site institucional"
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="website-widget-agent">Agente que vai atender</Label>
              <Select
                value={editor.agentId}
                onValueChange={(value) =>
                  setEditor((current) => ({ ...current, agentId: value }))
                }
                disabled={saving || agentsLoading}
              >
                <SelectTrigger id="website-widget-agent">
                  <SelectValue
                    placeholder={
                      agentsLoading
                        ? "Carregando agentes..."
                        : "Selecione um agente"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedAgent ? (
                <p className="text-xs text-[var(--color-gray-500)]">
                  Instância usada automaticamente:{" "}
                  <span className="font-medium text-[var(--color-gray-700)]">
                    {selectedAgent.instance_name}
                  </span>
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="website-widget-domains">Sites autorizados</Label>
              <Textarea
                id="website-widget-domains"
                value={editor.allowedDomains}
                onChange={(event) =>
                  setEditor((current) => ({
                    ...current,
                    allowedDomains: event.target.value,
                  }))
                }
                placeholder={"arquem.com.br"}
                rows={3}
                disabled={saving}
              />
              <p className="text-xs text-[var(--color-gray-500)]">
                Um endereço por linha. Só esses sites poderão usar o agente.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="website-widget-display-name">
                  Nome no topo do chat
                </Label>
                <Input
                  id="website-widget-display-name"
                  value={editor.displayName}
                  onChange={(event) =>
                    setEditor((current) => ({
                      ...current,
                      displayName: event.target.value,
                    }))
                  }
                  placeholder="Ex.: Nya"
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website-widget-avatar">Foto do agente</Label>
                <Input
                  id="website-widget-avatar"
                  value={editor.avatarUrl}
                  onChange={(event) =>
                    setEditor((current) => ({
                      ...current,
                      avatarUrl: event.target.value,
                    }))
                  }
                  placeholder="/widget-assets/agente.png"
                  disabled={saving}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="website-widget-welcome">Primeira mensagem</Label>
              <Input
                id="website-widget-welcome"
                value={editor.welcomeMessage}
                onChange={(event) =>
                  setEditor((current) => ({
                    ...current,
                    welcomeMessage: event.target.value,
                  }))
                }
                placeholder="Oi! Como posso ajudar?"
                disabled={saving}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="website-widget-footer">Assinatura no rodapé</Label>
                <Input
                  id="website-widget-footer"
                  value={editor.footerText}
                  onChange={(event) =>
                    setEditor((current) => ({
                      ...current,
                      footerText: event.target.value,
                    }))
                  }
                  placeholder="Deixe vazio para não exibir"
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website-widget-footer-link">
                  Link da assinatura
                </Label>
                <Input
                  id="website-widget-footer-link"
                  value={editor.footerUrl}
                  onChange={(event) =>
                    setEditor((current) => ({
                      ...current,
                      footerUrl: event.target.value,
                    }))
                  }
                  placeholder="https://itstime.pro"
                  disabled={saving}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="website-widget-color">Cor do chat</Label>
              <Input
                id="website-widget-color"
                type="color"
                value={editor.color}
                onChange={(event) =>
                  setEditor((current) => ({
                    ...current,
                    color: event.target.value,
                  }))
                }
                className="h-10 w-20 p-1"
                disabled={saving}
              />
            </div>

            {formError ? (
              <p className="text-sm text-destructive">{formError}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditorOpen(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || agentsLoading}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editor.id ? "Salvar alterações" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(installReveal)}
        onOpenChange={(open) => {
          if (!open) setInstallReveal(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{installReveal?.title}</DialogTitle>
            <DialogDescription>{installReveal?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="website-widget-install">Código de instalação</Label>
            <div className="flex gap-2">
              <Input
                id="website-widget-install"
                value={installReveal?.snippet ?? ""}
                readOnly
                className="min-w-0 font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() =>
                  installReveal &&
                  void copyText(installReveal.snippet, "Código copiado")
                }
                aria-label="Copiar código de instalação"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setInstallReveal(null)}>
              <Check className="h-4 w-4" />
              Concluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(pendingRemoval)}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover o agente do site?</AlertDialogTitle>
            <AlertDialogDescription>
              O chat sai do ar imediatamente em {pendingRemoval?.name}. As
              conversas já registradas continuam no histórico dos contatos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleRemove()}>
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
