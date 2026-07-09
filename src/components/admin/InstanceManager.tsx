import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Copy,
  Eraser,
  Link2,
  Loader2,
  MessageCircle,
  Pencil,
  QrCode,
  RefreshCw,
  Settings2,
  Trash2,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { INSTANCE_COLORS, type InstanceColorKey, getInstanceTextColor } from "@/lib/colors";
import { cn } from "@/lib/utils";
import {
  createInstanceConnection,
  deleteInstance,
  disconnectInstance,
  fetchInstanceStatus,
  listAdminInstances,
  listGupshupChannels,
  listMetaChannels,
  listMetaTemplates,
  reconnectInstanceWithQr,
  refreshInstanceQrCode,
  syncInstanceStatus,
  syncMetaTemplates,
  upsertMetaChannel,
  type AdminInstance,
  type AdminGupshupChannelSummary,
  type AdminInstanceSetupStatus,
  type AdminMetaChannelSummary,
  type AdminMetaTemplate,
  type InstanceConnectionMode,
  type MetaChannelStatus,
} from "@/services/instanceService";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type ConnectionState = "idle" | "checking" | "disconnected" | "connected" | "error";
type DeleteLeadAction = "transfer" | "delete";

function setupStatusLabel(setupStatus: AdminInstanceSetupStatus) {
  switch (setupStatus) {
    case "connected":
      return "Setup concluido";
    case "pending_qr":
      return "Setup pendente";
    case "expired":
      return "Setup expirado";
    case "cancelled":
      return "Setup cancelado";
    default:
      return "Setup pendente";
  }
}

function statusBadge(status: AdminInstance["status"]) {
  switch (status) {
    case "connected":
      return <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">Conectada</Badge>;
    case "connecting":
      return <Badge variant="secondary">Conectando</Badge>;
    case "error":
      return <Badge variant="destructive">Erro</Badge>;
    case "disconnected":
    default:
      return <Badge variant="outline">Desconectada</Badge>;
  }
}

