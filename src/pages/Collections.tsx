import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, Cable, Clipboard, Clock3, Database, Download,
  ChevronDown, KeyRound, Loader2, Pause, Play, Plus, RefreshCw, Settings2, Trash2, Upload, WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useInstances, type Instance } from "@/hooks/useInstances";
import { CollectionFileImportCard } from "@/components/collections/CollectionFileImportCard";
import { CollectionOnboardingInline as CollectionOnboardingWorkspace } from "@/components/collections/CollectionOnboardingInline";
import {
  activateCollectionSending, createCollectionSource, deleteCollectionSource,
  getCollectionConfiguration,
  listCollectionImports, listCollectionIngestions, listCollectionSources,
  createCollectionOfficialTemplate, listCollectionOfficialTemplates, type CollectionOfficialTemplate,
  pauseCollectionSending, prepareCollectionOnboarding, rotateCollectionSecret, runCollectionSource,
  updateCollectionMessage, updateCollectionSource, type CollectionOnboardingSetup, type CollectionSource,
} from "@/services/collectionsService";
import { downloadCollectionImportTemplate } from "@/lib/utils/export";

const queryKeys = ["collection-sources", "collection-config", "collection-imports", "collection-ingestions"];

function SectionLabel({ children }: { children: string }) {
  return <div className="section-label"><span className="section-label__text">{children}</span></div>;
}

function StatusBadge({ status }: { status: string }) {
  const style = status === "active" || status === "succeeded" || status === "ready"
    ? "bg-[var(--color-success-bg)] text-[var(--color-success-600)]"
    : status === "error" || status === "failed"
      ? "bg-[var(--color-error-bg)] text-[var(--color-error-600)]"
      : status === "paused" || status === "publishing" || status === "processing"
        ? "bg-[var(--color-warning-bg)] text-[var(--color-warning-600)]"
        : "bg-[var(--color-bg-muted)] text-[var(--color-gray-600)]";
  const label = status === "active" ? "Ativa" : status === "paused" ? "Pausada" : status === "disabled" ? "Desativada" : status;
  return <Badge className={`${style} border-0 font-mono uppercase`}>{label}</Badge>;
}

function sourceTypeLabel(sourceType: string) {
  if (sourceType === "webhook") return "Webhook";
  if (sourceType === "file") return "Arquivo";
  if (sourceType === "rb") return "RB";
  return sourceType;
}

function formatDate(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "Nunca";
}

function isApprovedTemplateStatus(status: string | null | undefined) {
  return ["approved", "active", "enabled"].includes((status ?? "").trim().toLowerCase());
}

async function copySecret(secret: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(secret);
    toast.success("Segredo copiado");
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = secret;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Nao foi possivel copiar o segredo");
  toast.success("Segredo copiado");
}

function templateBodyForEditor(body: string) {
  const variables = ["nome", "valor", "vencimento", "credor"];
  let index = 0;
  return body.replace(/\{\{\s*\d+\s*\}\}/g, (placeholder) => {
    const key = variables[index] ?? `variavel${index + 1}`;
    index += 1;
    return key ? `{${key}}` : placeholder;
  });
}

function templateBodyForProvider(body: string) {
  const variables = ["nome", "valor", "vencimento", "credor"];
  return body.replace(/\{\s*([a-zA-Z0-9_]+)\s*\}/g, (placeholder, key: string) => {
    const index = variables.indexOf(key.toLowerCase());
    return index >= 0 ? `{{${index + 1}}}` : placeholder;
  });
}

function whatsAppInstanceLabel(name: string, provider?: string | null, phoneNumber?: string | null) {
  const providerLabel = provider === "meta"
    ? "Meta oficial"
    : provider === "gupshup"
      ? "Gupshup"
      : "WhatsApp conectado";
  return [name, phoneNumber?.trim(), providerLabel].filter(Boolean).join(" · ");
}

type CollectionConfiguration = Awaited<ReturnType<typeof getCollectionConfiguration>>;

function sourceOperationalState(source: CollectionSource, configuration?: CollectionConfiguration) {
  const errorCode = (source.last_error_code ?? "").toLowerCase();
  if (source.status === "error" && /(credential|token|auth|signature)/.test(errorCode)) {
    return { label: "Credencial inválida", className: "text-[var(--color-error-600)]" };
  }
  if (source.status === "paused" || source.status === "disabled" || source.resolved_dispatcher === "paused") {
    return { label: "Fonte pausada", className: "text-[var(--color-warning-600)]" };
  }
  if (source.status === "error") {
    return { label: "Atenção necessária", className: "text-[var(--color-error-600)]" };
  }
  if (!configuration) {
    return { label: "Aguardando configuração do agente", className: "text-[var(--color-warning-600)]" };
  }
  const onboarding = configuration.onboarding?.find((item) => item.source.id === source.id);
  if (onboarding) {
    if (onboarding.sendingEnabled) {
      return { label: "Envios ativos", className: "text-[var(--color-success-600)]" };
    }
    if (onboarding.pending.includes("instance")) {
      return { label: "Escolha o WhatsApp de envio", className: "text-[var(--color-warning-600)]" };
    }
    if (onboarding.pending.includes("message")) {
      return { label: "Configure a primeira mensagem", className: "text-[var(--color-warning-600)]" };
    }
    if (onboarding.pending.includes("template")) {
      return { label: "Aguardando aprovação do template", className: "text-[var(--color-warning-600)]" };
    }
    return { label: "Pronta para ativar", className: "text-[var(--color-warning-600)]" };
  }
  const readyToolIds = new Set(configuration.tools
    .filter((tool) => tool.is_enabled && tool.readiness === "ready")
    .map((tool) => tool.id));
  const hasAgent = configuration.bindings.some((binding) =>
    binding.source_connection_id === source.id
    && binding.is_enabled !== false
    && readyToolIds.has(String(binding.agent_tool_id)),
  );
  if (!hasAgent) {
    return { label: "Aguardando configuração do agente", className: "text-[var(--color-warning-600)]" };
  }
  const boundRuleIds = new Set(configuration.sourceBindings
    .filter((binding) => binding.source_connection_id === source.id)
    .map((binding) => binding.journey_rule_id));
  const explicitlyBoundRuleIds = new Set(configuration.sourceBindings.map((binding) => binding.journey_rule_id));
  const hasRule = configuration.rules.some((rule) => rule.is_active !== false
    && (!explicitlyBoundRuleIds.has(String(rule.id)) || boundRuleIds.has(String(rule.id))));
  const hasFunnel = configuration.funnels.some((funnel) => funnel.is_active);
  if (!hasRule || !hasFunnel) {
    return { label: "Aguardando regra de cobrança", className: "text-[var(--color-warning-600)]" };
  }
  return { label: "Cobrança pronta", className: "text-[var(--color-success-600)]" };
}

