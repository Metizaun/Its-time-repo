import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Cable,
  Check,
  Copy,
  Database,
  Eraser,
  Instagram,
  Link2,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Trash2,
  Unplug,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { INSTANCE_COLORS, type InstanceColorKey, getInstanceTextColor } from "@/lib/colors";
import { cn } from "@/lib/utils";
import {
  createInstanceConnection,
  deleteInstance,
  deleteRbConnection,
  disconnectInstance,
  fetchInstanceStatus,
  listAdminInstances,
  listGupshupChannels,
  listInstagramChannels,
  refreshInstagramChannel,
  disableInstagramChannel,
  listMetaChannels,
  listMetaTemplates,
  listRbConnections,
  reconnectInstanceWithQr,
  refreshInstanceQrCode,
  syncInstanceStatus,
  syncMetaTemplates,
  saveRbConnection,
  startInstagramOAuth,
  upsertGupshupChannel,
  upsertMetaChannel,
  type AdminGupshupChannel,
  type AdminInstance,
  type AdminInstagramChannel,
  type AdminGupshupChannelSummary,
  type AdminInstanceSetupStatus,
  type AdminMetaChannelSummary,
  type AdminMetaTemplate,
  type AdminRbConnection,
  type InstanceConnectionMode,
  type MetaChannelStatus,
} from "@/services/instanceService";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Switch } from "@/components/ui/switch";
import { ConnectionCard, type ConnectionStatus } from "@/components/connections/ConnectionCard";

type ConnectionState = "idle" | "checking" | "disconnected" | "connected" | "error";
type DeleteLeadAction = "transfer" | "delete";
type ExternalConnectionType = "selection" | "webhook" | "gupshup" | "instagram" | "rb";
type ConnectionProvider = "whatsapp-free" | "whatsapp-official" | "gupshup" | "instagram" | "registro-base";

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