export function InstanceManager() {
  const [instances, setInstances] = useState<AdminInstance[]>([]);
  const [metaChannels, setMetaChannels] = useState<Record<string, AdminMetaChannelSummary>>({});
  const [gupshupChannels, setGupshupChannels] = useState<Record<string, AdminGupshupChannelSummary>>({});
  const [metaTemplates, setMetaTemplates] = useState<Record<string, AdminMetaTemplate[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [instanceNameInput, setInstanceNameInput] = useState("");
  const [connectWebhookEnabled, setConnectWebhookEnabled] = useState(false);
  const [remoteEvolutionUrlInput, setRemoteEvolutionUrlInput] = useState("");
  const [remoteApiKeyInput, setRemoteApiKeyInput] = useState("");
  const [remoteInstanceNameInput, setRemoteInstanceNameInput] = useState("");
  const [creatingInstance, setCreatingInstance] = useState(false);
  const [refreshingQr, setRefreshingQr] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [createdInstanceName, setCreatedInstanceName] = useState<string | null>(null);
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null);
  const [createConnectionMode, setCreateConnectionMode] = useState<InstanceConnectionMode | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [currentSetupStatus, setCurrentSetupStatus] = useState<AdminInstanceSetupStatus | null>(null);
  const [metaDialogOpen, setMetaDialogOpen] = useState(false);
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaInstanceName, setMetaInstanceName] = useState("");
  const [metaForm, setMetaForm] = useState({
    wabaId: "",
    phoneNumberId: "",
    businessId: "",
    displayPhoneNumber: "",
    accessTokenSecretRef: "",
    appSecretRef: "",
    webhookVerifyToken: "",
    status: "draft" as MetaChannelStatus,
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [instancePendingDelete, setInstancePendingDelete] = useState<AdminInstance | null>(null);
  const [deleteLeadAction, setDeleteLeadAction] = useState<DeleteLeadAction>("transfer");
  const [deleteTransferTarget, setDeleteTransferTarget] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  const stateBadge = useMemo(() => {
    switch (connectionState) {
      case "connected":
        return <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">Conectada</Badge>;
      case "checking":
        return (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Verificando
          </Badge>
        );
      case "disconnected":
        return <Badge variant="outline">Aguardando scan</Badge>;
      case "error":
        return <Badge variant="destructive">Erro</Badge>;
      default:
        return <Badge variant="outline">Aguardando</Badge>;
    }
  }, [connectionState]);

  const webhookEndpoint = useMemo(() => {
    const explicitBase =
      (import.meta.env.VITE_WEBHOOK_PUBLIC_BASE_URL as string | undefined) ||
      (import.meta.env.VITE_CRM_BACKEND_URL as string | undefined) ||
      window.location.origin;
    return `${explicitBase.replace(/\/$/, "")}/api/webhook/evolution`;
  }, []);

  const activeCreateMode: InstanceConnectionMode =
    createConnectionMode ?? (connectWebhookEnabled ? "external_webhook" : "local");

  const deleteLeadCount = instancePendingDelete?.leadCount ?? 0;
  const hasLeadsToResolve = deleteLeadCount > 0;
  const transferTargets = useMemo(() => {
    if (!instancePendingDelete) return [];

    return instances.filter((instance) => instance.instanceName !== instancePendingDelete.instanceName);
  }, [instances, instancePendingDelete]);

  const canConfirmDelete = useMemo(() => {
    if (!instancePendingDelete || Boolean(busyAction)) return false;
    if (!hasLeadsToResolve) return true;

    if (deleteLeadAction === "transfer") {
      return Boolean(deleteTransferTarget);
    }

    return deleteConfirmation.trim().toLowerCase() === "apagar";
  }, [
    busyAction,
    deleteConfirmation,
    deleteLeadAction,
    deleteTransferTarget,
    hasLeadsToResolve,
    instancePendingDelete,
  ]);

  const getAccessToken = useCallback(async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;

    const token = data.session?.access_token;
    if (!token) throw new Error("Sessao expirada. Faca login novamente.");
    return token;
  }, []);

  const loadInstances = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setMetaError(null);
      const accessToken = await getAccessToken();
      const result = await listAdminInstances({ accessToken });
      setInstances(result.instances ?? []);
      try {
        const [metaResult, gupshupResult] = await Promise.all([
          listMetaChannels({ accessToken }),
          listGupshupChannels({ accessToken }),
        ]);
        setMetaChannels(
          Object.fromEntries((metaResult.channels ?? []).map((item) => [item.instanceName, item]))
        );
        setGupshupChannels(
          Object.fromEntries((gupshupResult.channels ?? []).map((item) => [item.instanceName, item]))
        );
      } catch (metaErr: any) {
        setMetaChannels({});
        setGupshupChannels({});
        setMetaError(metaErr?.message ?? "Nao foi possivel carregar canais Meta");
      }
    } catch (err: any) {
      setError(err?.message ?? "Nao foi possivel carregar as instancias");
      setInstances([]);
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    loadInstances().catch(() => {
      // erro tratado no loadInstances
    });
  }, [loadInstances]);

  const handleUpdateColor = async (instanceName: string, colorKey: InstanceColorKey) => {
    try {
      setUpdatingId(instanceName);

      const { error } = await supabase
        .from("instance")
        .update({ color: colorKey })
        .eq("instancia", instanceName);

      if (error) throw error;
      toast.success("Cor atualizada com sucesso");
      await loadInstances();
    } catch (err: any) {
      toast.error("Erro ao salvar cor", {
        description: err?.message ?? "Erro desconhecido",
      });
    } finally {
      setUpdatingId(null);
    }
  };

  const openMetaDialog = async (instanceName: string) => {
    const summary = metaChannels[instanceName];
    const channel = summary?.channel;
    setMetaInstanceName(instanceName);
    setMetaForm({
      wabaId: channel?.wabaId ?? "",
      phoneNumberId: channel?.phoneNumberId ?? "",
      businessId: channel?.businessId ?? "",
      displayPhoneNumber: channel?.displayPhoneNumber ?? "",
      accessTokenSecretRef: channel?.accessTokenSecretRef ?? "",
      appSecretRef: channel?.appSecretRef ?? "",
      webhookVerifyToken: channel?.webhookVerifyToken ?? "",
      status: channel?.status ?? "draft",
    });
    setMetaDialogOpen(true);

    try {
      const accessToken = await getAccessToken();
      const result = await listMetaTemplates({ accessToken, instanceName });
      setMetaTemplates((current) => ({
        ...current,
        [instanceName]: result.templates ?? [],
      }));
    } catch {
      setMetaTemplates((current) => ({ ...current, [instanceName]: [] }));
    }
  };

  const handleSaveMetaChannel = async () => {
    if (!metaInstanceName) return;

    try {
      setMetaSaving(true);
      const accessToken = await getAccessToken();
      await upsertMetaChannel({
        accessToken,
        instanceName: metaInstanceName,
        ...metaForm,
      });

      toast.success("Canal Meta salvo");
      await loadInstances();
      setMetaDialogOpen(false);
    } catch (err: any) {
      toast.error("Falha ao salvar canal Meta", { description: err?.message });
    } finally {
      setMetaSaving(false);
    }
  };

  const handleSyncMetaTemplates = async (instanceName: string) => {
    try {
      setBusyAction(`meta-sync:${instanceName}`);
      const accessToken = await getAccessToken();
      const syncResult = await syncMetaTemplates({ accessToken, instanceName });
      const templatesResult = await listMetaTemplates({ accessToken, instanceName });

      setMetaTemplates((current) => ({
        ...current,
        [instanceName]: templatesResult.templates ?? [],
      }));

      await loadInstances();
      toast.success(`Templates sincronizados: ${syncResult.synced}`);
    } catch (err: any) {
      toast.error("Falha ao sincronizar templates Meta", { description: err?.message });
    } finally {
      setBusyAction(null);
    }
  };

  const checkCurrentInstanceStatus = async (nameFromAction?: string) => {
    const instanceName = nameFromAction ?? createdInstanceName;
    if (!instanceName) return;

    try {
      setCheckingStatus(true);
      setConnectionState("checking");
      const accessToken = await getAccessToken();
      const result = await fetchInstanceStatus({
        accessToken,
        instanceName,
      });

      const status = result.status === "connected" ? "connected" : "disconnected";
      setConnectionState(status);
      setCurrentSetupStatus(result.setupStatus);
      setConnectionMessage(
        status === "connected"
          ? "Instancia conectada com sucesso."
          : "Escaneie o QR code no WhatsApp para concluir."
      );

      if (status === "connected") {
        toast.success("Instancia conectada");
      }

      await loadInstances();
    } catch (err: any) {
      setConnectionState("error");
      setConnectionMessage(err?.message || "Falha ao consultar status da instancia.");
    } finally {
      setCheckingStatus(false);
    }
  };

  const handleCreateInstance = async () => {
    const instanceName = instanceNameInput.trim();
    if (!instanceName) {
      toast.error("Informe um nome para a instancia.");
      return;
    }

    if (connectWebhookEnabled && !remoteEvolutionUrlInput.trim()) {
      toast.error("Informe a URL da Evolution externa.");
      return;
    }

    if (connectWebhookEnabled && !remoteApiKeyInput.trim()) {
      toast.error("Informe a API key da Evolution externa.");
      return;
    }

    try {
      setCreatingInstance(true);
      setConnectionMessage(null);
      const accessToken = await getAccessToken();
      const result = await createInstanceConnection({
        accessToken,
        instanceName,
        connectWebhook: connectWebhookEnabled,
        remoteEvolutionUrl: connectWebhookEnabled ? remoteEvolutionUrlInput.trim() : undefined,
        remoteApiKey: connectWebhookEnabled ? remoteApiKeyInput.trim() : undefined,
        remoteInstanceName: connectWebhookEnabled
          ? remoteInstanceNameInput.trim() || instanceName
          : undefined,
      });

      setCreatedInstanceName(result.instanceName);
      setQrCodeBase64(result.qrCodeBase64);
      setCreateConnectionMode(result.connectionMode);
      setConnectionState(result.status === "connected" ? "connected" : "disconnected");
      setCurrentSetupStatus(result.setupStatus);
      setConnectionMessage(
        result.connectionMode === "external_webhook"
          ? result.message ?? "Evolution externa vinculada e webhook configurado."
          : result.status === "connected"
            ? "Instancia ja estava conectada."
            : "Configuracao iniciada. Escaneie o QR code para concluir."
      );

      toast.success(
        result.connectionMode === "external_webhook"
          ? "Webhook externo vinculado"
          : "Instancia registrada no backend"
      );
      await loadInstances();
      if (result.connectionMode === "local" && result.status !== "connected") {
        await checkCurrentInstanceStatus(result.instanceName);
      }
    } catch (err: any) {
      setConnectionState("error");
      setConnectionMessage(err?.message || "Nao foi possivel criar a instancia.");
      toast.error("Falha ao criar instancia", { description: err?.message });
    } finally {
      setCreatingInstance(false);
    }
  };

  const handleStartReconnect = async (instanceName: string) => {
    try {
      setBusyAction(`reconnect:${instanceName}`);
      setConnectWebhookEnabled(false);
      setCreateDialogOpen(true);
      setCreatedInstanceName(instanceName);
      setQrCodeBase64(null);
      setCreateConnectionMode("local");
      setConnectionState("checking");
      setConnectionMessage("Gerando novo QR code...");

      const accessToken = await getAccessToken();
      const result = await reconnectInstanceWithQr({
        accessToken,
        instanceName,
      });

      setQrCodeBase64(result.qrCodeBase64);
      setConnectionState("disconnected");
      setCurrentSetupStatus(result.setupStatus);
      setConnectionMessage("Novo QR code gerado. Escaneie para concluir.");
      await loadInstances();
    } catch (err: any) {
      setConnectionState("error");
      setConnectionMessage(err?.message || "Nao foi possivel reconectar a instancia.");
      toast.error("Falha ao reconectar instancia", { description: err?.message });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRefreshQr = async () => {
    if (!createdInstanceName) return;

    try {
      setRefreshingQr(true);
      const accessToken = await getAccessToken();
      const result = await refreshInstanceQrCode({
        accessToken,
        instanceName: createdInstanceName,
      });

      setQrCodeBase64(result.qrCodeBase64);
      setConnectionState("disconnected");
      setCurrentSetupStatus(result.setupStatus);
      setConnectionMessage("QR code atualizado.");
      await loadInstances();
    } catch (err: any) {
      setConnectionState("error");
      setConnectionMessage(err?.message || "Nao foi possivel atualizar o QR code.");
      toast.error("Falha ao atualizar QR code", { description: err?.message });
    } finally {
      setRefreshingQr(false);
    }
  };

  const handleSyncStatus = async (instanceName: string) => {
    try {
      setBusyAction(`sync:${instanceName}`);
      const accessToken = await getAccessToken();
      const result = await syncInstanceStatus({ accessToken, instanceName });
      await loadInstances();

      if (createdInstanceName === instanceName) {
        setConnectionState(result.status === "connected" ? "connected" : "disconnected");
        setCurrentSetupStatus(result.setupStatus);
      }

      toast.success(`Status atualizado: ${result.status}`);
    } catch (err: any) {
      toast.error("Falha ao sincronizar status", { description: err?.message });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDisconnect = async (instanceName: string) => {
    const confirmed = window.confirm(`Desconectar a instancia "${instanceName}" agora?`);
    if (!confirmed) return;

    try {
      setBusyAction(`disconnect:${instanceName}`);
      const accessToken = await getAccessToken();
      const result = await disconnectInstance({ accessToken, instanceName });
      await loadInstances();

      if (result.warning) {
        toast.warning(result.warning);
      } else {
        toast.success("Instancia desconectada");
      }
    } catch (err: any) {
      toast.error("Falha ao desconectar instancia", { description: err?.message });
    } finally {
      setBusyAction(null);
    }
  };

  const openDeleteDialog = (instance: AdminInstance) => {
    const targets = instances.filter((item) => item.instanceName !== instance.instanceName);
    setInstancePendingDelete(instance);
    setDeleteLeadAction(targets.length > 0 ? "transfer" : "delete");
    setDeleteTransferTarget("");
    setDeleteConfirmation("");
    setDeleteDialogOpen(true);
  };

  const resetDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setInstancePendingDelete(null);
    setDeleteLeadAction("transfer");
    setDeleteTransferTarget("");
    setDeleteConfirmation("");
  };

  const handleDelete = async () => {
    if (!instancePendingDelete) return;

    try {
      setBusyAction(`delete:${instancePendingDelete.instanceName}`);
      const accessToken = await getAccessToken();
      const result = await deleteInstance({
        accessToken,
        instanceName: instancePendingDelete.instanceName,
        hardDelete: false,
        leadAction: hasLeadsToResolve ? deleteLeadAction : "none",
        transferToInstanceName: deleteLeadAction === "transfer" ? deleteTransferTarget : null,
        confirmationText: deleteLeadAction === "delete" ? deleteConfirmation : null,
      });
      await loadInstances();
      resetDeleteDialog();

      if (result.warning) {
        toast.warning(result.warning);
      } else if (result.leadAction === "transfer") {
        toast.success(`Instancia removida e ${result.leadsAffected} leads transferidos`);
      } else if (result.leadAction === "delete") {
        toast.success(`Instancia removida e ${result.leadsAffected} leads apagados`);
      } else {
        toast.success("Instancia removida da lista");
      }
    } catch (err: unknown) {
      toast.error("Falha ao excluir instancia", {
        description: err instanceof Error ? err.message : "Erro desconhecido",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const resetCreateDialog = () => {
    if (createdInstanceName && connectionState !== "connected" && createConnectionMode !== "external_webhook") {
      toast.warning("Configuracao incompleta; voce pode continuar depois em Gerenciar Instancias.");
    }

    setCreateDialogOpen(false);
    setInstanceNameInput("");
    setConnectWebhookEnabled(false);
    setRemoteEvolutionUrlInput("");
    setRemoteApiKeyInput("");
    setRemoteInstanceNameInput("");
    setCreatedInstanceName(null);
    setQrCodeBase64(null);
    setCreateConnectionMode(null);
    setConnectionState("idle");
    setConnectionMessage(null);
    setCurrentSetupStatus(null);
    setRefreshingQr(false);
    setCheckingStatus(false);
  };

  const openCreateDialog = (mode: InstanceConnectionMode) => {
    setConnectWebhookEnabled(mode === "external_webhook");
    setCreateConnectionMode(mode);
    setCreateDialogOpen(true);
  };

  const handleCopyWebhookEndpoint = async () => {
    try {
      await navigator.clipboard.writeText(webhookEndpoint);
      toast.success("Endpoint do webhook copiado");
    } catch {
      toast.error("Nao foi possivel copiar o endpoint");
    }
  };

  useEffect(() => {
    if (!createDialogOpen || !createdInstanceName || connectionState === "connected") {
      return;
    }

    const timer = setInterval(() => {
      checkCurrentInstanceStatus().catch(() => {
        // erro tratado no metodo
      });
    }, 5000);

    return () => clearInterval(timer);
  }, [createDialogOpen, createdInstanceName, connectionState]);

  if (loading) {
    return (
      <Card className="p-6 space-y-4">
        <Skeleton className="h-8 w-40 mb-4" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </Card>
    );
  }

  return (
    <>
      <Card className="p-6">
        <div className="mb-4 flex flex-col items-start justify-between gap-4 border-b border-border pb-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-xl font-semibold">Gerenciar Instancias</h2>
              <p className="text-sm text-muted-foreground">
                Controle o ciclo de vida completo: criar, retomar setup, reconectar, sincronizar, desconectar e excluir.
              </p>
            </div>
          </div>

          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
            <Button
              variant="outline"
              onClick={() => openCreateDialog("local")}
              className="flex-1 gap-2 sm:flex-none"
            >
              <QrCode className="h-4 w-4" />
              Nova com QR
            </Button>
            <Button
              onClick={() => openCreateDialog("external_webhook")}
              className="flex-1 gap-2 sm:flex-none"
            >
              <Link2 className="h-4 w-4" />
              Vincular Evolution externa
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-destructive/10 text-destructive text-sm rounded-md flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {metaError && (
          <div className="mb-4 p-3 bg-muted text-muted-foreground text-sm rounded-md flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {metaError}
          </div>
        )}

        {instances.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground bg-muted/30 rounded-lg border border-dashed flex flex-col items-center gap-2">
            <span>Nenhuma instancia ativa encontrada para sua conta.</span>
            {!error && (
              <span className="text-xs opacity-70">
                Vincule uma Evolution externa existente ou crie uma instancia local com QR code.
              </span>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {instances.map((instance) => {
              const actions = new Set(instance.actions);
              const isBusy = Boolean(busyAction);
              const metaSummary = metaChannels[instance.instanceName];
              const gupshupSummary = gupshupChannels[instance.instanceName];
              const metaChannel = metaSummary?.channel ?? null;
              const gupshupChannel = gupshupSummary?.gupshupChannel ?? null;
              const providerName =
                gupshupSummary?.provider ?? metaSummary?.provider ?? "evolution";
              const templates = metaTemplates[instance.instanceName] ?? [];

              return (
                <div
                  key={instance.instanceName}
                  className="p-3 rounded-lg border bg-card hover:bg-muted/20 transition-colors space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-sm">{instance.instanceName}</span>
                      <div className="flex flex-wrap items-center gap-2">
                        {statusBadge(instance.status)}
                        {providerName === "gupshup" ? (
                          <Badge variant={gupshupChannel?.status === "active" ? "secondary" : "outline"}>
                            Gupshup {gupshupChannel?.status ?? "nao configurada"}
                          </Badge>
                        ) : metaChannel ? (
                          <Badge variant={metaChannel.status === "active" ? "secondary" : "outline"}>
                            Meta {metaChannel.status}
                          </Badge>
                        ) : (
                          <Badge variant="outline">Meta nao configurada</Badge>
                        )}
                        <Badge variant="outline">
                          {instance.leadCount ?? 0} leads
                        </Badge>
                      </div>
                      {instance.expiresAt && instance.setupStatus === "pending_qr" && (
                        <span className="text-xs text-muted-foreground">
                          Expira em: {new Date(instance.expiresAt).toLocaleString("pt-BR")}
                        </span>
                      )}
                      {instance.lastError && (
                        <span className="text-xs text-destructive">{instance.lastError}</span>
                      )}
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                          Preview
                        </span>
                        <span className={cn("text-sm font-medium", getInstanceTextColor(instance.color))}>
                          {instance.instanceName}
                        </span>
                      </div>

                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                            {updatingId === instance.instanceName ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Pencil className="h-4 w-4 text-muted-foreground" />
                            )}
                          </Button>
                        </PopoverTrigger>

                        <PopoverContent className="w-auto p-4" align="center">
                          <div className="space-y-2">
                            <h4 className="font-medium leading-none text-sm">Escolha um tema</h4>
                            <p className="text-xs text-muted-foreground">Isso define a cor do texto da instancia.</p>

                            <ScrollArea className="h-[200px] pr-2">
                              <div className="grid grid-cols-4 gap-2 mt-2 p-3">
                                {Object.entries(INSTANCE_COLORS).map(([key, value]) => (
                                  <button
                                    key={key}
                                    onClick={() => handleUpdateColor(instance.instanceName, key as InstanceColorKey)}
                                    className={cn(
                                      "w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110 focus:outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2",
                                      value.dot,
                                      instance.color === key && "ring-2 ring-ring ring-offset-1 scale-110"
                                    )}
                                    title={value.label}
                                  >
                                    {instance.color === key && (
                                      <Check className="w-4 h-4 text-white drop-shadow-md" strokeWidth={3} />
                                    )}
                                  </button>
                                ))}
                              </div>
                            </ScrollArea>
                          </div>
                        </PopoverContent>
                      </Popover>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                        disabled={isBusy}
                        onClick={() => openDeleteDialog(instance)}
                      >
                        {busyAction === `delete:${instance.instanceName}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {actions.has("continue_setup") && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => handleStartReconnect(instance.instanceName)}
                      >
                        <QrCode className="h-3.5 w-3.5 mr-1.5" />
                        {instance.setupStatus === "expired" ? "Retomar setup" : "Continuar setup"}
                      </Button>
                    )}

                    {actions.has("reconnect") && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => handleStartReconnect(instance.instanceName)}
                      >
                        <Link2 className="h-3.5 w-3.5 mr-1.5" />
                        Reconectar
                      </Button>
                    )}

                    {actions.has("sync_status") && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => handleSyncStatus(instance.instanceName)}
                      >
                        {busyAction === `sync:${instance.instanceName}` ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Atualizar status
                      </Button>
                    )}

                    {providerName !== "gupshup" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => openMetaDialog(instance.instanceName)}
                      >
                        <MessageCircle className="h-3.5 w-3.5 mr-1.5" />
                        Meta
                      </Button>
                    ) : null}

                    {metaChannel && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => handleSyncMetaTemplates(instance.instanceName)}
                      >
                        {busyAction === `meta-sync:${instance.instanceName}` ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Templates{templates.length ? ` (${templates.length})` : ""}
                      </Button>
                    )}

                    {actions.has("disconnect") && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => handleDisconnect(instance.instanceName)}
                      >
                        {busyAction === `disconnect:${instance.instanceName}` ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <Unplug className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Desconectar
                      </Button>
                    )}

                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Dialog open={metaDialogOpen} onOpenChange={setMetaDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5" />
              Canal Meta
            </DialogTitle>
            <DialogDescription>
              {metaInstanceName || "Instancia"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="meta-waba-id">WABA ID</Label>
              <Input
                id="meta-waba-id"
                value={metaForm.wabaId}
                onChange={(event) => setMetaForm((current) => ({ ...current, wabaId: event.target.value }))}
                placeholder="mock_waba_id"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="meta-phone-number-id">Phone number ID</Label>
              <Input
                id="meta-phone-number-id"
                value={metaForm.phoneNumberId}
                onChange={(event) => setMetaForm((current) => ({ ...current, phoneNumberId: event.target.value }))}
                placeholder="mock_phone_number_id"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="meta-business-id">Business ID</Label>
              <Input
                id="meta-business-id"
                value={metaForm.businessId}
                onChange={(event) => setMetaForm((current) => ({ ...current, businessId: event.target.value }))}
                placeholder="mock_business_id"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="meta-display-phone">Telefone exibido</Label>
              <Input
                id="meta-display-phone"
                value={metaForm.displayPhoneNumber}
                onChange={(event) => setMetaForm((current) => ({ ...current, displayPhoneNumber: event.target.value }))}
                placeholder="+55 11 99999-9999"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="meta-token-ref">Token secret ref</Label>
              <Input
                id="meta-token-ref"
                value={metaForm.accessTokenSecretRef}
                onChange={(event) => setMetaForm((current) => ({ ...current, accessTokenSecretRef: event.target.value }))}
                placeholder="META_ACCESS_TOKEN_MOCK"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="meta-app-secret-ref">App secret ref</Label>
              <Input
                id="meta-app-secret-ref"
                value={metaForm.appSecretRef}
                onChange={(event) => setMetaForm((current) => ({ ...current, appSecretRef: event.target.value }))}
                placeholder="META_WEBHOOK_APP_SECRET"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="meta-verify-token">Verify token</Label>
              <Input
                id="meta-verify-token"
                value={metaForm.webhookVerifyToken}
                onChange={(event) => setMetaForm((current) => ({ ...current, webhookVerifyToken: event.target.value }))}
                placeholder="local-dev-verify-token"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="meta-status">Status</Label>
              <select
                id="meta-status"
                value={metaForm.status}
                onChange={(event) =>
                  setMetaForm((current) => ({
                    ...current,
                    status: event.target.value as MetaChannelStatus,
                  }))
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="draft">draft</option>
                <option value="active">active</option>
                <option value="disabled">disabled</option>
                <option value="error">error</option>
              </select>
            </div>
          </div>

          {metaInstanceName && metaTemplates[metaInstanceName]?.length > 0 && (
            <div className="rounded-md border p-3">
              <div className="mb-2 text-sm font-medium">Templates</div>
              <div className="flex flex-wrap gap-2">
                {metaTemplates[metaInstanceName].map((template) => (
                  <Badge key={template.id} variant="outline">
                    {template.name} · {template.language} · {template.status}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setMetaDialogOpen(false)} disabled={metaSaving}>
              Cancelar
            </Button>
            {metaInstanceName && metaChannels[metaInstanceName]?.channel && (
              <Button
                variant="outline"
                disabled={metaSaving || Boolean(busyAction)}
                onClick={() => handleSyncMetaTemplates(metaInstanceName)}
              >
                {busyAction === `meta-sync:${metaInstanceName}` ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Sincronizar templates
              </Button>
            )}
            <Button onClick={handleSaveMetaChannel} disabled={metaSaving}>
              {metaSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Salvar canal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={(open) => (open ? setDeleteDialogOpen(true) : resetDeleteDialog())}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Excluir instancia
            </DialogTitle>
            <DialogDescription>
              {instancePendingDelete?.instanceName ?? "Instancia"}
            </DialogDescription>
          </DialogHeader>

          {instancePendingDelete && (
            <div className="space-y-4">
              {hasLeadsToResolve ? (
                <>
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Leads vinculados</AlertTitle>
                    <AlertDescription>
                      Esta instancia possui <strong>{deleteLeadCount} leads ativos</strong>. Escolha o destino desses
                      leads antes de concluir a exclusao.
                    </AlertDescription>
                  </Alert>

                  <RadioGroup
                    value={deleteLeadAction}
                    onValueChange={(value) => setDeleteLeadAction(value as DeleteLeadAction)}
                    className="gap-3"
                  >
                    <div className="rounded-md border p-4">
                      <div className="flex items-start gap-3">
                        <RadioGroupItem
                          id="delete-instance-transfer"
                          value="transfer"
                          disabled={transferTargets.length === 0}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1 space-y-3">
                          <Label htmlFor="delete-instance-transfer" className="flex items-center gap-2">
                            <ArrowRight className="h-4 w-4" />
                            Transferir leads
                          </Label>
                          <Select
                            value={deleteTransferTarget}
                            onValueChange={setDeleteTransferTarget}
                            disabled={deleteLeadAction !== "transfer" || transferTargets.length === 0}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione a instancia de destino" />
                            </SelectTrigger>
                            <SelectContent>
                              {transferTargets.map((instance) => (
                                <SelectItem key={instance.instanceName} value={instance.instanceName}>
                                  {instance.instanceName} ({instance.leadCount ?? 0} leads)
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {transferTargets.length === 0 && (
                            <p className="text-xs text-muted-foreground">
                              Nao ha outra instancia ativa do usuario para receber esses leads.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border border-destructive/30 p-4">
                      <div className="flex items-start gap-3">
                        <RadioGroupItem id="delete-instance-delete-leads" value="delete" className="mt-1" />
                        <div className="min-w-0 flex-1 space-y-3">
                          <Label htmlFor="delete-instance-delete-leads" className="flex items-center gap-2">
                            <Eraser className="h-4 w-4" />
                            Apagar leads
                          </Label>
                          <Input
                            value={deleteConfirmation}
                            onChange={(event) => setDeleteConfirmation(event.target.value)}
                            disabled={deleteLeadAction !== "delete"}
                            placeholder='Digite "apagar"'
                          />
                        </div>
                      </div>
                    </div>
                  </RadioGroup>
                </>
              ) : (
                <Alert>
                  <Trash2 className="h-4 w-4" />
                  <AlertTitle>Nenhum lead ativo</AlertTitle>
                  <AlertDescription>
                    Esta instancia sera removida da lista e o setup sera cancelado no CRM.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={resetDeleteDialog} disabled={Boolean(busyAction)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={!canConfirmDelete}>
              {busyAction === `delete:${instancePendingDelete?.instanceName}` ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Excluir instancia
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createDialogOpen} onOpenChange={(open) => (open ? undefined : resetCreateDialog())}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {activeCreateMode === "external_webhook" ? (
                <Link2 className="h-5 w-5" />
              ) : (
                <QrCode className="h-5 w-5" />
              )}
              {activeCreateMode === "external_webhook" ? "Vincular Evolution externa" : "Nova instancia local"}
            </DialogTitle>
            <DialogDescription>
              {activeCreateMode === "external_webhook"
                ? "Use uma instancia que ja esta conectada ao WhatsApp em outro servidor. Este fluxo vincula somente o webhook."
                : "Crie a instancia na Evolution deste CRM e conecte o WhatsApp pelo QR code."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="instance-name">
                {activeCreateMode === "external_webhook" ? "Nome da instancia no CRM" : "Nome da instancia"}
              </Label>
              <Input
                id="instance-name"
                placeholder="Ex: EquipeComercial01"
                value={instanceNameInput}
                onChange={(event) => setInstanceNameInput(event.target.value)}
                disabled={creatingInstance || Boolean(createdInstanceName)}
              />
            </div>

            {!createdInstanceName && activeCreateMode === "external_webhook" && (
              <div className="space-y-4 rounded-xl border border-border bg-[var(--color-surface-2)] p-4 shadow-sm">
                <Alert>
                  <Link2 className="h-4 w-4" />
                  <AlertTitle>Nenhum QR code sera gerado</AlertTitle>
                  <AlertDescription>
                    Mantenha o WhatsApp conectado na Evolution externa. Ao vincular, o backend configurara o endpoint
                    abaixo para o evento MESSAGES_UPSERT.
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Label htmlFor="external-webhook-endpoint">Endpoint do nosso webhook</Label>
                  <div className="flex gap-2">
                    <Input
                      id="external-webhook-endpoint"
                      value={webhookEndpoint}
                      readOnly
                      className="min-w-0 font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={handleCopyWebhookEndpoint}
                      disabled={creatingInstance}
                      aria-label="Copiar endpoint do webhook"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="remote-evolution-url">URL da Evolution externa</Label>
                  <Input
                    id="remote-evolution-url"
                    type="url"
                    placeholder="https://evolution.exemplo.com"
                    value={remoteEvolutionUrlInput}
                    onChange={(event) => setRemoteEvolutionUrlInput(event.target.value)}
                    disabled={creatingInstance}
                    autoComplete="url"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="remote-api-key">API key da Evolution externa</Label>
                  <Input
                    id="remote-api-key"
                    type="password"
                    placeholder="Informe a API key"
                    value={remoteApiKeyInput}
                    onChange={(event) => setRemoteApiKeyInput(event.target.value)}
                    disabled={creatingInstance}
                    autoComplete="new-password"
                  />
                  <p className="text-xs text-muted-foreground">
                    A credencial sera enviada somente ao backend e nao sera exibida novamente.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="remote-instance-name">Nome exato na Evolution externa</Label>
                  <Input
                    id="remote-instance-name"
                    placeholder={instanceNameInput.trim() || "Ex: Cliente01"}
                    value={remoteInstanceNameInput}
                    onChange={(event) => setRemoteInstanceNameInput(event.target.value)}
                    disabled={creatingInstance}
                  />
                  <p className="text-xs text-muted-foreground">
                    Esse nome identifica os eventos recebidos. Se ficar vazio, usaremos o nome informado no CRM.
                  </p>
                </div>
              </div>
            )}

            {createdInstanceName && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{createdInstanceName}</span>
                  {createConnectionMode === "external_webhook" ? (
                    <Badge variant="outline">Webhook vinculado</Badge>
                  ) : (
                    stateBadge
                  )}
                </div>

                {createConnectionMode === "external_webhook" ? (
                  <Alert>
                    <Check className="h-4 w-4" />
                    <AlertTitle>Webhook vinculado</AlertTitle>
                    <AlertDescription>
                      A instancia externa foi vinculada ao CRM. A conexao do WhatsApp continua sendo administrada no outro servidor.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="border rounded-md p-3 flex items-center justify-center bg-muted/20 min-h-[220px]">
                    {qrCodeBase64 ? (
                      <img
                        src={qrCodeBase64}
                        alt="QR code para conectar instancia"
                        className="h-52 w-52 object-contain"
                      />
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Carregando QR code...
                      </div>
                    )}
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  {createConnectionMode === "external_webhook"
                    ? "Webhook externo vinculado sem gerar QR code"
                    : currentSetupStatus ? setupStatusLabel(currentSetupStatus) : "Setup pendente"}
                </p>

                {connectionMessage && (
                  <p className="text-xs text-muted-foreground">{connectionMessage}</p>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            {createdInstanceName ? (
              <>
                {createConnectionMode !== "external_webhook" && (
                  <>
                    <Button
                      variant="outline"
                      onClick={handleRefreshQr}
                      disabled={refreshingQr || creatingInstance}
                    >
                      {refreshingQr ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      Atualizar QR
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => checkCurrentInstanceStatus()}
                      disabled={checkingStatus || creatingInstance}
                    >
                      {checkingStatus ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      Verificar status
                    </Button>
                  </>
                )}
                <Button onClick={resetCreateDialog}>Fechar</Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={resetCreateDialog} disabled={creatingInstance}>
                  Cancelar
                </Button>
                <Button onClick={handleCreateInstance} disabled={creatingInstance}>
                  {creatingInstance ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  {activeCreateMode === "external_webhook" ? "Vincular webhook" : "Criar e gerar QR"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