export function Collections() {
  const { userRole } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const sources = useQuery({ queryKey: ["collection-sources"], queryFn: listCollectionSources, enabled: userRole === "ADMIN" });
  const configuration = useQuery({ queryKey: ["collection-config"], queryFn: getCollectionConfiguration, enabled: userRole === "ADMIN" });
  const imports = useQuery({ queryKey: ["collection-imports"], queryFn: listCollectionImports, enabled: userRole === "ADMIN", refetchInterval: 15_000 });
  const ingestions = useQuery({ queryKey: ["collection-ingestions"], queryFn: listCollectionIngestions, enabled: userRole === "ADMIN", refetchInterval: 15_000 });
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [onboardingSourceId, setOnboardingSourceId] = useState<string | null>(null);
  const [createSourceOpen, setCreateSourceOpen] = useState(false);
  const { instances } = useInstances();

  useEffect(() => {
    const requestedSourceId = searchParams.get("source");
    if (requestedSourceId) setOnboardingSourceId(requestedSourceId);
  }, [searchParams]);

  const refresh = async () => {
    await Promise.all(queryKeys.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  };
  const execute = async (key: string, operation: () => Promise<unknown>, success: string): Promise<boolean> => {
    setBusy(key);
    try { await operation(); toast.success(success); await refresh(); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Operacao nao concluida"); return false; }
    finally { setBusy(null); }
  };

  if (userRole !== "ADMIN") return <Navigate to="/" replace />;
  const hasError = sources.isError || configuration.isError;

  return (
    <div className="space-y-8 pb-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Button variant="ghost" className="mb-3 -ml-3" onClick={() => navigate("/conexoes")}>
            <ArrowLeft className="h-4 w-4" /> Voltar para Conexões
          </Button>
          <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight text-[var(--color-gray-900)] sm:text-4xl">
            <WalletCards className="h-8 w-8 text-[var(--color-primary-500)]" /> Cobrança
          </h1>
          <p className="mt-2 max-w-3xl text-[var(--color-gray-600)]">Fontes financeiras, ingestões e envios.</p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} disabled={busy !== null} className="shadow-sm focus-visible:shadow-focus">
          <RefreshCw className="h-4 w-4" /> Atualizar
        </Button>
      </header>

      {hasError ? (
        <Card role="alert" className="border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-5 text-[var(--color-error-600)] shadow-sm">
          <div className="flex items-center gap-3"><AlertTriangle className="h-5 w-5" /> Não foi possível carregar a operação de cobrança.</div>
        </Card>
      ) : null}

      {secret ? (
        <Card role="status" className="border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="font-semibold text-[var(--color-gray-900)]">Copie o segredo agora. Ele não será exibido novamente.</p>
              <code className="mt-2 block break-all font-mono text-sm text-[var(--color-gray-700)]">{secret}</code></div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" onClick={() => void copySecret(secret)}><Clipboard />Copiar</Button>
              <Button variant="ghost" onClick={() => setSecret(null)}>Ocultar</Button>
            </div>
          </div>
        </Card>
      ) : null}

      <Tabs defaultValue="sources" className="space-y-6">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto bg-[var(--color-bg-subtle)] p-1">
          <TabsTrigger value="sources" className="gap-2"><Database className="h-4 w-4" />Fontes</TabsTrigger>
          <TabsTrigger value="history" className="gap-2"><Clock3 className="h-4 w-4" />Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="sources" className="space-y-6"><SourcesPanel sources={sources.data ?? []} imports={imports.data ?? []} configuration={configuration.data}
          instances={instances} pipelines={configuration.data?.pipelines ?? []}
          onboardingSourceId={onboardingSourceId} setOnboardingSourceId={setOnboardingSourceId}
          createSourceOpen={createSourceOpen} setCreateSourceOpen={setCreateSourceOpen}
          secret={secret} busy={busy} setSecret={setSecret} execute={execute} /></TabsContent>
        <TabsContent value="history"><HistoryPanel sources={sources.data ?? []} imports={imports.data ?? []} ingestions={ingestions.data ?? []} /></TabsContent>
      </Tabs>
    </div>
  );
}

export default Collections;

function SourcesPanel({ sources, imports, configuration, instances, pipelines, onboardingSourceId, setOnboardingSourceId, createSourceOpen, setCreateSourceOpen, secret, busy, setSecret, execute }: {
  sources: CollectionSource[]; imports: Awaited<ReturnType<typeof listCollectionImports>>; configuration?: CollectionConfiguration;
  instances: Instance[]; pipelines: CollectionConfiguration["pipelines"];
  createSourceOpen: boolean; setCreateSourceOpen: (value: boolean) => void; secret: string | null; busy: string | null;
  onboardingSourceId: string | null; setOnboardingSourceId: (value: string | null) => void;
  setSecret: (value: string | null) => void;
  execute: (key: string, operation: () => Promise<unknown>, success: string) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"rb" | "webhook" | "file">("webhook");
  const [newSourceInstance, setNewSourceInstance] = useState("");
  const [technicalDetailsSourceId, setTechnicalDetailsSourceId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CollectionSource | null>(null);
  const [messagesSourceId, setMessagesSourceId] = useState<string | null>(null);
  const visibleSources = sources.filter((source) => source.status !== "disabled");
  return <div className="space-y-6">
    <Card className="overflow-hidden border-[var(--border-default)] bg-[var(--color-surface-1)] shadow-sm">
      <div className="flex flex-col gap-4 border-b border-[var(--border-default)] p-6 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-xl font-semibold text-[var(--color-gray-900)]">Fontes conectadas</h2><Button type="button" className="mt-3 sm:hidden" onClick={() => setCreateSourceOpen(true)}><Plus />Adicionar fonte</Button>
        <p className="mt-1 text-sm text-[var(--color-gray-500)]">Conexões usadas para receber os dados da cobrança.</p></div>
        <Button type="button" className="hidden sm:inline-flex" onClick={() => setCreateSourceOpen(true)}><Plus />Adicionar fonte</Button></div>
      <div className="divide-y divide-[var(--border-default)]">
        {visibleSources.length === 0 ? <div className="p-10 text-center text-sm text-[var(--color-gray-500)]">Nenhuma fonte configurada.</div>
          : visibleSources.map((source) => {
            const isFileSource = source.delivery_mode === "file";
            const isTechnicalDetailsOpen = technicalDetailsSourceId === source.id;
            const operationalState = sourceOperationalState(source, configuration);
            const onboarding = configuration?.onboarding?.find((item) => item.source.id === source.id);
            const isOnboardingOpen = onboardingSourceId === source.id;
            const isMessagesOpen = messagesSourceId === source.id;
            return <article key={source.id}>
            <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-[var(--color-gray-900)]">{source.name}</h3><StatusBadge status={source.status} />
                <span className="text-xs font-medium text-[var(--color-gray-500)]">{sourceTypeLabel(source.source_type)}</span></div>
              <p className={`mt-3 text-sm font-medium ${operationalState.className}`}>{operationalState.label}</p>
              <div className="hidden">
                <span>Último sucesso: <span className="text-[var(--color-gray-600)]">{formatDate(source.last_success_at)}</span></span>
                <button type="button" className="inline-flex items-center gap-1 font-medium text-[var(--color-gray-600)] transition-colors hover:text-[var(--color-gray-900)] focus-visible:outline-none focus-visible:shadow-focus" aria-expanded={isTechnicalDetailsOpen} aria-controls={`source-details-${source.id}`} onClick={() => setTechnicalDetailsSourceId(isTechnicalDetailsOpen ? null : source.id)}>
                  Detalhes técnicos <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isTechnicalDetailsOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
              </div>
            </div><div className="flex shrink-0 flex-wrap gap-2 sm:max-w-[48%] sm:justify-end">
              <Button size="icon" variant={isOnboardingOpen ? "ghost" : "outline"} className={`h-9 w-9 ${!isOnboardingOpen ? "shadow-sm" : ""}`} aria-label={isOnboardingOpen ? "Fechar configuração" : "Configurar cobrança"} title={isOnboardingOpen ? "Fechar configuração" : "Configurar cobrança"}
                disabled={busy !== null} onClick={() => setOnboardingSourceId(isOnboardingOpen ? null : source.id)}><Settings2 className="h-4 w-4" />
              </Button>
              {source.source_type === "rb" ? <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void execute(`run-${source.id}`, () => runCollectionSource(source.id), "Sincronização RB concluída")}>
                {busy === `run-${source.id}` ? <Loader2 className="animate-spin" /> : <Play />}Executar</Button> : null}
              {source.source_type === "webhook" ? <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void execute(`secret-${source.id}`, async () => {
                const result = await rotateCollectionSecret(source.id); setSecret(result.secret); setOnboardingSourceId(source.id);
              }, "Segredo rotacionado")}><RefreshCw />Rotacionar</Button> : null}
              <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={source.status === "paused" ? "Retomar fonte" : "Pausar fonte"} title={source.status === "paused" ? "Retomar fonte" : "Pausar fonte"} disabled={busy !== null} onClick={() => void execute(`pause-${source.id}`, () => updateCollectionSource(source.id, { status: source.status === "paused" ? "active" : "paused" }), source.status === "paused" ? "Fonte retomada" : "Fonte pausada")}>
                {source.status === "paused" ? <Play /> : <Pause />}</Button>
              <Button size="icon" variant="ghost" className="h-9 w-9 text-[var(--color-error-600)] hover:bg-[var(--color-error-50)] hover:text-[var(--color-error-700)] focus-visible:shadow-focus" aria-label="Excluir fonte" title="Excluir fonte" disabled={busy !== null} onClick={() => setPendingDelete(source)}>
                <Trash2 />
              </Button>
            </div></div>
            {isTechnicalDetailsOpen ? <div id={`source-details-${source.id}`} className="border-t border-[var(--border-subtle)] bg-[var(--color-surface-2)] px-6 py-4">
              <dl className="grid gap-3 text-xs sm:grid-cols-2">
                <div><dt className="font-mono uppercase tracking-wide text-[var(--color-gray-500)]">Identificador</dt><dd className="mt-1 break-all font-mono text-[var(--color-gray-600)]">{source.public_id}</dd></div>
                {source.source_type === "webhook" ? <div><dt className="font-mono uppercase tracking-wide text-[var(--color-gray-500)]">Endereço de recebimento</dt><dd className="mt-1 break-all font-mono text-[var(--color-gray-600)]">/api/integrations/collections/v1/sources/{source.public_id}/events</dd></div> : null}
              </dl>
            </div> : null}
            {isOnboardingOpen ? <Dialog open={isOnboardingOpen} onOpenChange={(open) => { if (!open) setOnboardingSourceId(null); }}>
              <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto p-0">
                <DialogHeader className="border-b border-[var(--border-default)] px-6 pb-5 pt-6 pr-12 text-left">
                  <div className="flex items-start justify-between gap-4">
                    <div><p className="font-mono text-xs font-semibold uppercase tracking-wider text-[var(--color-gray-500)]">Fonte</p><DialogTitle className="mt-2 text-xl font-semibold">{source.name}</DialogTitle><DialogDescription className="mt-1">{sourceTypeLabel(source.source_type)} · {operationalState.label}</DialogDescription></div>
                    <StatusBadge status={source.status} />
                  </div>
                </DialogHeader>
                <div className="space-y-6 pb-6">
                  {secret ? <div role="status" className="mx-6 mt-6 rounded-[var(--radius-lg)] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium text-[var(--color-gray-900)]">Copie o segredo agora. Ele não será exibido novamente.</p><code className="mt-2 block break-all font-mono text-sm text-[var(--color-gray-700)]">{secret}</code></div><div className="flex shrink-0 gap-2"><Button variant="outline" onClick={() => void copySecret(secret)}><Clipboard />Copiar</Button><Button variant="ghost" onClick={() => setSecret(null)}>Ocultar</Button></div></div></div> : null}
                  {isFileSource ? <div className="border-b border-[var(--border-default)] pb-1"><div className="flex items-center justify-between gap-3 px-6 pt-5"><div><h3 className="font-semibold text-[var(--color-gray-900)]">Importar arquivo</h3><p className="mt-0.5 text-xs text-[var(--color-gray-500)]">CSV ou XLSX · limite de 20 MiB</p></div><Button type="button" size="icon" variant="ghost" className="h-9 w-9" aria-label="Baixar modelo CSV/XLSX" title="Baixar modelo CSV/XLSX" disabled={busy !== null} onClick={() => downloadCollectionImportTemplate()}><Download /></Button></div><CollectionFileImportCard source={source} imports={imports} busy={busy} autoFocus execute={execute} onClose={() => setOnboardingSourceId(null)} /></div> : null}
                  <CollectionOnboardingWorkspace source={source} setup={onboarding} instances={instances} pipelines={pipelines} busy={busy} execute={execute} mode="overview" onOpenMessages={() => { setOnboardingSourceId(null); setMessagesSourceId(source.id); }} />
                  <details className="mx-6 border-t border-[var(--border-subtle)] pt-4">
                    <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-[var(--color-gray-600)] focus-visible:outline-none focus-visible:shadow-focus">Detalhes técnicos <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /></summary>
                    <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2"><div><dt className="font-mono uppercase tracking-wide text-[var(--color-gray-500)]">Identificador</dt><dd className="mt-1 break-all font-mono text-[var(--color-gray-600)]">{source.public_id}</dd></div>{source.source_type === "webhook" ? <div><dt className="font-mono uppercase tracking-wide text-[var(--color-gray-500)]">Endereço de recebimento</dt><dd className="mt-1 break-all font-mono text-[var(--color-gray-600)]">/api/integrations/collections/v1/sources/{source.public_id}/events</dd></div> : null}</dl>
                  </details>
                </div>
              </DialogContent>
            </Dialog> : null}
            {isMessagesOpen ? <Dialog open={isMessagesOpen} onOpenChange={(open) => { if (!open) setMessagesSourceId(null); }}>
              <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto p-0">
                <DialogHeader className="border-b border-[var(--border-default)] px-6 py-3 pr-12 text-left">
                  <Button type="button" variant="ghost" size="sm" className="-ml-2 w-fit" onClick={() => { setMessagesSourceId(null); setOnboardingSourceId(source.id); }}><ArrowLeft />Voltar para configuração</Button>
                </DialogHeader>
                <CollectionOnboardingWorkspace source={source} setup={onboarding} instances={instances} pipelines={pipelines} busy={busy} execute={execute} mode="messages" />
              </DialogContent>
            </Dialog> : null}
          </article>;
          })}
      </div>
    </Card>
    <Dialog open={createSourceOpen} onOpenChange={(open) => { if (!busy) setCreateSourceOpen(open); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Adicionar fonte</DialogTitle>
          <DialogDescription>Conecte uma origem de dados para iniciar a cobrança.</DialogDescription>
        </DialogHeader>
      <div className="space-y-6">
      <Card className="border-0 bg-transparent p-0 shadow-none"><h2 className="sr-only">Nova fonte</h2>
        <form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); void execute("create-source", async () => {
          const result = await createCollectionSource({ name, sourceType: type, deliveryMode: type === "webhook" ? "push" : type === "rb" ? "pull" : "file", defaultIngestionMode: "incremental", config: newSourceInstance ? { whatsappInstanceName: newSourceInstance } : {} });
          if (result.secret) setSecret(result.secret); setName("");
          setOnboardingSourceId(result.source.id);
          if (newSourceInstance) await prepareCollectionOnboarding({ sourceConnectionId: result.source.id, instanceName: newSourceInstance });
          setNewSourceInstance("");
          setCreateSourceOpen(false);
        }, "Fonte criada"); }}>
          <div className="space-y-2"><Label htmlFor="collection-source-name">Nome</Label><Input id="collection-source-name" value={name} onChange={(e) => setName(e.target.value)} required disabled={busy !== null} /></div>
          <div className="space-y-2"><Label>Tipo</Label><Select value={type} onValueChange={(value) => setType(value as "rb" | "webhook" | "file")} disabled={busy !== null}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="rb">Registro Base</SelectItem><SelectItem value="webhook">Webhook genérico</SelectItem><SelectItem value="file">CSV/XLSX</SelectItem></SelectContent></Select></div>
          {type === "rb" ? <p className="text-xs text-[var(--color-gray-500)]">Usaremos a conexão do Registro Base já cadastrada. A cobrança continuará aguardando sua ativação.</p> : null}
          {type === "file" ? <div className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] p-3"><p className="text-xs text-[var(--color-gray-600)]">A fonte será criada antes do primeiro upload.</p><Button type="button" size="sm" variant="outline" onClick={() => downloadCollectionImportTemplate()} disabled={busy !== null}><Download />Modelo</Button></div> : null}
          <div className="space-y-2"><Label>WhatsApp de envio <span className="font-normal text-[var(--color-gray-500)]">(opcional)</span></Label><Select value={newSourceInstance} onValueChange={setNewSourceInstance} disabled={busy !== null}><SelectTrigger><SelectValue placeholder={instances.length ? "Selecionar depois" : "Conecte em Integrações"} /></SelectTrigger><SelectContent>{instances.map((item) => <SelectItem key={item.instancia} value={item.instancia}>{whatsAppInstanceLabel(item.instancia, item.provider, item.phoneNumber)}</SelectItem>)}</SelectContent></Select></div>
          <Button type="submit" className="w-full shadow-primary" disabled={!name.trim() || busy !== null}>{busy === "create-source" ? <Loader2 className="animate-spin" /> : <Plus />}Criar fonte</Button>
        </form></Card>
      </div>
      </DialogContent>
    </Dialog>
    <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => { if (!open && !busy) setPendingDelete(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir fonte?</AlertDialogTitle>
          <AlertDialogDescription>
            A fonte <strong>{pendingDelete?.name}</strong> será retirada da operação e não aparecerá mais nesta lista. O histórico já processado será preservado.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={Boolean(busy)}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-[var(--color-error-500)] text-[var(--color-surface-1)] shadow-sm hover:bg-[var(--color-error-600)] focus-visible:shadow-focus"
            disabled={Boolean(busy)}
            onClick={(event) => {
              event.preventDefault();
              if (!pendingDelete) return;
              void (async () => {
                const deleted = await execute(`delete-${pendingDelete.id}`, () => deleteCollectionSource(pendingDelete.id), "Fonte excluída");
                if (deleted) {
                  if (technicalDetailsSourceId === pendingDelete.id) setTechnicalDetailsSourceId(null);
                  setPendingDelete(null);
                }
              })();
            }}
          >
            {busy?.startsWith("delete-") ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
            Excluir fonte
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

function CollectionOnboardingInline({ source, setup, instances, pipelines, busy, execute, onClose }: {
  source: CollectionSource;
  setup?: CollectionOnboardingSetup;
  instances: Instance[];
  pipelines: CollectionConfiguration["pipelines"];
  busy: string | null;
  execute: (key: string, operation: () => Promise<unknown>, success: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [selectedInstance, setSelectedInstance] = useState(setup?.instance?.name ?? (instances.length === 1 ? instances[0].instancia : ""));
  const [message, setMessage] = useState(setup?.message?.message_template ?? "");
  const [localSetup, setLocalSetup] = useState<CollectionOnboardingSetup | undefined>(undefined);
  const [templates, setTemplates] = useState<CollectionOfficialTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("lembrete_cobranca_vencimento");
  const [templateBody, setTemplateBody] = useState("Olá {nome}, identificamos uma pendência de {valor}. Vencimento: {vencimento}.");
  const [templateExample, setTemplateExample] = useState("Mariana,249.90,10/09/2026");
  const [pipelineEditOpen, setPipelineEditOpen] = useState(false);
  const [selectedPipelineId, setSelectedPipelineId] = useState(setup?.pipeline?.id ?? "");
  const currentSetup = localSetup ?? setup;

  useEffect(() => {
    setLocalSetup(undefined);
    setSelectedInstance(setup?.instance?.name ?? (instances.length === 1 ? instances[0].instancia : ""));
    setMessage(setup?.message?.message_template ?? "");
    setSelectedPipelineId(setup?.pipeline?.id ?? "");
  }, [source.id, setup?.instance?.name, setup?.message?.message_template, setup?.pipeline?.id, instances]);

  const prepared = Boolean(currentSetup?.prepared);
  const provider = currentSetup?.instance?.provider ?? instances.find((item) => item.instancia === selectedInstance)?.provider;
  const isOfficialProvider = provider === "meta" || provider === "gupshup";
  const isActive = Boolean(currentSetup?.sendingEnabled);
  const messageTemplateName = currentSetup?.message?.gupshup_template_name?.trim() ?? "";
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId)
    ?? templates.find((template) => template.name === messageTemplateName);
  const templatePending = Boolean(currentSetup?.pending.includes("template"));

  useEffect(() => {
    setSelectedTemplateId(currentSetup?.message?.gupshup_template_id?.trim()
      || currentSetup?.message?.gupshup_template_name?.trim()
      || "");
  }, [source.id, currentSetup?.message?.gupshup_template_id, currentSetup?.message?.gupshup_template_name]);

  useEffect(() => {
    const instanceName = currentSetup?.instance?.name ?? selectedInstance;
    if (!prepared || !isOfficialProvider || !instanceName || !provider) {
      setTemplates([]);
      setTemplatesError(null);
      return;
    }
    let cancelled = false;
    setTemplatesLoading(true);
    setTemplatesError(null);
    void listCollectionOfficialTemplates(instanceName, provider === "meta" ? "meta" : "gupshup")
      .then((next) => { if (!cancelled) setTemplates(next); })
      .catch((error) => { if (!cancelled) setTemplatesError(error instanceof Error ? error.message : "Não foi possível carregar os templates"); })
      .finally(() => { if (!cancelled) setTemplatesLoading(false); });
    return () => { cancelled = true; };
  }, [currentSetup?.instance?.name, isOfficialProvider, prepared, provider, selectedInstance]);

  const saveMessage = () => void execute(`message-${source.id}`, async () => {
    const next = await updateCollectionMessage(source.id, currentSetup?.message?.id ?? "", {
      label: currentSetup?.message?.label ?? "Lembrete no vencimento",
      messageTemplate: message,
      timingRelation: (currentSetup?.message?.collection_timing_relation ?? currentSetup?.journeyRule?.timing_relation ?? "on_due") as "before_due" | "on_due" | "after_due",
      daysOffset: Number(currentSetup?.message?.collection_days_offset ?? currentSetup?.journeyRule?.days_offset ?? 0),
      template: selectedTemplate && provider
        ? {
            provider: provider === "meta" ? "meta" : "gupshup",
            id: selectedTemplate.id,
            name: selectedTemplate.name,
            language: selectedTemplate.language,
            status: selectedTemplate.status,
            params: selectedTemplate.params,
            rejectionReason: selectedTemplate.rejectionReason,
          }
        : null,
    });
    setLocalSetup(next);
  }, "Mensagem salva como rascunho");
  const prepare = () => void execute(`prepare-${source.id}`, async () => {
    const next = await prepareCollectionOnboarding({ sourceConnectionId: source.id, instanceName: selectedInstance });
    setLocalSetup(next);
    setMessage(next?.message?.message_template ?? message);
  }, "Cobrança preparada");
  const changePipeline = (createNewPipeline = false) => void execute(`pipeline-${source.id}`, async () => {
    const next = await prepareCollectionOnboarding({
      sourceConnectionId: source.id,
      instanceName: currentSetup?.instance?.name ?? selectedInstance,
      pipelineId: createNewPipeline ? null : selectedPipelineId,
      createNewPipeline,
    });
    setLocalSetup(next);
    setPipelineEditOpen(false);
  }, "Pipeline atualizado");
  const activate = () => void execute(`activate-${source.id}`, async () => {
    const next = await activateCollectionSending(source.id);
    setLocalSetup(next);
  }, "Envios ativados");
  const pause = () => void execute(`sending-pause-${source.id}`, async () => {
    const next = await pauseCollectionSending(source.id);
    setLocalSetup(next);
  }, "Envios pausados");
  const selectTemplate = (value: string) => {
    setSelectedTemplateId(value);
    const next = templates.find((template) => template.id === value);
    if (next?.body) setMessage(templateBodyForEditor(next.body));
  };
  const createTemplate = () => void execute(`template-${source.id}`, async () => {
    if (!provider) return false;
    const created = await createCollectionOfficialTemplate({
      provider: provider === "meta" ? "meta" : "gupshup",
      instanceName: currentSetup?.instance?.name ?? selectedInstance,
      name: templateName.trim(),
      body: templateBodyForProvider(templateBody),
      example: templateExample,
    });
    setTemplates((current) => [created, ...current.filter((item) => item.id !== created.id && item.name !== created.name)]);
    setSelectedTemplateId(created.id || created.name);
    setMessage(templateBodyForEditor(created.body || templateBody));
    setShowCreateTemplate(false);
  }, "Template criado. Aguardando aprovação do provedor");

  return <div className="border-t border-[var(--border-default)] bg-[var(--color-surface-2)] px-6 py-6">
    <div className="hidden">
      <div className="min-w-0">
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[var(--color-gray-500)]">Configuração da cobrança</p>
        <h4 className="mt-2 text-lg font-semibold text-[var(--color-gray-900)]">Uma configuração simples para esta fonte</h4>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-gray-600)]">Escolha o WhatsApp uma vez. O agente, a régua e o pipeline são preparados automaticamente.</p>
      </div>
      <Button variant="ghost" size="sm" onClick={onClose}>Fechar</Button>
    </div>

    {!prepared ? <div className="mt-6 max-w-xl space-y-4">
      <div className="space-y-2"><Label>WhatsApp de envio</Label>
        {instances.length === 0 ? <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-4 text-sm text-[var(--color-gray-600)]">
          Nenhum WhatsApp está conectado. <a className="font-medium text-[var(--color-primary-600)] underline-offset-4 hover:underline" href={`/conexoes?returnTo=cobranca&source=${encodeURIComponent(source.id)}`}>Conectar WhatsApp</a> e retome aqui.
        </div> : <Select value={selectedInstance} onValueChange={setSelectedInstance} disabled={busy !== null}>
          <SelectTrigger><SelectValue placeholder="Selecione o WhatsApp" /></SelectTrigger>
          <SelectContent>{instances.map((item) => <SelectItem key={item.instancia} value={item.instancia}>{whatsAppInstanceLabel(item.instancia, item.provider, item.phoneNumber)}</SelectItem>)}</SelectContent>
        </Select>}
      </div>
      <Button className="shadow-primary" disabled={!selectedInstance || instances.length === 0 || busy !== null} onClick={prepare}>
        {busy === `prepare-${source.id}` ? <Loader2 className="animate-spin" /> : <Cable />}Preparar cobrança
      </Button>
    </div> : <>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Agente", currentSetup?.agent?.name ?? "Agente de cobrança"],
          ["WhatsApp", whatsAppInstanceLabel(
            currentSetup?.instance?.name ?? selectedInstance,
            currentSetup?.instance?.provider ?? instances.find((item) => item.instancia === selectedInstance)?.provider,
            currentSetup?.instance?.phoneNumber ?? instances.find((item) => item.instancia === selectedInstance)?.phoneNumber,
          )],
          ["Pipeline", currentSetup?.pipeline?.name ?? "Pipeline de cobrança"],
          ["Régua", currentSetup?.funnel?.name ?? "Régua de cobrança"],
        ].map(([label, value]) => <div key={label} className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--color-surface-1)] px-4 py-3">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--color-gray-500)]">{label}</p>
          <p className="mt-1 truncate text-sm font-medium text-[var(--color-gray-900)]">{value}</p>
        </div>)}
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-[var(--color-gray-500)]">O pipeline de cobrança pode ser compartilhado por outras fontes compatíveis.</p><Button type="button" variant="ghost" size="sm" onClick={() => setPipelineEditOpen((value) => !value)} disabled={busy !== null}>{pipelineEditOpen ? "Fechar" : "Alterar pipeline"}</Button></div>
      {pipelineEditOpen ? <div className="mt-3 flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-4 sm:flex-row sm:items-end"><div className="min-w-0 flex-1 space-y-2"><Label>Pipeline de cobrança</Label><Select value={selectedPipelineId} onValueChange={setSelectedPipelineId}><SelectTrigger><SelectValue placeholder="Selecione um pipeline de cobrança" /></SelectTrigger><SelectContent>{pipelines.filter((pipeline) => pipeline.is_active && (pipeline.classifier_key === "crm_collection" || pipeline.name.toLowerCase().includes("cobrança") || pipeline.name.toLowerCase().includes("cobranca"))).map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}</SelectContent></Select></div><div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={() => changePipeline()} disabled={!selectedPipelineId || busy !== null}>{busy === `pipeline-${source.id}` ? <Loader2 className="animate-spin" /> : null}Salvar</Button><Button type="button" size="sm" onClick={() => changePipeline(true)} disabled={busy !== null}>{busy === `pipeline-${source.id}` ? <Loader2 className="animate-spin" /> : <Plus />}Novo</Button></div></div> : null}
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h5 className="font-semibold text-[var(--color-gray-900)]">Primeira mensagem</h5><p className="mt-1 text-xs text-[var(--color-gray-500)]">Lembrete no vencimento · rascunho editável</p></div><span className="text-xs font-medium text-[var(--color-warning-600)]">{isActive ? "Em uso" : "Rascunho"}</span></div>
          {isOfficialProvider ? <div className="mt-4 space-y-3 rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><Label>Template de envio</Label><Button type="button" variant="ghost" size="sm" onClick={() => setShowCreateTemplate((value) => !value)} disabled={busy !== null}>{showCreateTemplate ? "Fechar" : "Criar template"}</Button></div>
            <Select value={selectedTemplateId} onValueChange={selectTemplate} disabled={busy !== null || templatesLoading}><SelectTrigger><SelectValue placeholder={templatesLoading ? "Carregando templates..." : "Selecione um template aprovado"} /></SelectTrigger><SelectContent>{templates.map((template) => <SelectItem key={template.id || template.name} value={template.id || template.name}>{template.name} · {template.status}</SelectItem>)}</SelectContent></Select>
            {selectedTemplate ? <p className={`text-xs ${isApprovedTemplateStatus(selectedTemplate.status) ? "text-[var(--color-success-600)]" : "text-[var(--color-warning-600)]"}`}>{isApprovedTemplateStatus(selectedTemplate.status) ? "Aprovado e pronto para usar" : selectedTemplate.status.toLowerCase() === "rejected" ? `Rejeitado${selectedTemplate.rejectionReason ? `: ${selectedTemplate.rejectionReason}` : ""}` : "Aguardando aprovação"}</p> : null}
            {templatesError ? <p className="text-xs text-[var(--color-error-600)]">{templatesError}</p> : null}
            {!templatesLoading && templates.length === 0 && !templatesError ? <p className="text-xs text-[var(--color-gray-500)]">Nenhum template encontrado. Crie o primeiro aqui.</p> : null}
            {showCreateTemplate ? <div className="space-y-3 border-t border-[var(--border-subtle)] pt-3"><div className="space-y-2"><Label htmlFor={`template-name-${source.id}`}>Nome sugerido</Label><Input id={`template-name-${source.id}`} value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="lembrete_cobranca" /></div><div className="space-y-2"><Label htmlFor={`template-body-${source.id}`}>Conteúdo</Label><Textarea id={`template-body-${source.id}`} value={templateBody} onChange={(event) => setTemplateBody(event.target.value)} className="min-h-24" placeholder="Olá {nome}, sua pendência é de {valor}." /></div><p className="text-xs text-[var(--color-gray-500)]">Use nome, valor, vencimento ou credor. O provedor receberá os exemplos automaticamente.</p><div className="space-y-2"><Label htmlFor={`template-example-${source.id}`}>Exemplos</Label><Input id={`template-example-${source.id}`} value={templateExample} onChange={(event) => setTemplateExample(event.target.value)} placeholder="Mariana,249.90,10/09/2026" /></div><Button type="button" size="sm" onClick={createTemplate} disabled={!templateName.trim() || !templateBody.trim() || busy !== null}>{busy === `template-${source.id}` ? <Loader2 className="animate-spin" /> : <Plus />}Criar e usar</Button></div> : null}
          </div> : null}
          <Textarea className="mt-4 min-h-32 resize-y" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Escreva o lembrete que será enviado..." disabled={busy !== null || (isOfficialProvider && Boolean(selectedTemplate))} />
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--color-gray-500)]"><span className="rounded-full bg-[var(--color-surface-2)] px-2 py-1">nome</span><span className="rounded-full bg-[var(--color-surface-2)] px-2 py-1">valor</span><span className="rounded-full bg-[var(--color-surface-2)] px-2 py-1">vencimento</span></div>
          <div className="mt-4 rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] p-4 text-sm text-[var(--color-gray-700)]"><p className="font-medium text-[var(--color-gray-900)]">Prévia</p><p className="mt-2">{message.replace(/\{nome\}/g, "Mariana").replace(/\{valor\}/g, "R$ 249,90").replace(/\{vencimento\}/g, "10/09/2026") || "A mensagem aparecerá aqui."}</p></div>
          {isOfficialProvider ? <p className="mt-4 text-xs text-[var(--color-gray-500)]">Este WhatsApp usa templates oficiais. A aprovação libera a ativação, mas os envios continuam manuais.</p> : null}
          <div className="mt-5 flex flex-wrap gap-2"><Button variant="outline" disabled={!message.trim() || busy !== null} onClick={saveMessage}>{busy === `message-${source.id}` ? <Loader2 className="animate-spin" /> : null}Salvar mensagem</Button>{isActive ? <Button variant="outline" disabled={busy !== null} onClick={pause}>{busy === `sending-pause-${source.id}` ? <Loader2 className="animate-spin" /> : <Pause />}Pausar envios</Button> : <Button className="shadow-primary" disabled={!message.trim() || source.status !== "active" || busy !== null || templatePending || (isOfficialProvider && (!selectedTemplate || !isApprovedTemplateStatus(selectedTemplate.status)))} onClick={activate}>{busy === `activate-${source.id}` ? <Loader2 className="animate-spin" /> : <Play />}Ativar {currentSetup?.agent?.is_active ? "envios" : "agente e envios"}</Button>}</div>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-5"><h5 className="font-semibold text-[var(--color-gray-900)]">Momento do envio</h5><p className="mt-1 text-xs text-[var(--color-gray-500)]">A régua começa no vencimento. Outros momentos podem ser adicionados depois.</p><div className="mt-5 flex items-center justify-between border-b border-[var(--border-subtle)] pb-3 text-sm"><span className="text-[var(--color-gray-600)]">Quando</span><span className="font-medium text-[var(--color-gray-900)]">No vencimento</span></div><div className="flex items-center justify-between py-3 text-sm"><span className="text-[var(--color-gray-600)]">Dados</span><span className="font-medium text-[var(--color-gray-900)]">{source.last_success_at ? "Recebendo" : "Aguardando dados"}</span></div><p className="mt-3 text-xs leading-5 text-[var(--color-gray-500)]">Conectar uma fonte não inicia disparos. A ativação é sempre manual.</p></div>
      </div>
    </>}
  </div>;
}

