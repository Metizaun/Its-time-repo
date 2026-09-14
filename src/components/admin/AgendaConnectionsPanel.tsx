import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Copy, Loader2, Pencil, Plus, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  correctAgendaAppointmentStatus, createAgendaConnection, disableAgendaConnection, getAgendaScopeOptions, listAgendaAudit,
  listAgendaConnections, listAgendaDeadLetters, listAgendaDeliveries, operateAgendaConnection,
  resolveAgendaDeadLetter, rotateAgendaCredential, startAgendaResync, updateAgendaConnection,
  type AgendaAudit, type AgendaConnection, type AgendaConnectionInput, type AgendaDeadLetter,
  type AgendaDelivery, type AgendaScopeOptions, type AgendaSecrets,
} from "@/services/agendaService";
import { cn } from "@/lib/utils";

export type AgendaPanelSummary = { active: number; pending: number; errors: number; total: number };

const emptyForm: AgendaConnectionInput = {
  name: "", outboundUrl: "", scopeMode: "selected_scope", unitIds: [], assignmentIds: [],
  defaultTimezone: "America/Sao_Paulo",
};

const stageLabels: Record<string, string> = {
  units: "Sincronizando unidades", professionals: "Sincronizando profissionais",
  availability: "Sincronizando disponibilidades", patients: "Sincronizando pacientes",
  appointments: "Sincronizando agendamentos", deltas: "Aplicando alteracoes recentes",
  delivery: "Aguardando entregas", complete: "Sincronizacao concluida",
};

function statusLabel(connection: AgendaConnection) {
  if (connection.status === "syncing") return connection.resync?.stage ? stageLabels[connection.resync.stage] ?? "Sincronizando" : "Sincronizando";
  return ({ draft: "Nao configurada", active: "Conectada", paused: "Pausada", error: "Requer atencao", disabled: "Desativada" } as const)[connection.status];
}

function statusTone(status: AgendaConnection["status"]) {
  if (status === "active") return "bg-success";
  if (status === "error") return "bg-destructive";
  if (status === "syncing") return "bg-warning";
  return "bg-muted-foreground";
}

function formatDate(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
}

