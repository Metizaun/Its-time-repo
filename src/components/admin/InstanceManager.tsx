import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Link2,
  Loader2,
  Pencil,
  Plus,
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
  createInstanceWithQr,
  deleteInstance,
  disconnectInstance,
  fetchInstanceStatus,
  listAdminInstances,
  reconnectInstanceWithQr,
  refreshInstanceQrCode,
  syncInstanceStatus,
  type AdminInstance,
  type AdminInstanceSetupStatus,
} from "@/services/instanceService";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

type ConnectionState = "idle" | "checking" | "disconnected" | "connected" | "error";

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

function setupStatusBadge(setupStatus: AdminInstanceSetupStatus) {
  switch (setupStatus) {
    case "connected":
      return <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">Setup concluido</Badge>;
    case "expired":
      return <Badge variant="destructive">Setup expirado</Badge>;
    case "pending_qr":
      return <Badge variant="outline">Setup pendente</Badge>;
    case "cancelled":
      return <Badge variant="secondary">Setup cancelado</Badge>;
    default:
      return <Badge variant="outline">Setup pendente</Badge>;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [instanceNameInput, setInstanceNameInput] = useState("");
  const [creatingInstance, setCreatingInstance] = useState(false);
  const [refreshingQr, setRefreshingQr] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [qrInstanceName, setQrInstanceName] = useState<string | null>(null);
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [currentSetupStatus, setCurrentSetupStatus] = useState<AdminInstanceSetupStatus | null>(null);

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
      const accessToken = await getAccessToken();
      const result = await listAdminInstances({ accessToken });
      setInstances(result.instances ?? []);
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

  const checkCurrentInstanceStatus = async (nameFromAction?: string) => {
    const instanceName = nameFromAction ?? qrInstanceName;
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

    try {
      setCreatingInstance(true);
      setConnectionMessage(null);
      const accessToken = await getAccessToken();
      const result = await createInstanceWithQr({
        accessToken,
        instanceName,
      });

      setQrInstanceName(result.instanceName);
      setQrCodeBase64(result.qrCodeBase64);
      setConnectionState(result.status === "connected" ? "connected" : "disconnected");
      setCurrentSetupStatus(result.setupStatus);
      setConnectionMessage(
        result.status === "connected"
          ? "Instancia ja estava conectada."
          : "Configuracao iniciada. Escaneie o QR code para concluir."
      );

      toast.success("Instancia registrada no backend");
      await loadInstances();
      if (result.status !== "connected") {
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
      setCreateDialogOpen(true);
      setQrInstanceName(instanceName);
      setQrCodeBase64(null);
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
    if (!qrInstanceName) return;

    try {
      setRefreshingQr(true);
      const accessToken = await getAccessToken();
      const result = await refreshInstanceQrCode({
        accessToken,
        instanceName: qrInstanceName,
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

      if (qrInstanceName === instanceName) {
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

  const handleDelete = async (instanceName: string) => {
    const confirmed = window.confirm(
      `Excluir a instancia "${instanceName}" da administracao?\n\nEssa acao cancela o setup no CRM.`
    );
    if (!confirmed) return;

    try {
      setBusyAction(`delete:${instanceName}`);
      const accessToken = await getAccessToken();
      const result = await deleteInstance({
        accessToken,
        instanceName,
        hardDelete: false,
      });
      await loadInstances();

      if (result.warning) {
        toast.warning(result.warning);
      } else {
        toast.success("Instancia removida da lista");
      }
    } catch (err: any) {
      toast.error("Falha ao excluir instancia", { description: err?.message });
    } finally {
      setBusyAction(null);
    }
  };

  const resetCreateDialog = () => {
    if (qrInstanceName && connectionState !== "connected") {
      toast.warning("Configuracao incompleta; voce pode continuar depois em Gerenciar Instancias.");
    }

    setCreateDialogOpen(false);
    setInstanceNameInput("");
    setQrInstanceName(null);
    setQrCodeBase64(null);
    setConnectionState("idle");
    setConnectionMessage(null);
    setCurrentSetupStatus(null);
    setRefreshingQr(false);
    setCheckingStatus(false);
  };

  useEffect(() => {
    if (!createDialogOpen || !qrInstanceName || connectionState === "connected") {
      return;
    }

    const timer = setInterval(() => {
      checkCurrentInstanceStatus().catch(() => {
        // erro tratado no metodo
      });
    }, 5000);

    return () => clearInterval(timer);
  }, [createDialogOpen, qrInstanceName, connectionState]);

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
        <div className="flex items-center justify-between gap-3 mb-4 border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-xl font-semibold">Gerenciar Instancias</h2>
              <p className="text-sm text-muted-foreground">
                Controle o ciclo de vida completo: criar, retomar setup, reconectar, sincronizar, desconectar e excluir.
              </p>
            </div>
          </div>

          <Button onClick={() => setCreateDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Instancia
          </Button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-destructive/10 text-destructive text-sm rounded-md flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {instances.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground bg-muted/30 rounded-lg border border-dashed flex flex-col items-center gap-2">
            <span>Nenhuma instancia ativa encontrada para sua conta.</span>
            {!error && (
              <span className="text-xs opacity-70">
                Use o botao Instancia para iniciar a configuracao de um novo numero.
              </span>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {instances.map((instance) => {
              const actions = new Set(instance.actions);
              const isBusy = Boolean(busyAction);

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
                        {setupStatusBadge(instance.setupStatus)}
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

                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={isBusy}
                      onClick={() => handleDelete(instance.instanceName)}
                    >
                      {busyAction === `delete:${instance.instanceName}` ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      Excluir
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Dialog open={createDialogOpen} onOpenChange={(open) => (open ? setCreateDialogOpen(true) : resetCreateDialog())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              Nova instancia
            </DialogTitle>
            <DialogDescription>
              Inicie ou retome a configuracao da instancia. O setup so conclui quando o status ficar conectado.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="instance-name">Nome da instancia</Label>
              <Input
                id="instance-name"
                placeholder="Ex: EquipeComercial01"
                value={instanceNameInput}
                onChange={(event) => setInstanceNameInput(event.target.value)}
                disabled={creatingInstance || Boolean(qrInstanceName)}
              />
            </div>

            {qrInstanceName && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{qrInstanceName}</span>
                  {stateBadge}
                </div>

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

                <p className="text-xs text-muted-foreground">
                  {currentSetupStatus ? setupStatusLabel(currentSetupStatus) : "Setup pendente"}
                </p>

                {connectionMessage && (
                  <p className="text-xs text-muted-foreground">{connectionMessage}</p>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            {qrInstanceName ? (
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
                <Button onClick={resetCreateDialog}>Fechar</Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={resetCreateDialog} disabled={creatingInstance}>
                  Cancelar
                </Button>
                <Button onClick={handleCreateInstance} disabled={creatingInstance}>
                  {creatingInstance ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Criar e gerar QR
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
