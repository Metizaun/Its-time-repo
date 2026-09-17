import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  Copy,
  Link2,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";

import { useAgents } from "@/hooks/useAgents";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { useAuth } from "@/contexts/AuthContext";
import {
  createLeadWebhookConnection,
  listLeadWebhookConnections,
  rotateLeadWebhookSecret,
  updateLeadWebhookConnection,
  type LeadWebhookConnection,
} from "@/services/leadWebhookService";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";

type EditorState = {
  id: string | null;
  name: string;
  agentId: string;
  defaultStageId: string;
  acceptMedia: boolean;
};

type SecretReveal = {
  secret: string;
  title: string;
  description: string;
};

type LeadWebhookConnectionsProps = {
  mode?: "section" | "panel";
  createOnMount?: boolean;
};

const emptyEditor: EditorState = {
  id: null,
  name: "",
  agentId: "",
  defaultStageId: "",
  acceptMedia: false,
};

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Nao foi possivel concluir a operacao.";
}

async function copyText(value: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
  } catch {
    toast.error("Nao foi possivel copiar o valor");
  }
}

export function LeadWebhookConnections({
  mode = "section",
  createOnMount = false,
}: LeadWebhookConnectionsProps) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const { agents, loading: agentsLoading } = useAgents();
  const { stages, loading: stagesLoading } = usePipelineStages();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState>(emptyEditor);
  const [saving, setSaving] = useState(false);
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [secretReveal, setSecretReveal] = useState<SecretReveal | null>(null);
  const initialCreateHandled = useRef(false);

  const connectionsQuery = useQuery({
    queryKey: ["lead-webhook-connections"],
    queryFn: listLeadWebhookConnections,
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

  const openCreate = () => {
    setFormError(null);
    setEditor({
      ...emptyEditor,
      agentId: availableAgents.length === 1 ? availableAgents[0].id : "",
    });
    setEditorOpen(true);
  };

  useEffect(() => {
    if (
      mode !== "panel" ||
      !createOnMount ||
      initialCreateHandled.current ||
      editorOpen ||
      connectionsQuery.isLoading ||
      connectionsQuery.isError ||
      connectionsQuery.data?.length
    ) {
      return;
    }
    initialCreateHandled.current = true;
    setFormError(null);
    setEditor({
      ...emptyEditor,
      agentId: availableAgents.length === 1 ? availableAgents[0].id : "",
    });
    setEditorOpen(true);
  }, [
    availableAgents,
    connectionsQuery.data?.length,
    connectionsQuery.isError,
    connectionsQuery.isLoading,
    createOnMount,
    editorOpen,
    mode,
  ]);

  const openEdit = (connection: LeadWebhookConnection) => {
    setFormError(null);
    setEditor({
      id: connection.id,
      name: connection.name,
      agentId: connection.agentId ?? "",
      defaultStageId: connection.defaultStageId ?? "",
      acceptMedia: connection.acceptMedia,
    });
    setEditorOpen(true);
  };

  const refreshConnections = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["lead-webhook-connections"],
    });
  };

  const handleSave = async () => {
    if (!editor.name.trim() || !editor.agentId || !editor.defaultStageId) {
      setFormError("Informe o nome, o agente e a etapa padrão.");
      return;
    }
    try {
      setSaving(true);
      setFormError(null);
      if (editor.id) {
        await updateLeadWebhookConnection(editor.id, {
          name: editor.name.trim(),
          agentId: editor.agentId,
          defaultStageId: editor.defaultStageId,
          acceptMedia: editor.acceptMedia,
        });
        toast.success("Conexão atualizada");
      } else {
        const result = await createLeadWebhookConnection({
          name: editor.name.trim(),
          agentId: editor.agentId,
          defaultStageId: editor.defaultStageId,
          acceptMedia: editor.acceptMedia,
        });
        setSecretReveal({
          secret: result.secret,
          title: "Conexão criada",
          description:
            "Copie o segredo agora. Por segurança, ele não será exibido novamente.",
        });
        toast.success("Conexão criada");
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

  const handleToggle = async (connection: LeadWebhookConnection) => {
    try {
      setBusyConnectionId(connection.id);
      await updateLeadWebhookConnection(connection.id, {
        status: connection.status === "active" ? "paused" : "active",
      });
      toast.success(
        connection.status === "active" ? "Conexão pausada" : "Conexão ativada",
      );
      await refreshConnections();
    } catch (error) {
      toast.error("Não foi possível alterar a conexão", {
        description: errorMessage(error),
      });
    } finally {
      setBusyConnectionId(null);
    }
  };

  const handleRotate = async (connection: LeadWebhookConnection) => {
    try {
      setBusyConnectionId(connection.id);
      const result = await rotateLeadWebhookSecret(connection.id);
      setSecretReveal({
        secret: result.secret,
        title: "Segredo renovado",
        description:
          "O segredo anterior continua válido por 24 horas. Atualize o sistema parceiro agora.",
      });
      toast.success("Segredo renovado");
    } catch (error) {
      toast.error("Não foi possível renovar o segredo", {
        description: errorMessage(error),
      });
    } finally {
      setBusyConnectionId(null);
    }
  };

  return (
    <section
      className={mode === "panel" ? "space-y-4" : "mt-8 space-y-4"}
      aria-labelledby="lead-webhook-title"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-primary-600)]">
            Integrações
          </p>
          <h2
            id="lead-webhook-title"
            className="mt-1 text-2xl font-semibold text-[var(--color-gray-900)]"
          >
            Entrada de leads
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-[var(--color-gray-500)]">
            Receba contatos de outro sistema e encaminhe cada novo lead para o
            agente certo.
          </p>
        </div>
        <Button
          type="button"
          onClick={openCreate}
          disabled={availableAgents.length === 0}
        >
          <Plus className="h-4 w-4" />
          Nova conexão
        </Button>
      </div>

      {availableAgents.length === 0 && !agentsLoading ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Ative um agente principal com instância configurada para criar uma
            conexão de leads.
          </span>
        </div>
      ) : null}

      {connectionsQuery.isLoading ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-[var(--color-gray-500)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando conexões...
          </CardContent>
        </Card>
      ) : connectionsQuery.isError ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-4 py-6 text-sm text-[var(--color-gray-600)]">
            Não foi possível carregar as conexões.
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
                        <Webhook className="h-5 w-5" />
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
                    <Badge
                      variant="outline"
                      className={
                        connection.status === "active"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "bg-[var(--color-bg-subtle)] text-[var(--color-gray-600)]"
                      }
                    >
                      {connection.status === "active" ? "Ativa" : "Pausada"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                  {!connection.ready ? (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        {connection.configurationIssue}. Corrija o agente ou a
                        etapa para aceitar novos leads.
                      </span>
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <Label htmlFor={`lead-webhook-url-${connection.id}`}>
                      URL do webhook
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id={`lead-webhook-url-${connection.id}`}
                        value={connection.webhookUrl}
                        readOnly
                        className="min-w-0 font-mono text-xs"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() =>
                          void copyText(connection.webhookUrl, "URL copiada")
                        }
                        aria-label="Copiar URL do webhook"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-[var(--color-gray-500)]">
                        Etapa padrão
                      </p>
                      <p className="mt-1 font-medium text-[var(--color-gray-800)]">
                        {connection.defaultStageName ?? "Etapa indisponível"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--color-gray-500)]">Imagem no webhook</p>
                      <p className="mt-1 font-medium text-[var(--color-gray-800)]">
                        {connection.acceptMedia ? "Permitida" : "Desativada"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--color-gray-500)]">
                        Instância derivada
                      </p>
                      <p className="mt-1 font-medium text-[var(--color-gray-800)]">
                        {connection.instanceName ?? "Indisponível"}
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
                      Renovar segredo
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
              <Link2 className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-[var(--color-gray-900)]">
                Nenhuma conexão configurada
              </p>
              <p className="mt-1 text-sm text-[var(--color-gray-500)]">
                Crie uma conexão para começar a receber leads por webhook.
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
              {editor.id ? "Editar entrada de leads" : "Nova entrada de leads"}
            </DialogTitle>
            <DialogDescription>
              O sistema parceiro enviará nome, telefone, observação e tags para
              esta conexão.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="lead-webhook-name">Nome da conexão</Label>
              <Input
                id="lead-webhook-name"
                value={editor.name}
                onChange={(event) =>
                  setEditor((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Ex.: Campanha Maio"
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-webhook-agent">Agente de IA</Label>
              <Select
                value={editor.agentId}
                onValueChange={(value) =>
                  setEditor((current) => ({ ...current, agentId: value }))
                }
                disabled={saving || agentsLoading}
              >
                <SelectTrigger id="lead-webhook-agent">
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
              <Label htmlFor="lead-webhook-stage">Etapa padrão do funil</Label>
              <Select
                value={editor.defaultStageId}
                onValueChange={(value) =>
                  setEditor((current) => ({
                    ...current,
                    defaultStageId: value,
                  }))
                }
                disabled={saving || stagesLoading}
              >
                <SelectTrigger id="lead-webhook-stage">
                  <SelectValue
                    placeholder={
                      stagesLoading
                        ? "Carregando etapas..."
                        : "Selecione uma etapa"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      {stage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-[var(--radius-lg)] border border-[var(--border-default)] p-4">
              <div className="space-y-1">
                <Label htmlFor="lead-webhook-accept-media">Receber imagem</Label>
                <p className="text-xs text-[var(--color-gray-500)]">
                  Valida URL HTTPS, rede pÃºblica, tipo real e limite de 5 MB.
                </p>
              </div>
              <Switch
                id="lead-webhook-accept-media"
                checked={editor.acceptMedia}
                onCheckedChange={(checked) => setEditor((current) => ({ ...current, acceptMedia: checked }))}
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
              disabled={saving || agentsLoading || stagesLoading}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editor.id ? "Salvar alterações" : "Criar conexão"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(secretReveal)}
        onOpenChange={(open) => {
          if (!open) setSecretReveal(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{secretReveal?.title}</DialogTitle>
            <DialogDescription>{secretReveal?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="lead-webhook-secret">Segredo de autenticação</Label>
            <div className="flex gap-2">
              <Input
                id="lead-webhook-secret"
                value={secretReveal?.secret ?? ""}
                readOnly
                className="min-w-0 font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() =>
                  secretReveal &&
                  void copyText(secretReveal.secret, "Segredo copiado")
                }
                aria-label="Copiar segredo"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setSecretReveal(null)}>
              <Check className="h-4 w-4" />
              Concluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