export function AgendaConnectionsPanel({ onSummaryChange }: { onSummaryChange?: (summary: AgendaPanelSummary) => void }) {
  const [connections, setConnections] = useState<AgendaConnection[]>([]);
  const [scope, setScope] = useState<AgendaScopeOptions>({ units: [], assignments: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<AgendaConnectionInput>(emptyForm);
  const [secrets, setSecrets] = useState<AgendaSecrets | null>(null);
  const [deliveries, setDeliveries] = useState<AgendaDelivery[]>([]);
  const [deadLetters, setDeadLetters] = useState<AgendaDeadLetter[]>([]);
  const [audit, setAudit] = useState<AgendaAudit[]>([]);
  const [reasonDialog, setReasonDialog] = useState<{ kind: "resync" | "retry" | "skip" | "disable"; outboxId?: string } | null>(null);
  const [reason, setReason] = useState("");
  const [deliveryFilters, setDeliveryFilters] = useState({ eventType: "", outcome: "" });
  const [correction, setCorrection] = useState({ appointmentId: "", status: "done" as "cancelled" | "done" | "no_show", reason: "" });

  const selected = connections.find((item) => item.id === selectedId) ?? null;
  const summary = useMemo<AgendaPanelSummary>(() => ({
    total: connections.length,
    active: connections.filter((item) => item.status === "active").length,
    pending: connections.filter((item) => ["draft", "syncing"].includes(item.status)).length,
    errors: connections.filter((item) => item.status === "error" || Number(item.metrics?.dead_letter_count ?? 0) > 0).length,
  }), [connections]);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [items, options] = await Promise.all([listAgendaConnections(), getAgendaScopeOptions()]);
      setConnections(items); setScope(options); onSummaryChange?.({
        total: items.length,
        active: items.filter((item) => item.status === "active").length,
        pending: items.filter((item) => ["draft", "syncing"].includes(item.status)).length,
        errors: items.filter((item) => item.status === "error" || Number(item.metrics?.dead_letter_count ?? 0) > 0).length,
      });
      const requested = new URLSearchParams(window.location.search).get("connection");
      setSelectedId((current) => (requested && items.some((item) => item.id === requested) ? requested : current && items.some((item) => item.id === current) ? current : items[0]?.id ?? null));
    } catch (error) { toast.error(error instanceof Error ? error.message : "Nao foi possivel carregar a Agenda Universal"); }
    finally { if (!quiet) setLoading(false); }
  }, [onSummaryChange]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!connections.some((item) => item.status === "syncing")) return;
    const timer = window.setInterval(() => void refresh(true), 5_000);
    return () => window.clearInterval(timer);
  }, [connections, refresh]);
  useEffect(() => {
    if (!selectedId) return;
    void Promise.all([listAgendaDeliveries(selectedId), listAgendaDeadLetters(selectedId), listAgendaAudit(selectedId)])
      .then(([nextDeliveries, nextDeadLetters, nextAudit]) => {
        setDeliveries(nextDeliveries); setDeadLetters(nextDeadLetters); setAudit(nextAudit);
      }).catch((error) => toast.error(error instanceof Error ? error.message : "Falha ao carregar os detalhes"));
  }, [selectedId]);

  const openEditor = (connection?: AgendaConnection) => {
    setForm(connection ? {
      name: connection.name, outboundUrl: connection.outboundUrl, scopeMode: connection.scopeMode,
      unitIds: connection.unitIds, assignmentIds: connection.assignmentIds, defaultTimezone: connection.defaultTimezone,
    } : emptyForm);
    setEditorOpen(true);
  };

  const save = async () => {
    setBusy("save");
    try {
      if (selected && editorOpen) await updateAgendaConnection(selected.id, form);
      else {
        const created = await createAgendaConnection(form);
        setSecrets({ inboundSecret: created.inboundSecret, outboundSecret: created.outboundSecret });
        setSelectedId(created.connection.id);
      }
      setEditorOpen(false); await refresh(); toast.success(selected ? "Conexao atualizada" : "Conexao criada");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Nao foi possivel salvar"); }
    finally { setBusy(null); }
  };

  const operate = async (operation: "test" | "activate" | "pause" | "resume") => {
    if (!selected) return; setBusy(operation);
    try { await operateAgendaConnection(selected.id, operation); await refresh(); toast.success("Operacao solicitada"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Falha na operacao"); }
    finally { setBusy(null); }
  };

  const submitReason = async () => {
    if (!selected || !reasonDialog || !reason.trim()) return;
    setBusy(reasonDialog.kind);
    try {
      if (reasonDialog.kind === "resync") await startAgendaResync(selected.id, reason);
      else if (reasonDialog.kind === "disable") await disableAgendaConnection(selected.id);
      else await resolveAgendaDeadLetter(selected.id, reasonDialog.outboxId!, reasonDialog.kind, reason);
      setReasonDialog(null); setReason(""); await refresh();
      if (selectedId) {
        setDeadLetters(await listAgendaDeadLetters(selectedId));
        setAudit(await listAgendaAudit(selectedId));
      }
      toast.success("Operacao concluida");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha na operacao"); }
    finally { setBusy(null); }
  };

  const toggle = (field: "unitIds" | "assignmentIds", id: string, checked: boolean) => setForm((current) => ({
    ...current, [field]: checked ? [...current[field], id] : current[field].filter((value) => value !== id),
  }));

  const submitCorrection = async () => {
    if (!selected || !correction.appointmentId.trim() || !correction.reason.trim()) return;
    setBusy("correction");
    try {
      await correctAgendaAppointmentStatus(selected.id, correction.appointmentId.trim(), correction.status, correction.reason.trim());
      setCorrection({ appointmentId: "", status: "done", reason: "" });
      setAudit(await listAgendaAudit(selected.id));
      toast.success("Status corrigido e nova versao gerada");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao corrigir o status"); }
    finally { setBusy(null); }
  };

  if (loading) return <div className="flex min-h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /><span className="sr-only">Carregando</span></div>;

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">Conexoes</p><p className="text-sm text-muted-foreground">{summary.total} configurada{summary.total === 1 ? "" : "s"}</p></div>
      <Button onClick={() => { setSelectedId(null); openEditor(); }}><Plus className="h-4 w-4" />Nova conexao</Button>
    </div>

    {connections.length === 0 ? <div className="rounded-xl bg-card p-8 text-center shadow-sm"><p className="font-medium">Nenhuma conexao configurada.</p><Button className="mt-4" onClick={() => openEditor()}><Plus className="h-4 w-4" />Criar conexao</Button></div> :
      <div className="grid gap-2 sm:grid-cols-2">
        {connections.map((connection) => <button key={connection.id} type="button" onClick={() => setSelectedId(connection.id)}
          className={cn("rounded-xl bg-card p-4 text-left shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", selectedId === connection.id && "ring-2 ring-primary")}>
          <div className="flex items-center justify-between gap-3"><span className="truncate font-semibold">{connection.name}</span><span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", statusTone(connection.status))} /></div>
          <p className="mt-1 text-xs text-muted-foreground">{statusLabel(connection)}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><span>Ultimo envio<br /><strong>{formatDate(connection.lastDeliveredAt)}</strong></span><span>Pendentes<br /><strong>{Number(connection.metrics?.pending_count ?? 0)}</strong></span></div>
        </button>)}
      </div>}

    {selected ? <Tabs defaultValue="config" className="min-w-0">
      <TabsList className="h-auto w-full justify-start overflow-x-auto">
        <TabsTrigger value="config">Configuracao</TabsTrigger><TabsTrigger value="auth">Autenticacao</TabsTrigger>
        <TabsTrigger value="operation">Operacao</TabsTrigger><TabsTrigger value="deliveries">Entregas</TabsTrigger>
        <TabsTrigger value="dead">Dead letters</TabsTrigger><TabsTrigger value="audit">Auditoria</TabsTrigger>
      </TabsList>
      <TabsContent value="config" className="space-y-4 rounded-xl bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{selected.name}</h3><p className="text-sm text-muted-foreground">{selected.scopeMode === "all_resources" ? "Todos os recursos" : `${selected.unitIds.length} unidades e ${selected.assignmentIds.length} locais independentes`}</p></div><Button variant="outline" size="sm" disabled={selected.status === "active" || selected.status === "syncing"} onClick={() => openEditor(selected)}><Pencil className="h-4 w-4" />Editar</Button></div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Endpoint</dt><dd className="break-all font-medium">{selected.outboundUrl}</dd></div><div><dt className="text-muted-foreground">Fuso horario</dt><dd className="font-medium">{selected.defaultTimezone}</dd></div></dl>
      </TabsContent>
      <TabsContent value="auth" className="space-y-4 rounded-xl bg-card p-4 shadow-sm">
        <p className="text-sm text-muted-foreground">A rotacao mantem o segredo anterior valido por 24 horas. O novo valor aparece uma unica vez.</p>
        <div className="flex flex-wrap gap-2">{(["inbound", "outbound"] as const).map((direction) => <Button key={direction} variant="outline" disabled={Boolean(busy)} onClick={async () => { setBusy(direction); try { const value = await rotateAgendaCredential(selected.id, direction); setSecrets(direction === "inbound" ? { inboundSecret: value, outboundSecret: "Nao alterado" } : { inboundSecret: "Nao alterado", outboundSecret: value }); } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao rotacionar"); } finally { setBusy(null); } }}><RotateCw className="h-4 w-4" />Rotacionar {direction === "inbound" ? "entrada" : "saida"}</Button>)}</div>
      </TabsContent>
      <TabsContent value="operation" className="space-y-4 rounded-xl bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2"><span className={cn("h-2.5 w-2.5 rounded-full", statusTone(selected.status))} /><strong>{statusLabel(selected)}</strong></div>
        {selected.lastErrorMessage ? <p className="flex gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{selected.lastErrorMessage}</p> : null}
        {selected.resync ? <div className="grid grid-cols-2 gap-3 text-sm"><span>Catalogo<br /><strong>{selected.resync.snapshot_count}</strong></span><span>Alteracoes recentes<br /><strong>{selected.resync.delta_count}</strong></span></div> : null}
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={Boolean(busy)} onClick={() => void operate("test")}>Testar</Button>{selected.status === "draft" ? <Button disabled={Boolean(busy)} onClick={() => void operate("activate")}>Ativar</Button> : null}{["active", "syncing", "error"].includes(selected.status) ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => void operate("pause")}>Pausar</Button> : null}{selected.status === "paused" ? <Button disabled={Boolean(busy)} onClick={() => void operate("resume")}>Retomar</Button> : null}{selected.status === "active" ? <Button variant="outline" onClick={() => setReasonDialog({ kind: "resync" })}><RefreshCw className="h-4 w-4" />Ressincronizar</Button> : null}<Button variant="ghost" className="text-destructive" onClick={() => setReasonDialog({ kind: "disable" })}><Trash2 className="h-4 w-4" />Desativar</Button></div>
        <div className="border-t border-border pt-4"><p className="mb-3 font-mono text-xs uppercase tracking-wide text-muted-foreground">Correcao administrativa</p><div className="grid gap-3"><Input aria-label="ID do agendamento" placeholder="ID do agendamento" value={correction.appointmentId} onChange={(event) => setCorrection((value) => ({ ...value, appointmentId: event.target.value }))} /><Select value={correction.status} onValueChange={(status: typeof correction.status) => setCorrection((value) => ({ ...value, status }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="done">Concluido</SelectItem><SelectItem value="no_show">Nao compareceu</SelectItem><SelectItem value="cancelled">Cancelado</SelectItem></SelectContent></Select><Textarea aria-label="Motivo da correcao" placeholder="Motivo da correcao" value={correction.reason} onChange={(event) => setCorrection((value) => ({ ...value, reason: event.target.value }))} /><Button variant="outline" disabled={busy === "correction" || !correction.appointmentId.trim() || !correction.reason.trim()} onClick={() => void submitCorrection()}>Corrigir status</Button></div></div>
      </TabsContent>
      <TabsContent value="deliveries" className="space-y-4 rounded-xl bg-card p-4 shadow-sm">
        <div className="flex flex-wrap gap-2"><Input className="max-w-56" placeholder="Tipo de evento" value={deliveryFilters.eventType} onChange={(event) => setDeliveryFilters((value) => ({ ...value, eventType: event.target.value }))} /><Select value={deliveryFilters.outcome || "all"} onValueChange={(value) => setDeliveryFilters((current) => ({ ...current, outcome: value === "all" ? "" : value }))}><SelectTrigger className="w-44"><SelectValue placeholder="Resultado" /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="delivered">Entregue</SelectItem><SelectItem value="retry">Nova tentativa</SelectItem><SelectItem value="dead_letter">Falha</SelectItem></SelectContent></Select><Button variant="outline" onClick={async () => setDeliveries(await listAgendaDeliveries(selected.id, deliveryFilters))}>Filtrar</Button></div>
        <div className="space-y-2">{deliveries.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma entrega encontrada.</p> : deliveries.map((item) => <div key={item.id} className="grid gap-1 border-b border-border py-3 text-sm sm:grid-cols-[1fr_auto]"><div><strong>{String(item.event_id)}</strong><p className="text-xs text-muted-foreground">{String(item.outcome)} · HTTP {String(item.http_status ?? "—")}</p></div><time className="font-mono text-xs text-muted-foreground">{formatDate(item.created_at)}</time></div>)}</div>
      </TabsContent>
      <TabsContent value="dead" className="space-y-3 rounded-xl bg-card p-4 shadow-sm">{deadLetters.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma entrega bloqueada.</p> : deadLetters.map((item) => <div key={item.id} className="space-y-2 border-b border-border py-3"><div><strong className="text-sm">{item.event_type}</strong><p className="text-xs text-muted-foreground">Sequencia {item.sequence} · {item.last_error_message ?? "Falha permanente"}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setReasonDialog({ kind: "retry", outboxId: item.id })}>Tentar novamente</Button><Button size="sm" variant="ghost" onClick={() => setReasonDialog({ kind: "skip", outboxId: item.id })}>Ignorar e avancar</Button></div></div>)}</TabsContent>
      <TabsContent value="audit" className="rounded-xl bg-card p-4 shadow-sm">{audit.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma atividade registrada.</p> : audit.map((item) => <div key={item.id} className="flex justify-between gap-3 border-b border-border py-3 text-sm"><span>{item.action.replace(/_/g, " ")}</span><time className="font-mono text-xs text-muted-foreground">{formatDate(item.created_at)}</time></div>)}</TabsContent>
    </Tabs> : null}

    <Dialog open={editorOpen} onOpenChange={setEditorOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{selectedId ? "Editar conexao" : "Nova conexao"}</DialogTitle><DialogDescription>Defina o destino e quais agendas serao compartilhadas.</DialogDescription></DialogHeader><div className="space-y-4"><div><Label htmlFor="agenda-name">Nome</Label><Input id="agenda-name" value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} /></div><div><Label htmlFor="agenda-url">Endpoint HTTPS</Label><Input id="agenda-url" type="url" value={form.outboundUrl} onChange={(event) => setForm((value) => ({ ...value, outboundUrl: event.target.value }))} /></div><div><Label>Escopo</Label><Select value={form.scopeMode} onValueChange={(value: AgendaConnectionInput["scopeMode"]) => setForm((current) => ({ ...current, scopeMode: value, unitIds: [], assignmentIds: [] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all_resources">Todos os recursos</SelectItem><SelectItem value="selected_scope">Selecionar unidades e locais</SelectItem></SelectContent></Select></div>{form.scopeMode === "selected_scope" ? <div className="grid gap-4 sm:grid-cols-2"><fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Unidades</legend>{scope.units.map((unit) => <label key={unit.id} className="flex items-start gap-2 text-sm"><Checkbox checked={form.unitIds.includes(unit.id)} onCheckedChange={(checked) => toggle("unitIds", unit.id, checked === true)} /><span>{unit.name}<small className="block text-muted-foreground">{unit.city}/{unit.state}</small></span></label>)}</fieldset><fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Locais independentes</legend>{scope.assignments.map((assignment) => <label key={assignment.id} className="flex items-start gap-2 text-sm"><Checkbox checked={form.assignmentIds.includes(assignment.id)} onCheckedChange={(checked) => toggle("assignmentIds", assignment.id, checked === true)} /><span>{assignment.location_name}<small className="block text-muted-foreground">{assignment.professionals?.name ?? "Profissional"}</small></span></label>)}</fieldset></div> : null}</div><DialogFooter><Button variant="ghost" onClick={() => setEditorOpen(false)}>Cancelar</Button><Button disabled={busy === "save"} onClick={() => void save()}>{busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Salvar</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={Boolean(secrets)} onOpenChange={(open) => !open && setSecrets(null)}><DialogContent><DialogHeader><DialogTitle>Guarde os segredos agora</DialogTitle><DialogDescription>Eles nao poderao ser consultados novamente.</DialogDescription></DialogHeader>{secrets ? <div className="space-y-3">{Object.entries(secrets).map(([key, value]) => <div key={key}><Label>{key === "inboundSecret" ? "Segredo de entrada" : "Segredo de saida"}</Label><div className="flex gap-2"><Input readOnly value={value} className="font-mono" /><Button size="icon" variant="outline" aria-label="Copiar segredo" onClick={() => void navigator.clipboard.writeText(value).then(() => toast.success("Segredo copiado"))}><Copy className="h-4 w-4" /></Button></div></div>)}</div> : null}<DialogFooter><Button onClick={() => setSecrets(null)}>Ja guardei</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={Boolean(reasonDialog)} onOpenChange={(open) => { if (!open) { setReasonDialog(null); setReason(""); } }}><DialogContent><DialogHeader><DialogTitle>{reasonDialog?.kind === "resync" ? "Ressincronizar conexao" : reasonDialog?.kind === "disable" ? "Desativar conexao" : reasonDialog?.kind === "retry" ? "Tentar entrega novamente" : "Ignorar entrega"}</DialogTitle><DialogDescription>Registre um motivo para manter a trilha de auditoria.</DialogDescription></DialogHeader><div><Label htmlFor="agenda-reason">Motivo</Label><Textarea id="agenda-reason" value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} /></div><DialogFooter><Button variant="ghost" onClick={() => setReasonDialog(null)}>Cancelar</Button><Button disabled={!reason.trim() || Boolean(busy)} onClick={() => void submitReason()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Confirmar</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