export function InstanceManager({
  onOpenBilling,
  billingStatus = "not_configured",
  billingStatusLabel = "Não configurada",
}: {
  onOpenBilling?: () => void;
  billingStatus?: ConnectionStatus;
  billingStatusLabel?: string;
} = {}) {
  const [instances, setInstances] = useState<AdminInstance[]>([]);
  const [rbConnections, setRbConnections] = useState<AdminRbConnection[]>([]);
  const [metaChannels, setMetaChannels] = useState<Record<string, AdminMetaChannelSummary>>({});
  const [gupshupChannels, setGupshupChannels] = useState<Record<string, AdminGupshupChannelSummary>>({});
  const [instagramChannels, setInstagramChannels] = useState<Record<string, AdminInstagramChannel>>({});
  const [metaTemplates, setMetaTemplates] = useState<Record<string, AdminMetaTemplate[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [instagramPendingDisable, setInstagramPendingDisable] = useState<AdminInstagramChannel | null>(null);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [instanceNameInput, setInstanceNameInput] = useState("");
  const [connectWebhookEnabled, setConnectWebhookEnabled] = useState(false);
  const [externalConnectionType, setExternalConnectionType] = useState<ExternalConnectionType | null>(null);
  const [remoteEvolutionUrlInput, setRemoteEvolutionUrlInput] = useState("");
  const [remoteApiKeyInput, setRemoteApiKeyInput] = useState("");
  const [remoteInstanceNameInput, setRemoteInstanceNameInput] = useState("");
  const [gupshupSaving, setGupshupSaving] = useState(false);
  const [gupshupForm, setGupshupForm] = useState({
    appName: "",
    appId: "",
    apiKey: "",
    phoneNumber: "",
  });
  const [rbSaving, setRbSaving] = useState(false);
  const [rbForm, setRbForm] = useState({
    id: "",
    rbAcesId: "",
    rbTokenApi: "",
    rbEmpresaIds: "",
    billingEnabled: false,
  });
  const [creatingInstance, setCreatingInstance] = useState(false);
  const [refreshingQr, setRefreshingQr] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [createdInstanceName, setCreatedInstanceName] = useState<string | null>(null);
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null);
  const [createConnectionMode, setCreateConnectionMode] = useState<InstanceConnectionMode | null>(null);
  const [connectionPanel, setConnectionPanel] = useState<ConnectionProvider | null>(null);
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

  // Guarda o ultimo status/setupStatus verificado pelo polling do QR code,
  // para so recarregar a lista completa quando algo de fato mudar (evita
  // ficar re-buscando tudo a cada tick so para constatar "continua igual").
  const lastPolledStatusRef = useRef<{
    status: "connected" | "disconnected" | null;
    setupStatus: AdminInstanceSetupStatus | null;
  }>({ status: null, setupStatus: null });

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

  const loadInstances = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;

    try {
      if (!silent) {
        setLoading(true);
        setError(null);
        setMetaError(null);
      }
      const accessToken = await getAccessToken();
      const result = await listAdminInstances({ accessToken });
      setInstances(result.instances ?? []);
      try {
        const [metaResult, gupshupResult, instagramResult, rbResult] = await Promise.all([
          listMetaChannels({ accessToken }),
          listGupshupChannels({ accessToken }),
          listInstagramChannels({ accessToken }),
          listRbConnections({ accessToken }),
        ]);
        setMetaChannels(
          Object.fromEntries((metaResult.channels ?? []).map((item) => [item.instanceName, item]))
        );
        setGupshupChannels(
          Object.fromEntries((gupshupResult.channels ?? []).map((item) => [item.instanceName, item]))
        );
        setInstagramChannels(
          Object.fromEntries((instagramResult.channels ?? []).map((item) => [item.instanceName, item]))
        );
        setRbConnections(rbResult.connections ?? []);
      } catch (metaErr: any) {
        if (silent) {
          // Refresh em segundo plano: mantem os dados ja carregados na tela
          // em vez de limpar os canais por causa de uma falha passageira.
          console.error("Falha ao atualizar canais (refresh em segundo plano):", metaErr);
        } else {
          setMetaChannels({});
          setGupshupChannels({});
          setInstagramChannels({});
          setRbConnections([]);
          setMetaError(metaErr?.message ?? "Nao foi possivel carregar canais Meta");
        }
      }
    } catch (err: any) {
      if (silent) {
        // Idem: nao apaga a lista de instancias nem mostra o banner de erro
        // por causa de uma falha passageira durante um refresh silencioso.
        console.error("Falha ao atualizar instancias (refresh em segundo plano):", err);
      } else {
        setError(err?.message ?? "Nao foi possivel carregar as instancias");
        setInstances([]);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
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
      await loadInstances({ silent: true });
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

  const openGupshupDialog = (instanceName = "") => {
    const channel = gupshupChannels[instanceName]?.gupshupChannel;
    setInstanceNameInput(instanceName);
    setGupshupForm({
      appName: channel?.appName ?? "",
      appId: channel?.appId ?? "",
      apiKey: "",
      phoneNumber: channel?.phoneNumber ?? "",
    });
    setConnectWebhookEnabled(true);
    setCreateConnectionMode("external_webhook");
    setExternalConnectionType("gupshup");
    setCreateDialogOpen(true);
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
      await loadInstances({ silent: true });
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

      await loadInstances({ silent: true });
      toast.success(`Templates sincronizados: ${syncResult.synced}`);
    } catch (err: any) {
      toast.error("Falha ao sincronizar templates Meta", { description: err?.message });
    } finally {
      setBusyAction(null);
    }
  };

  const checkCurrentInstanceStatus = useCallback(async (nameFromAction?: string) => {
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

      const previousPoll = lastPolledStatusRef.current;
      const pollChanged =
        previousPoll.status !== status || previousPoll.setupStatus !== result.setupStatus;
      lastPolledStatusRef.current = { status, setupStatus: result.setupStatus };

      if (pollChanged) {
        // So recarrega a lista completa (instancias + Meta + Gupshup + RB)
        // quando o status realmente mudou. Evita reconstruir a tela inteira
        // a cada 5s so para confirmar "ainda aguardando o scan".
        await loadInstances({ silent: true });
      }
    } catch (err: any) {
      setConnectionState("error");
      setConnectionMessage(err?.message || "Falha ao consultar status da instancia.");
    } finally {
      setCheckingStatus(false);
    }
  }, [createdInstanceName, getAccessToken, loadInstances]);

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
      await loadInstances({ silent: true });
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

  const handleConnectInstagram = async (existingInstanceName?: string) => {
    const instanceName = (existingInstanceName ?? instanceNameInput).trim();
    if (!instanceName) {
      toast.error("Informe um nome para a instancia.");
      return;
    }

    try {
      const actionKey = `instagram:${instanceName}`;
      if (existingInstanceName) setBusyAction(actionKey);
      else setCreatingInstance(true);
      const accessToken = await getAccessToken();
      const result = await startInstagramOAuth({ accessToken, instanceName });
      window.location.assign(result.authorizationUrl);
    } catch (err: unknown) {
      toast.error("Falha ao conectar Instagram", {
        description: err instanceof Error ? err.message : "Tente novamente.",
      });
      setBusyAction(null);
      setCreatingInstance(false);
    }
  };

  const handleRefreshInstagram = async (channel: AdminInstagramChannel) => {
    try {
      setBusyAction(`instagram-refresh:${channel.channelId}`);
      const accessToken = await getAccessToken();
      await refreshInstagramChannel({ accessToken, channelId: channel.channelId });
      toast.success("Conexao Instagram renovada");
      await loadInstances({ silent: true });
    } catch (err: any) {
      toast.error("Nao foi possivel renovar a conexao Instagram", { description: err?.message });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDisableInstagram = async () => {
    const channel = instagramPendingDisable;
    if (!channel) return;
    try {
      setBusyAction(`instagram-disable:${channel.channelId}`);
      const accessToken = await getAccessToken();
      await disableInstagramChannel({ accessToken, channelId: channel.channelId });
      setInstagramPendingDisable(null);
      toast.success("Canal Instagram desativado");
      await loadInstances({ silent: true });
    } catch (err: any) {
      toast.error("Nao foi possivel desativar o canal Instagram", { description: err?.message });
    } finally {
      setBusyAction(null);
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
      await loadInstances({ silent: true });
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
      await loadInstances({ silent: true });
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
      await loadInstances({ silent: true });

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

  const handleSaveGupshupChannel = async () => {
    const instanceName = instanceNameInput.trim();
    if (!instanceName) {
      toast.error("Informe o nome da instancia.");
      return;
    }

    if (!gupshupForm.appName.trim() || !gupshupForm.appId.trim() || !gupshupForm.apiKey.trim() || !gupshupForm.phoneNumber.trim()) {
      toast.error("Preencha os dados da conexao Gupshup.");
      return;
    }

    try {
      setGupshupSaving(true);
      const accessToken = await getAccessToken();
      const result = await upsertGupshupChannel({
        accessToken,
        instanceName,
        appName: gupshupForm.appName.trim(),
        appId: gupshupForm.appId.trim(),
        apiKey: gupshupForm.apiKey.trim(),
        phoneNumber: gupshupForm.phoneNumber.trim(),
        status: "active",
      });

      setGupshupChannels((current) => ({
        ...current,
        [instanceName]: {
          instanceName,
          provider: "gupshup",
          gupshupChannel: result.channel as AdminGupshupChannel,
        },
      }));
      await loadInstances({ silent: true });
      toast.success("Conexao Gupshup salva");
      resetCreateDialog();
    } catch (err: any) {
      toast.error("Falha ao salvar conexao Gupshup", { description: err?.message });
    } finally {
      setGupshupSaving(false);
    }
  };

  const handleSaveRbConnection = async () => {
    const empresaIds = rbForm.rbEmpresaIds.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
    const rbAcesId = Number(rbForm.rbAcesId.trim());
    if (!Number.isInteger(rbAcesId) || rbAcesId <= 0) {
      toast.error("Informe um ID RB válido.");
      return;
    }
    if (!rbForm.id && !rbForm.rbTokenApi.trim()) {
      toast.error("Informe o Token API.");
      return;
    }
    if (empresaIds.length === 0) {
      toast.error("Informe ao menos uma empresa.");
      return;
    }

    try {
      setRbSaving(true);
      const accessToken = await getAccessToken();
      await saveRbConnection({
        accessToken,
        id: rbForm.id || null,
        rbAcesId,
        rbTokenApi: rbForm.rbTokenApi.trim() || null,
        rbEmpresaIds: empresaIds,
        billingEnabled: rbForm.billingEnabled,
      });
      await loadInstances({ silent: true });
      toast.success("Conexão Via RB salva");
      resetCreateDialog();
    } catch (err: unknown) {
      toast.error("Falha ao salvar conexão Via RB", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setRbSaving(false);
    }
  };

  const handleToggleRbBilling = async (connection: AdminRbConnection, billingEnabled: boolean) => {
    if (!connection.rbAcesId) {
      toast.error("Esta conexão não possui um ID RB válido.");
      return;
    }

    try {
      setBusyAction(`toggle-rb-billing:${connection.id}`);
      const accessToken = await getAccessToken();
      await saveRbConnection({
        accessToken,
        id: connection.id,
        rbAcesId: connection.rbAcesId,
        rbTokenApi: null,
        rbEmpresaIds: connection.rbEmpresaIds,
        billingEnabled,
      });
      await loadInstances({ silent: true });
      toast.success(billingEnabled ? "Cobrança RB ativada" : "Cobrança RB pausada");
    } catch (err: unknown) {
      toast.error("Falha ao atualizar a Cobrança RB", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const openRbConnection = (connection: AdminRbConnection) => {
    setRbForm({
      id: connection.id,
      rbAcesId: connection.rbAcesId === null ? "" : String(connection.rbAcesId),
      rbTokenApi: "",
      rbEmpresaIds: connection.rbEmpresaIds.join(", "),
      billingEnabled: connection.billingEnabled,
    });
    setConnectWebhookEnabled(true);
    setCreateConnectionMode("external_webhook");
    setExternalConnectionType("rb");
    setCreateDialogOpen(true);
  };

  const handleDeleteRbConnection = async (connection: AdminRbConnection) => {
    if (!window.confirm("Excluir a conexão Via RB?")) return;
    try {
      setBusyAction(`delete-rb:${connection.id}`);
      const accessToken = await getAccessToken();
      await deleteRbConnection({ accessToken, connectionId: connection.id });
      await loadInstances({ silent: true });
      toast.success("Conexão Via RB excluída");
    } catch (err: unknown) {
      toast.error("Falha ao excluir conexão Via RB", {
        description: err instanceof Error ? err.message : undefined,
      });
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
      await loadInstances({ silent: true });

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
      await loadInstances({ silent: true });
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
      toast.warning("Configuração incompleta; você pode continuar depois em Gerenciar conexões.");
    }

    setCreateDialogOpen(false);
    setInstanceNameInput("");
    setConnectWebhookEnabled(false);
    setExternalConnectionType(null);
    setRemoteEvolutionUrlInput("");
    setRemoteApiKeyInput("");
    setRemoteInstanceNameInput("");
    setGupshupForm({
      appName: "",
      appId: "",
      apiKey: "",
      phoneNumber: "",
    });
    setRbForm({
      id: "",
      rbAcesId: "",
      rbTokenApi: "",
      rbEmpresaIds: "",
      billingEnabled: false,
    });
    setGupshupSaving(false);
    setCreatedInstanceName(null);
    setQrCodeBase64(null);
    setCreateConnectionMode(null);
    setConnectionState("idle");
    setConnectionMessage(null);
    setCurrentSetupStatus(null);
    setRefreshingQr(false);
    setCheckingStatus(false);
  };

  const openCreateDialog = (mode: InstanceConnectionMode, connectionType?: ExternalConnectionType) => {
    setConnectWebhookEnabled(mode === "external_webhook");
    setExternalConnectionType(mode === "external_webhook" ? connectionType ?? "selection" : null);
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
    // Nova sessao de setup (instancia diferente ou dialogo reaberto): reseta
    // a referencia de comparacao do polling para nao herdar o status da
    // sessao anterior.
    lastPolledStatusRef.current = { status: null, setupStatus: null };
  }, [createdInstanceName]);

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
  }, [checkCurrentInstanceStatus, createDialogOpen, createdInstanceName, connectionState]);

  const isExternalConnectionPicker =
    activeCreateMode === "external_webhook" && !createdInstanceName && externalConnectionType === "selection";
  const isWebhookConnectionForm =
    activeCreateMode === "external_webhook" && !createdInstanceName && externalConnectionType === "webhook";
  const isGupshupConnectionForm =
    activeCreateMode === "external_webhook" && !createdInstanceName && externalConnectionType === "gupshup";
  const isInstagramConnectionForm =
    activeCreateMode === "external_webhook" && !createdInstanceName && externalConnectionType === "instagram";
  const isRbConnectionForm =
    activeCreateMode === "external_webhook" && !createdInstanceName && externalConnectionType === "rb";

  if (loading) {
    return (
      <div className="connections-manager space-y-8">
        <Skeleton className="h-10 w-48" />
        <div className="connections-summary-grid">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-[var(--radius-2xl)]" />
          ))}
        </div>
        {Array.from({ length: 3 }).map((_, sectionIndex) => (
          <section key={sectionIndex} className="space-y-4">
            <Skeleton className="h-4 w-40" />
            <div className="connections-card-grid">
              {Array.from({ length: sectionIndex === 0 ? 3 : 2 }).map((__, cardIndex) => (
                <Skeleton key={cardIndex} className="h-60 w-full rounded-[var(--radius-2xl)]" />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  const getProviderForInstance = (instance: AdminInstance): ConnectionProvider => {
    if (instance.connectionMode === "instagram" || instagramChannels[instance.instanceName]) return "instagram";
    if (gupshupChannels[instance.instanceName]?.provider === "gupshup") return "gupshup";
    if (metaChannels[instance.instanceName]?.provider === "meta") return "whatsapp-official";
    return "whatsapp-free";
  };
  const activeInstanceCount = instances.filter((instance) =>
    getProviderForInstance(instance) === "whatsapp-free" && instance.status === "connected"
  ).length;
  const pendingInstanceCount = instances.filter((instance) =>
    getProviderForInstance(instance) === "whatsapp-free" && (instance.status === "connecting" || instance.setupStatus === "pending_qr")
  ).length;
  const errorInstanceCount = instances.filter((instance) =>
    getProviderForInstance(instance) === "whatsapp-free" && instance.status === "error"
  ).length;
  const whatsappFreeInstances = instances.filter((instance) => getProviderForInstance(instance) === "whatsapp-free");
  const officialInstances = instances.filter((instance) => getProviderForInstance(instance) === "whatsapp-official");
  const gupshupInstances = instances.filter((instance) => getProviderForInstance(instance) === "gupshup");
  const instagramInstances = instances.filter((instance) => getProviderForInstance(instance) === "instagram");
  const hasEvolutionConnection = whatsappFreeInstances.length > 0;
  const firstInstanceName = officialInstances[0]?.instanceName ?? instances[0]?.instanceName ?? "";
  const metaConnectionCount = officialInstances.filter((instance) =>
    metaChannels[instance.instanceName]?.channel?.status === "active"
  ).length;
  const metaHasError = officialInstances.some((instance) =>
    metaChannels[instance.instanceName]?.channel?.status === "error"
  );
  const gupshupConnectionCount = gupshupInstances.filter((instance) =>
    gupshupChannels[instance.instanceName]?.gupshupChannel?.status === "active"
  ).length;
  const instagramConnectionCount = instagramInstances.filter((instance) => {
    const channel = instagramChannels[instance.instanceName];
    return channel && channel.status !== "disabled" && channel.healthStatus !== "disabled";
  }).length;
  const rbConnectionCount = rbConnections.length;
  const selectedPanelInstances = connectionPanel
    ? instances.filter((instance) => getProviderForInstance(instance) === connectionPanel)
    : [];
  const panelTitle = connectionPanel === "whatsapp-free"
    ? "WhatsApp Free"
    : connectionPanel === "whatsapp-official"
      ? "WhatsApp Oficial"
      : connectionPanel === "gupshup"
        ? "Gupshup"
        : connectionPanel === "instagram"
          ? "Instagram"
          : "Registro Base";
  const panelDescription = connectionPanel === "whatsapp-free"
    ? "Instâncias Evolution conectadas à operação."
    : connectionPanel === "whatsapp-official"
      ? "Canais oficiais e templates da Meta."
      : connectionPanel === "gupshup"
        ? "Canais WhatsApp administrados pela Gupshup."
        : connectionPanel === "instagram"
          ? "Contas profissionais e saúde dos tokens."
          : "Conexões e empresas vinculadas ao Registro Base.";
  const openProviderPanel = (provider: ConnectionProvider) => setConnectionPanel(provider);
  const closeProviderPanel = () => setConnectionPanel(null);
  const getCatalogStatus = (configured: boolean, pending = false, error = false): ConnectionStatus => {
    if (error) return "attention";
    if (pending) return "pending";
    return configured ? "connected" : "not_configured";
  };
  const catalogActionLabel = (configured: boolean) => configured ? "Gerenciar" : "Criar conexão";

  return (
    <>
      <Card className="p-6 connections-manager__panel">
        <div className="mb-4 flex flex-col items-start justify-between gap-4 border-b border-border pb-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <Webhook className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-xl font-semibold">Conexões</h2>
            </div>
          </div>

        </div>

        <div className="connections-summary-grid" aria-label="Resumo das conexões">
          <div className="connections-summary-card">
            <span className="connections-summary-card__label">Ativas</span>
            <strong>{activeInstanceCount + metaConnectionCount + gupshupConnectionCount + instagramConnectionCount + rbConnectionCount}</strong>
            <span className="connections-summary-card__dot connections-summary-card__dot--success" aria-hidden="true" />
          </div>
          <div className="connections-summary-card">
            <span className="connections-summary-card__label">Pendentes</span>
            <strong>{pendingInstanceCount}</strong>
            <span className="connections-summary-card__dot connections-summary-card__dot--warning" aria-hidden="true" />
          </div>
          <div className="connections-summary-card">
            <span className="connections-summary-card__label">Com erro</span>
            <strong>{errorInstanceCount}</strong>
            <span className="connections-summary-card__dot connections-summary-card__dot--error" aria-hidden="true" />
          </div>
        </div>

        <div className="connections-catalog" aria-label="Catálogo de conexões">
          <section className="connections-section">
            <div className="section-label"><span className="section-label__text">WhatsApp e Gupshup</span></div>
            <div className="connections-card-grid">
              <ConnectionCard
                title="WhatsApp Free"
                description="Conexão interna (nativo) ou webhook"
                icon={MessageCircle}
                iconSrc="/connection-icons/whatsapp.png"
                status={getCatalogStatus(hasEvolutionConnection, pendingInstanceCount > 0, errorInstanceCount > 0)}
                statusLabel={hasEvolutionConnection ? `${whatsappFreeInstances.length} configurada${whatsappFreeInstances.length === 1 ? "" : "s"}` : "Não configurada"}
                actionLabel={catalogActionLabel(hasEvolutionConnection)}
                onAction={hasEvolutionConnection ? () => openProviderPanel("whatsapp-free") : () => openCreateDialog("local")}
              />
              <ConnectionCard
                title="WhatsApp Oficial"
                description="Canal oficial da Meta"
                icon={MessageCircle}
                iconSrc="/connection-icons/whatsapp.png"
                status={getCatalogStatus(metaConnectionCount > 0, false, metaHasError)}
                statusLabel={metaConnectionCount > 0 ? `${metaConnectionCount} ativa${metaConnectionCount === 1 ? "" : "s"}` : "Não configurada"}
                actionLabel={catalogActionLabel(metaConnectionCount > 0)}
                onAction={metaConnectionCount > 0 ? () => openProviderPanel("whatsapp-official") : () => {
                  if (firstInstanceName) {
                    void openMetaDialog(firstInstanceName);
                  } else {
                    openProviderPanel("whatsapp-official");
                  }
                }}
              />
              <ConnectionCard
                title="Gupshup"
                description="WhatsApp via provedor externo"
                icon={MessageCircle}
                iconSrc="/connection-icons/gupshup.png"
                status={getCatalogStatus(gupshupConnectionCount > 0)}
                statusLabel={gupshupConnectionCount > 0 ? `${gupshupConnectionCount} ativa${gupshupConnectionCount === 1 ? "" : "s"}` : "Não configurada"}
                actionLabel={catalogActionLabel(gupshupConnectionCount > 0)}
                onAction={gupshupConnectionCount > 0 ? () => openProviderPanel("gupshup") : () => openCreateDialog("external_webhook", "gupshup")}
              />
            </div>
          </section>

          <section className="connections-section">
            <div className="section-label"><span className="section-label__text">Mídias sociais</span></div>
            <div className="connections-card-grid">
              <ConnectionCard
                title="Instagram"
                description="Mensagens e contas profissionais"
                icon={Instagram}
                iconSrc="/connection-icons/instagram.svg"
                status={getCatalogStatus(instagramConnectionCount > 0, false, Object.values(instagramChannels).some((channel) => channel.healthStatus === "reconnect_required"))}
                statusLabel={instagramConnectionCount > 0 ? `${instagramConnectionCount} ativa${instagramConnectionCount === 1 ? "" : "s"}` : "Não configurada"}
                actionLabel={catalogActionLabel(instagramConnectionCount > 0)}
                onAction={instagramConnectionCount > 0 ? () => openProviderPanel("instagram") : () => openCreateDialog("external_webhook", "instagram")}
              />
              <ConnectionCard
                title="Messenger"
                description="Canal de mensagens da Meta"
                icon={MessageCircle}
                iconSrc="/connection-icons/messenger.png"
                status="coming_soon"
                statusLabel="Em breve"
              />
            </div>
          </section>

          <section className="connections-section">
            <div className="section-label"><span className="section-label__text">Integrações</span></div>
            <div className="connections-card-grid">
              <ConnectionCard
                title="Registro Base"
                description={rbConnectionCount > 0 ? `${rbConnectionCount} conexão${rbConnectionCount === 1 ? "" : "ões"} configurada${rbConnectionCount === 1 ? "" : "s"}` : "Base de dados operacional"}
                icon={Database}
                iconSrc="/connection-icons/registro-base.png"
                status={getCatalogStatus(rbConnectionCount > 0)}
                statusLabel={rbConnectionCount > 0 ? "Conectado" : "Não configurado"}
                actionLabel={rbConnectionCount > 0 ? "Gerenciar conexões" : "Conectar Registro Base"}
                onAction={() => openProviderPanel("registro-base")}
                footer={(
                  <div className="connection-card__custom-footer">
                    <Switch
                      checked={rbConnections.length === 1 ? rbConnections[0].billingEnabled : false}
                      onCheckedChange={(checked) => {
                        const target = rbConnections.length === 1 ? rbConnections[0] : null;
                        if (!target) {
                          toast.error("Configure o Registro Base antes de ativar a Cobrança RB");
                          return;
                        }
                        void handleToggleRbBilling(target, checked);
                      }}
                      disabled={Boolean(busyAction)}
                      aria-label="Ativar ou desativar Cobrança RB"
                      className="sr-only"
                    />
                    <Button type="button" variant="ghost" size="sm" onClick={() => openProviderPanel("registro-base")}>
                      Ver lista
                    </Button>
                  </div>
                )}
              />
              <ConnectionCard
                title="Cobrança"
                description="Fontes financeiras, ingestões e regras"
                icon={Webhook}
                iconSrc="/connection-icons/cobranca.svg"
                status={billingStatus}
                statusLabel={billingStatusLabel}
                actionLabel={billingStatus === "not_configured" ? "Configurar" : "Gerenciar"}
                onAction={onOpenBilling ?? (() => { window.location.href = "/cobranca"; })}
              />
            </div>
          </section>
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

      </Card>

      <Sheet open={connectionPanel !== null} onOpenChange={(open) => !open && closeProviderPanel()}>
        <SheetContent side="right" className="connection-accounts-sheet sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{panelTitle}</SheetTitle>
            <SheetDescription>{panelDescription}</SheetDescription>
          </SheetHeader>

          <div className="mt-6 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
            {connectionPanel === "registro-base" ? (
              <div className="space-y-3">
                {rbConnections.length === 0 ? (
                  <div className="connection-panel-empty">
                    <Database className="h-8 w-8 text-[var(--color-primary-500)]" />
                    <p>Nenhuma conexão com o Registro Base.</p>
                    <Button onClick={() => openCreateDialog("external_webhook", "rb")}>Conectar Registro Base</Button>
                  </div>
                ) : (
                  <>
                    {rbConnections.map((connection) => (
                      <div key={connection.id} className="connection-account-card">
                        <div className="connection-account-card__main">
                          <div className="connection-account-card__avatar"><Database className="h-5 w-5" /></div>
                          <div className="min-w-0">
                            <p className="font-semibold text-[var(--color-gray-900)]">Registro Base</p>
                            <p className="text-xs text-[var(--color-gray-500)]">ID {connection.rbAcesId ?? "não informado"}</p>
                            <p className="mt-1 text-xs text-[var(--color-gray-600)]">
                              {connection.rbEmpresaIds.length} {connection.rbEmpresaIds.length === 1 ? "empresa configurada" : "empresas configuradas"}
                            </p>
                          </div>
                        </div>
                        <div className="connection-account-card__actions">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <span className={cn("connection-account-card__status", connection.hasTokenApi && "connection-account-card__status--success")}>
                              {connection.hasTokenApi ? "Conectado" : "Credencial pendente"}
                            </span>
                            <span className={cn("connection-account-card__status", billingStatus === "connected" && "connection-account-card__status--success")}>
                              {billingStatusLabel}
                            </span>
                            <Switch
                              checked={connection.billingEnabled}
                              onCheckedChange={(checked) => void handleToggleRbBilling(connection, checked)}
                              disabled={busyAction === `toggle-rb-billing:${connection.id}`}
                              aria-label={`Ativar ou desativar Cobrança RB do Registro Base ${connection.rbAcesId ?? connection.id}`}
                              className="sr-only"
                            />
                          </div>
                          <Button variant="outline" size="sm" onClick={() => openRbConnection(connection)}><Pencil className="h-4 w-4" />Editar</Button>
                          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" disabled={Boolean(busyAction)} onClick={() => handleDeleteRbConnection(connection)} aria-label="Excluir conexão Registro Base">
                            {busyAction === `delete-rb:${connection.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                    ))}
                    <Button className="w-full" onClick={() => openCreateDialog("external_webhook", "rb")}><Plus className="h-4 w-4" />Adicionar conexão</Button>
                  </>
                )}
              </div>
            ) : (
              <>
                {selectedPanelInstances.length === 0 ? (
                  <div className="connection-panel-empty">
                    <MessageCircle className="h-8 w-8 text-[var(--color-primary-500)]" />
                    <p>Nenhuma conexão configurada para este provedor.</p>
                    <Button
                      disabled={connectionPanel === "whatsapp-official" && instances.length === 0}
                      onClick={() => {
                        if (connectionPanel === "whatsapp-official") {
                          const candidate = instances[0];
                          if (candidate) {
                            closeProviderPanel();
                            void openMetaDialog(candidate.instanceName);
                          }
                          return;
                        }
                        openCreateDialog(
                          connectionPanel === "whatsapp-free" ? "local" : "external_webhook",
                          connectionPanel === "gupshup" ? "gupshup" : connectionPanel === "instagram" ? "instagram" : undefined,
                        );
                      }}
                    >
                      {connectionPanel === "whatsapp-official" ? "Configurar canal Meta" : "Adicionar conexão"}
                    </Button>
                  </div>
                ) : (
                  <>
                    {selectedPanelInstances.map((instance) => {
                      const channel = gupshupChannels[instance.instanceName]?.gupshupChannel;
                      const instagramChannel = instagramChannels[instance.instanceName];
                      return (
                        <div key={instance.instanceName} className="connection-account-card">
                          <div className="connection-account-card__main">
                            <Avatar className="connection-account-card__avatar">
                              <AvatarImage src={instance.profilePictureUrl ?? undefined} alt="" />
                              <AvatarFallback>{(instance.displayName ?? instance.instanceName).slice(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-[var(--color-gray-900)]">{instance.instanceName}</p>
                              <p className="text-xs text-[var(--color-gray-500)]">
                                {instance.phoneNumber ?? channel?.phoneNumber ?? instagramChannel?.igUsername ?? (getProviderForInstance(instance) === "whatsapp-official" ? metaChannels[instance.instanceName]?.channel?.displayPhoneNumber : null) ?? "Sem telefone informado"}
                              </p>
                              <div className="mt-2 flex flex-wrap items-center gap-2">{statusBadge(instance.status)}<span className="text-xs text-[var(--color-gray-500)]">{instance.leadCount} leads</span></div>
                            </div>
                          </div>
                          <div className="connection-account-card__actions">
                            {getProviderForInstance(instance) === "gupshup" ? <Button variant="outline" size="sm" onClick={() => openGupshupDialog(instance.instanceName)}>Editar Gupshup</Button> : null}
                            {getProviderForInstance(instance) === "whatsapp-official" ? <Button variant="outline" size="sm" onClick={() => openMetaDialog(instance.instanceName)}>Editar Meta</Button> : null}
                            {getProviderForInstance(instance) === "instagram" ? <Button variant="outline" size="sm" onClick={() => void handleConnectInstagram(instance.instanceName)}>Reconectar</Button> : null}
                            {getProviderForInstance(instance) === "whatsapp-free" && instance.actions.includes("reconnect") ? <Button variant="outline" size="sm" onClick={() => void handleStartReconnect(instance.instanceName)}>Reconectar</Button> : null}
                            {instance.actions.includes("sync_status") ? <Button variant="ghost" size="icon" onClick={() => void handleSyncStatus(instance.instanceName)} aria-label={`Atualizar status de ${instance.instanceName}`}><RefreshCw className="h-4 w-4" /></Button> : null}
                            {instance.actions.includes("delete") ? <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => openDeleteDialog(instance)} aria-label={`Excluir ${instance.instanceName}`}><Trash2 className="h-4 w-4" /></Button> : null}
                          </div>
                        </div>
                      );
                    })}
                    <Button className="w-full" onClick={() => {
                      if (connectionPanel === "whatsapp-official") {
                        const candidate = instances[0];
                        if (candidate) {
                          closeProviderPanel();
                          void openMetaDialog(candidate.instanceName);
                        }
                        return;
                      }
                      openCreateDialog(
                        connectionPanel === "whatsapp-free" ? "local" : "external_webhook",
                        connectionPanel === "gupshup" ? "gupshup" : connectionPanel === "instagram" ? "instagram" : undefined,
                      );
                    }}>
                      <Plus className="h-4 w-4" />
                      {connectionPanel === "whatsapp-official" ? "Configurar canal Meta" : "Adicionar conexão"}
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

        {loading && (instances.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground bg-muted/30 rounded-lg border border-dashed flex flex-col items-center gap-2">
            <span>Nenhuma instancia ativa encontrada para sua conta.</span>
            {!error && (
              <span className="text-xs opacity-70">
                Vincule uma Evolution externa existente ou crie uma instancia local com QR code.
              </span>
            )}
          </div>
        ) : (
          <div id="configured-connections" className="space-y-3">
            {instances.map((instance) => {
              const actions = new Set(instance.actions);
              const isBusy = Boolean(busyAction);
              const metaSummary = metaChannels[instance.instanceName];
              const gupshupSummary = gupshupChannels[instance.instanceName];
              const instagramChannel = instagramChannels[instance.instanceName] ?? null;
              const isInstagram = instance.connectionMode === "instagram";
              const metaChannel = metaSummary?.channel ?? null;
              const gupshupChannel = gupshupSummary?.gupshupChannel ?? null;
              const providerName =
                isInstagram ? "instagram" : gupshupSummary?.provider ?? metaSummary?.provider ?? "evolution";
              const instagramStatus = instagramChannel?.status ?? "disconnected";
              const instagramHealth = instagramChannel?.healthStatus ?? "pending";
              const instagramNeedsReconnect = instagramStatus === "reconnect_required" || instagramHealth === "reconnect_required";
              const instagramDisabled = instagramStatus === "disabled" || instagramHealth === "disabled";
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
                        {providerName === "instagram" ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-gray-600)]">
                            <Instagram className="h-3.5 w-3.5" aria-hidden="true" />
                            Instagram{instagramChannel?.igUsername ? ` @${instagramChannel.igUsername}` : ""}
                          </span>
                        ) : providerName === "gupshup" ? (
                          <>
                            <Badge variant={gupshupChannel?.status === "active" ? "secondary" : "outline"}>
                              Gupshup {gupshupChannel?.status ?? "nao configurada"}
                            </Badge>
                            {gupshupChannel && !gupshupChannel.appId ? (
                              <Badge variant="destructive">Sem appId</Badge>
                            ) : null}
                          </>
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
                      {providerName === "instagram" && instagramChannel && (
                        <div className="space-y-1 text-xs text-muted-foreground">
                          <div>Saude: <span className="font-medium">{instagramHealth === "healthy" ? "Ativa" : instagramHealth === "warning" ? "Atencao" : instagramHealth === "reconnect_required" ? "Reconexao necessaria" : instagramHealth === "disabled" ? "Desativada" : "Aguardando"}</span></div>
                          {instagramChannel.tokenExpiresAt && <div>Token expira em {new Date(instagramChannel.tokenExpiresAt).toLocaleString("pt-BR")}</div>}
                          {instagramChannel.lastRefreshedAt && <div>Ultima renovacao em {new Date(instagramChannel.lastRefreshedAt).toLocaleString("pt-BR")}</div>}
                          {instagramChannel.lastErrorCode && <div className="text-destructive">A conexao precisa de atencao.</div>}
                        </div>
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
                        {providerName === "gupshup" && gupshupChannel?.appId ? (
                          <span className="text-[10px] text-muted-foreground">appId: {gupshupChannel.appId}</span>
                        ) : null}
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

                    {providerName === "instagram" ? (
                      <>
                        <Button size="sm" variant={instagramNeedsReconnect || instagramDisabled ? "default" : "outline"} disabled={isBusy} onClick={() => void handleConnectInstagram(instance.instanceName)}>
                          {busyAction === `instagram:${instance.instanceName}` ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Instagram className="h-3.5 w-3.5 mr-1.5" />}
                          {instagramNeedsReconnect || instagramDisabled ? "Reconectar Instagram" : "Atualizar conexao"}
                        </Button>
                        {instagramChannel && !instagramDisabled && <Button size="sm" variant="outline" disabled={isBusy} onClick={() => void handleRefreshInstagram(instagramChannel)}>
                          {busyAction === `instagram-refresh:${instagramChannel.channelId}` ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                          Renovar
                        </Button>}
                        {instagramChannel && !instagramDisabled && <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={isBusy} onClick={() => setInstagramPendingDisable(instagramChannel)}>
                          <Unplug className="h-3.5 w-3.5 mr-1.5" />
                          Desativar
                        </Button>}
                      </>
                    ) : providerName !== "gupshup" ? (
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
        ))}

        {loading && (rbConnections.length > 0 ? (
          <div className="mt-6 border-t border-[var(--border-default)] pt-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="h-0.5 w-5 bg-[var(--color-primary-500)]" />
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[var(--color-gray-600)]">
                Via RB
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {rbConnections.map((connection) => (
                <div
                  key={connection.id}
                  className="rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--color-gray-900)]">Via RB</p>
                      <p className="mt-1 text-xs text-[var(--color-gray-500)]">
                        {connection.rbEmpresaIds.length} {connection.rbEmpresaIds.length === 1 ? "empresa configurada" : "empresas configuradas"}
                      </p>
                      <div className="mt-3 flex items-center gap-2 text-xs text-[var(--color-gray-600)]">
                        <span
                          className={cn(
                            "h-2 w-2 rounded-full",
                            billingStatus === "connected"
                              ? "bg-[var(--color-success-500)]"
                              : "bg-[var(--color-gray-300)]",
                          )}
                        />
                        {billingStatusLabel}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openRbConnection(connection)} aria-label="Editar conexão Via RB">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        disabled={Boolean(busyAction)}
                        onClick={() => handleDeleteRbConnection(connection)}
                        aria-label="Excluir conexão Via RB"
                      >
                        {busyAction === `delete-rb:${connection.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null)}

        <AlertDialog open={Boolean(instagramPendingDisable)} onOpenChange={(open) => !open && setInstagramPendingDisable(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Desativar canal Instagram?</AlertDialogTitle>
              <AlertDialogDescription>
                A desativacao afeta somente a conexao Instagram selecionada. Historico, leads e canais WhatsApp serao preservados.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={Boolean(busyAction)}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void handleDisableInstagram();
                }}
                disabled={Boolean(busyAction)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {busyAction?.startsWith("instagram-disable:") ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Desativar canal
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

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
        <DialogContent className={cn("max-w-lg", activeCreateMode === "external_webhook" && !createdInstanceName && "max-w-md")}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {activeCreateMode === "external_webhook" ? (
                isGupshupConnectionForm ? (
                  <MessageCircle className="h-5 w-5" />
                ) : isInstagramConnectionForm ? (
                  <Instagram className="h-5 w-5" />
                ) : isRbConnectionForm ? (
                  <Cable className="h-5 w-5" />
                ) : (
                  <Webhook className="h-5 w-5" />
                )
              ) : (
                <QrCode className="h-5 w-5" />
              )}
              {activeCreateMode === "external_webhook"
                ? isExternalConnectionPicker
                  ? "Conexões externas"
                  : isGupshupConnectionForm
                    ? "Via Gupshup"
                    : isInstagramConnectionForm
                      ? "Instagram"
                    : isRbConnectionForm
                      ? "Via RB"
                      : "Via webhook"
                : "Integrações"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {isExternalConnectionPicker ? (
              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={() => setExternalConnectionType("gupshup")}
                  className="group flex items-center justify-between rounded-2xl border border-[var(--border-default)] bg-[var(--color-surface-2)] px-4 py-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-primary-200)] hover:bg-[var(--color-surface-1)] hover:shadow-md"
                >
                  <span className="text-sm font-semibold text-[var(--color-gray-900)]">Via Gupshup</span>
                  <MessageCircle className="h-4 w-4 text-[var(--color-primary-500)] transition-transform duration-200 group-hover:translate-x-0.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setExternalConnectionType("instagram")}
                  className="group flex items-center justify-between rounded-2xl border border-[var(--border-default)] bg-[var(--color-surface-2)] px-4 py-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-primary-200)] hover:bg-[var(--color-surface-1)] hover:shadow-md"
                >
                  <span className="text-sm font-semibold text-[var(--color-gray-900)]">Instagram</span>
                  <Instagram className="h-4 w-4 text-[var(--color-primary-500)] transition-transform duration-200 group-hover:translate-x-0.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setExternalConnectionType("webhook")}
                  className="group flex items-center justify-between rounded-2xl border border-[var(--border-default)] bg-[var(--color-surface-2)] px-4 py-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-primary-200)] hover:bg-[var(--color-surface-1)] hover:shadow-md"
                >
                  <span className="text-sm font-semibold text-[var(--color-gray-900)]">Via webhook</span>
                  <Webhook className="h-4 w-4 text-[var(--color-primary-500)] transition-transform duration-200 group-hover:translate-x-0.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setExternalConnectionType("rb")}
                  className="group flex items-center justify-between rounded-2xl border border-[var(--border-default)] bg-[var(--color-surface-2)] px-4 py-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-primary-200)] hover:bg-[var(--color-surface-1)] hover:shadow-md"
                >
                  <span className="text-sm font-semibold text-[var(--color-gray-900)]">Via RB</span>
                  <Cable className="h-4 w-4 text-[var(--color-primary-500)] transition-transform duration-200 group-hover:translate-x-0.5" />
                </button>
              </div>
            ) : (
              <>
                {!isRbConnectionForm ? <div className="space-y-2">
                  <Label htmlFor="instance-name">
                    {activeCreateMode === "external_webhook" ? "Nome da instancia" : "Nome da instancia"}
                  </Label>
                  <Input
                    id="instance-name"
                    placeholder="Ex: EquipeComercial01"
                    value={instanceNameInput}
                    onChange={(event) => setInstanceNameInput(event.target.value)}
                    disabled={creatingInstance || gupshupSaving || Boolean(createdInstanceName)}
                  />
                </div> : null}

                {isWebhookConnectionForm ? (
                  <div className="grid gap-4 rounded-2xl border border-[var(--border-default)] bg-[var(--color-surface-2)] p-4 shadow-sm">
                    <div className="space-y-2">
                      <Label htmlFor="external-webhook-endpoint">Webhook</Label>
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
                          aria-label="Copiar webhook"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="remote-evolution-url">URL</Label>
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
                      <Label htmlFor="remote-api-key">API key</Label>
                      <Input
                        id="remote-api-key"
                        type="password"
                        placeholder="Informe a API key"
                        value={remoteApiKeyInput}
                        onChange={(event) => setRemoteApiKeyInput(event.target.value)}
                        disabled={creatingInstance}
                        autoComplete="new-password"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="remote-instance-name">Nome externo</Label>
                      <Input
                        id="remote-instance-name"
                        placeholder={instanceNameInput.trim() || "Ex: Cliente01"}
                        value={remoteInstanceNameInput}
                        onChange={(event) => setRemoteInstanceNameInput(event.target.value)}
                        disabled={creatingInstance}
                      />
                    </div>
                  </div>
                ) : null}

                {isGupshupConnectionForm ? (
                  <div className="grid gap-4 rounded-2xl border border-[var(--border-default)] bg-[var(--color-surface-2)] p-4 shadow-sm">
                    <div className="space-y-2">
                      <Label htmlFor="gupshup-webhook-endpoint">Webhook</Label>
                      <div className="flex gap-2">
                        <Input
                          id="gupshup-webhook-endpoint"
                          value={`${(import.meta.env.VITE_WEBHOOK_PUBLIC_BASE_URL as string | undefined || import.meta.env.VITE_CRM_BACKEND_URL as string | undefined || window.location.origin).replace(/\/$/, "")}/api/webhook/gupshup`}
                          readOnly
                          className="min-w-0 font-mono text-xs"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={async () => {
                            try {
                              const base =
                                (import.meta.env.VITE_WEBHOOK_PUBLIC_BASE_URL as string | undefined) ||
                                (import.meta.env.VITE_CRM_BACKEND_URL as string | undefined) ||
                                window.location.origin;
                              await navigator.clipboard.writeText(`${base.replace(/\/$/, "")}/api/webhook/gupshup`);
                              toast.success("Webhook copiado");
                            } catch {
                              toast.error("Nao foi possivel copiar o webhook");
                            }
                          }}
                          disabled={gupshupSaving}
                          aria-label="Copiar webhook Gupshup"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="gupshup-app-name">App name</Label>
                      <Input
                        id="gupshup-app-name"
                        placeholder="Ex: droculos"
                        value={gupshupForm.appName}
                        onChange={(event) => setGupshupForm((current) => ({ ...current, appName: event.target.value }))}
                        disabled={gupshupSaving}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="gupshup-app-id">App id</Label>
                      <Input
                        id="gupshup-app-id"
                        placeholder="Ex: 147dd060-2210-4c8e-919f-592e4180d0f1"
                        value={gupshupForm.appId}
                        onChange={(event) => setGupshupForm((current) => ({ ...current, appId: event.target.value }))}
                        disabled={gupshupSaving}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="gupshup-api-key">API key</Label>
                      <Input
                        id="gupshup-api-key"
                        type="password"
                        placeholder="Informe a API key"
                        value={gupshupForm.apiKey}
                        onChange={(event) => setGupshupForm((current) => ({ ...current, apiKey: event.target.value }))}
                        disabled={gupshupSaving}
                        autoComplete="new-password"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="gupshup-phone-number">Telefone</Label>
                      <Input
                        id="gupshup-phone-number"
                        placeholder="5562999999999"
                        value={gupshupForm.phoneNumber}
                        onChange={(event) => setGupshupForm((current) => ({ ...current, phoneNumber: event.target.value }))}
                        disabled={gupshupSaving}
                        inputMode="tel"
                      />
                    </div>
                  </div>
                ) : null}

                {isRbConnectionForm ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="rb-aces-id">ID RB</Label>
                        <Input
                          id="rb-aces-id"
                          type="number"
                          min="1"
                          step="1"
                          value={rbForm.rbAcesId}
                          onChange={(event) => setRbForm((current) => ({ ...current, rbAcesId: event.target.value }))}
                          placeholder="608"
                          disabled={rbSaving}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="rb-token-api">Token API</Label>
                        <Input
                          id="rb-token-api"
                          type="password"
                          value={rbForm.rbTokenApi}
                          onChange={(event) => setRbForm((current) => ({ ...current, rbTokenApi: event.target.value }))}
                          placeholder={rbForm.id ? "Mantido se ficar em branco" : "API key fornecida pelo RB"}
                          autoComplete="new-password"
                          disabled={rbSaving}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="rb-company-ids">Empresas</Label>
                        <Input id="rb-company-ids" value={rbForm.rbEmpresaIds} onChange={(event) => setRbForm((current) => ({ ...current, rbEmpresaIds: event.target.value }))} placeholder="1, 2" disabled={rbSaving} />
                      </div>
                      <div className="flex items-center justify-between gap-4 border-t border-[var(--border-default)] pt-4">
                        <Label>Cobrança</Label>
                        <span className="text-right text-xs text-[var(--color-gray-500)]">Configure depois de salvar, em Cobrança</span>
                      </div>
                    </div>
                ) : null}
              </>
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
                <Button variant="ghost" onClick={resetCreateDialog} disabled={creatingInstance || rbSaving}>
                  Cancelar
                </Button>
                {(isWebhookConnectionForm || isGupshupConnectionForm || isInstagramConnectionForm || isRbConnectionForm) && (
                  <Button
                    variant="outline"
                    onClick={() => setExternalConnectionType("selection")}
                    disabled={creatingInstance || gupshupSaving || rbSaving}
                  >
                    Trocar
                  </Button>
                )}
                {!isExternalConnectionPicker && (
                  <Button
                    onClick={isRbConnectionForm ? handleSaveRbConnection : isGupshupConnectionForm ? handleSaveGupshupChannel : isInstagramConnectionForm ? () => void handleConnectInstagram() : handleCreateInstance}
                    disabled={creatingInstance || gupshupSaving || rbSaving}
                  >
                    {creatingInstance || gupshupSaving || rbSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    {isRbConnectionForm ? "Salvar conexão" : isGupshupConnectionForm ? "Conectar" : activeCreateMode === "external_webhook" ? "Conectar" : "Criar e gerar QR"}
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