function HistoryPanel({ sources, imports, ingestions }: { sources: CollectionSource[]; imports: Awaited<ReturnType<typeof listCollectionImports>>; ingestions: Awaited<ReturnType<typeof listCollectionIngestions>> }) {
  const names = useMemo(() => new Map(sources.map((source) => [source.id, source.name])), [sources]);
  return <Card className="overflow-hidden border-[var(--border-default)] bg-[var(--color-surface-1)] shadow-sm"><div className="p-6"><h2 className="text-xl font-semibold">Ingestões</h2></div>
    {ingestions.length === 0 ? <div className="p-10 text-center text-sm text-[var(--color-gray-500)]">Nenhuma ingestão registrada.</div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Fonte</TableHead><TableHead>Modo</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Recebidos</TableHead><TableHead className="text-right">Criados</TableHead><TableHead className="text-right">Atualizados</TableHead><TableHead>Data</TableHead></TableRow></TableHeader><TableBody>{ingestions.map((item) => <TableRow key={item.id}><TableCell>{names.get(item.source_connection_id) ?? "Fonte não identificada"}</TableCell><TableCell className="font-mono text-xs uppercase">{item.mode}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell><TableCell className="text-right font-mono">{item.received_count}</TableCell><TableCell className="text-right font-mono">{item.created_count}</TableCell><TableCell className="text-right font-mono">{item.updated_count}</TableCell><TableCell className="font-mono text-xs">{formatDate(item.created_at)}</TableCell></TableRow>)}</TableBody></Table></div>}
    <div className="border-t border-[var(--border-default)] p-6"><h3 className="text-lg font-semibold text-[var(--color-gray-900)]">Importações de arquivos</h3>
      {imports.length === 0 ? <p className="mt-3 text-sm text-[var(--color-gray-500)]">Nenhum arquivo processado.</p> : <div className="mt-4 grid gap-3 sm:grid-cols-2">{imports.slice(0, 10).map((item) => <div key={item.id} className="rounded-[var(--radius-lg)] border border-[var(--border-default)] p-4"><div className="flex items-start justify-between gap-2"><p className="truncate text-sm font-medium text-[var(--color-gray-900)]">{item.original_file_name}</p><StatusBadge status={item.status} /></div><p className="mt-2 text-xs text-[var(--color-gray-500)]">{names.get(item.source_connection_id) ?? "Fonte não identificada"}</p><p className="mt-1 font-mono text-xs text-[var(--color-gray-500)]">{formatDate(item.created_at)}</p></div>)}</div>}
    </div>
  </Card>;
}
