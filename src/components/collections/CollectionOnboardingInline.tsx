import { useEffect, useState } from "react";
import { Cable, Loader2, Pause, Play, Plus, Save, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Instance } from "@/hooks/useInstances";
import {
  activateCollectionSending,
  createCollectionMessage,
  createCollectionOfficialTemplate,
  listCollectionOfficialTemplates,
  pauseCollectionSending,
  prepareCollectionOnboarding,
  updateCollectionMessage,
  type CollectionConfiguration,
  type CollectionMessage,
  type CollectionOfficialTemplate,
  type CollectionOnboardingSetup,
  type CollectionSource,
  type CollectionTimingRelation,
} from "@/services/collectionsService";

function whatsAppInstanceLabel(instanceName: string, provider?: string | null, phoneNumber?: string | null) {
  return [instanceName, phoneNumber || provider ? `${phoneNumber ?? provider}` : null].filter(Boolean).join(" · ");
}

function templateBodyForEditor(body: string) {
  const variables = ["nome", "valor", "vencimento", "credor"];
  let index = 0;
  return body.replace(/\{\{\s*\d+\s*\}\}/g, (placeholder) => `{${variables[index++] ?? placeholder}}`);
}

function templateBodyForProvider(body: string) {
  const variables = ["nome", "valor", "vencimento", "credor"];
  return body.replace(/\{([^{}]+)\}/g, (placeholder, name: string) => {
    const position = variables.indexOf(name.trim().toLowerCase());
    if (position < 0) return placeholder;
    return `{{${position + 1}}}`;
  });
}

function isApprovedTemplateStatus(status: string | null | undefined) {
  return ["approved", "active", "enabled"].includes((status ?? "").trim().toLowerCase());
}

function messageStatus(message: CollectionMessage) {
  if (message.is_active) return { label: "Ativa", className: "text-[var(--color-success-600)]" };
  if (message.template_status && !isApprovedTemplateStatus(message.template_status)) {
    return { label: "Aguardando aprovação", className: "text-[var(--color-warning-600)]" };
  }
  return { label: "Rascunho", className: "text-[var(--color-gray-600)]" };
}

type DraftMessage = {
  id: string | null;
  label: string;
  messageTemplate: string;
  timingRelation: CollectionTimingRelation;
  daysOffset: number;
  templateId: string;
};

function emptyDraft(): DraftMessage {
  return {
    id: null,
    label: "",
    messageTemplate: "",
    timingRelation: "on_due",
    daysOffset: 0,
    templateId: "",
  };
}

function draftFromMessage(message: CollectionMessage): DraftMessage {
  return {
    id: message.id,
    label: message.label ?? "",
    messageTemplate: message.message_template ?? "",
    timingRelation: message.collection_timing_relation ?? "on_due",
    daysOffset: Number(message.collection_days_offset ?? 0),
    templateId: message.gupshup_template_id ?? message.gupshup_template_name ?? "",
  };
}

export function CollectionOnboardingInline({ source, setup, instances, pipelines, busy, execute, mode = "overview", onOpenMessages }: {
  source: CollectionSource;
  setup?: CollectionOnboardingSetup;
  instances: Instance[];
  pipelines: CollectionConfiguration["pipelines"];
  busy: string | null;
  execute: (key: string, operation: () => Promise<unknown>, success: string) => Promise<boolean>;
  mode?: "overview" | "messages";
  onOpenMessages?: () => void;
}) {
  const [selectedInstance, setSelectedInstance] = useState(setup?.instance?.name ?? (instances.length === 1 ? instances[0].instancia : ""));
  const [localSetup, setLocalSetup] = useState<CollectionOnboardingSetup | undefined>();
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftMessage>(emptyDraft);
  const [templates, setTemplates] = useState<CollectionOfficialTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("lembrete_cobranca_vencimento");
  const [templateBody, setTemplateBody] = useState("Olá {nome}, identificamos uma pendência de {valor}. Vencimento: {vencimento}.");
  const [templateExample, setTemplateExample] = useState("Mariana,249.90,10/09/2026");
  const [pipelineEditOpen, setPipelineEditOpen] = useState(false);
  const [selectedPipelineId, setSelectedPipelineId] = useState(setup?.pipeline?.id ?? "");
  const currentSetup = localSetup ?? setup;
  const messages: CollectionMessage[] = (currentSetup?.messages ?? (currentSetup?.message ? [currentSetup.message as CollectionMessage] : [])) as CollectionMessage[];
  const selectedMessage = messages.find((message) => message.id === selectedMessageId) ?? null;

  const prepared = Boolean(currentSetup?.prepared);
  const provider = currentSetup?.instance?.provider ?? instances.find((item) => item.instancia === selectedInstance)?.provider;
  const isOfficialProvider = provider === "meta" || provider === "gupshup";
  const isActive = Boolean(currentSetup?.sendingEnabled);
  const selectedTemplate = templates.find((template) => template.id === draft.templateId)
    ?? templates.find((template) => template.name === selectedMessage?.gupshup_template_name);
  const templatePending = Boolean(currentSetup?.pending.includes("template"));

  useEffect(() => {
    setLocalSetup(undefined);
    setSelectedInstance(setup?.instance?.name ?? (instances.length === 1 ? instances[0].instancia : ""));
    setSelectedPipelineId(setup?.pipeline?.id ?? "");
    const nextMessages = setup?.messages ?? (setup?.message ? [setup.message as CollectionMessage] : []);
    const nextMessage = nextMessages[0];
    setSelectedMessageId(nextMessage?.id ?? null);
    setDraft(nextMessage ? draftFromMessage(nextMessage) : emptyDraft());
  }, [source.id, setup?.instance?.name, setup?.pipeline?.id, setup?.messages, setup?.message, instances]);

  useEffect(() => {
    if (!prepared || !isOfficialProvider || !currentSetup?.instance?.name || !provider) {
      setTemplates([]);
      setTemplatesError(null);
      return;
    }
    let cancelled = false;
    setTemplatesLoading(true);
    setTemplatesError(null);
    void listCollectionOfficialTemplates(currentSetup.instance.name, provider === "meta" ? "meta" : "gupshup")
      .then((next) => { if (!cancelled) setTemplates(next); })
      .catch((error) => { if (!cancelled) setTemplatesError(error instanceof Error ? error.message : "Não foi possível carregar os templates"); })
      .finally(() => { if (!cancelled) setTemplatesLoading(false); });
    return () => { cancelled = true; };
  }, [currentSetup?.instance?.name, isOfficialProvider, prepared, provider]);

  const prepare = () => void execute(`prepare-${source.id}`, async () => {
    const next = await prepareCollectionOnboarding({ sourceConnectionId: source.id, instanceName: selectedInstance });
    setLocalSetup(next);
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

  const saveMessage = () => void execute(`message-${source.id}`, async () => {
    const input = {
      label: draft.label,
      messageTemplate: draft.messageTemplate,
      timingRelation: draft.timingRelation,
      daysOffset: draft.timingRelation === "on_due" ? 0 : draft.daysOffset,
      template: selectedTemplate && provider
        ? {
            provider: provider === "meta" ? "meta" as const : "gupshup" as const,
            id: selectedTemplate.id,
            name: selectedTemplate.name,
            language: selectedTemplate.language,
            status: selectedTemplate.status,
            params: selectedTemplate.params,
            rejectionReason: selectedTemplate.rejectionReason,
          }
        : null,
    };
    const next = draft.id
      ? await updateCollectionMessage(source.id, draft.id, input)
      : await createCollectionMessage(source.id, input);
    setLocalSetup(next);
    const nextMessages = next.messages ?? [];
    const nextMessage = nextMessages.find((message) => message.label === (draft.label || "Mensagem de cobrança"))
      ?? (draft.id ? next.message : nextMessages[nextMessages.length - 1])
      ?? next.message;
    if (nextMessage) {
      setSelectedMessageId(nextMessage.id);
      setDraft(draftFromMessage(nextMessage as CollectionMessage));
    }
  }, draft.id ? "Mensagem salva como rascunho" : "Mensagem criada como rascunho");

  const activate = () => void execute(`activate-${source.id}`, async () => {
    const next = await activateCollectionSending(source.id);
    setLocalSetup(next);
  }, "Envios ativados");

  const pause = () => void execute(`sending-pause-${source.id}`, async () => {
    const next = await pauseCollectionSending(source.id);
    setLocalSetup(next);
  }, "Envios pausados");

  const selectMessage = (message: CollectionMessage) => {
    setSelectedMessageId(message.id);
    setDraft(draftFromMessage(message));
  };

  const selectTemplate = (value: string) => {
    setDraft((current) => ({ ...current, templateId: value }));
    const next = templates.find((template) => template.id === value);
    if (next?.body) setDraft((current) => ({ ...current, templateId: value, messageTemplate: templateBodyForEditor(next.body) }));
  };

  const createTemplate = () => void execute(`template-${source.id}`, async () => {
    if (!provider || !currentSetup?.instance?.name) return false;
    const created = await createCollectionOfficialTemplate({
      provider: provider === "meta" ? "meta" : "gupshup",
      instanceName: currentSetup.instance.name,
      name: templateName.trim(),
      body: templateBodyForProvider(templateBody),
      example: templateExample,
    });
    setTemplates((current) => [created, ...current.filter((item) => item.id !== created.id && item.name !== created.name)]);
    setDraft((current) => ({ ...current, templateId: created.id || created.name, messageTemplate: templateBodyForEditor(created.body || templateBody) }));
    setShowCreateTemplate(false);
  }, "Template criado. Aguardando aprovação do provedor");

  if (!prepared) {
    return <div className="border-t border-[var(--border-default)] bg-[var(--color-surface-2)] px-6 py-6">
      <div className="max-w-xl space-y-4">
        <div><p className="font-mono text-xs font-semibold uppercase tracking-wider text-[var(--color-gray-500)]">Preparação</p><h4 className="mt-2 text-lg font-semibold text-[var(--color-gray-900)]">Escolha o WhatsApp de envio</h4><p className="mt-1 text-sm text-[var(--color-gray-600)]">O agente, o pipeline e a régua são preparados automaticamente.</p></div>
        {instances.length === 0 ? <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-4 text-sm text-[var(--color-gray-600)]">Nenhum WhatsApp está conectado. Conecte um canal em Conexões e retome aqui.</div> : <div className="space-y-2"><Label>WhatsApp de envio</Label><Select value={selectedInstance} onValueChange={setSelectedInstance} disabled={busy !== null}><SelectTrigger><SelectValue placeholder="Selecione o WhatsApp" /></SelectTrigger><SelectContent>{instances.map((item) => <SelectItem key={item.instancia} value={item.instancia}>{whatsAppInstanceLabel(item.instancia, item.provider, item.phoneNumber)}</SelectItem>)}</SelectContent></Select></div>}
        <Button className="shadow-primary" disabled={!selectedInstance || instances.length === 0 || busy !== null} onClick={prepare}>{busy === `prepare-${source.id}` ? <Loader2 className="animate-spin" /> : <Cable />}Preparar cobrança</Button>
      </div>
    </div>;
  }

  return <div className={mode === "messages" ? "px-6 py-6" : "border-t border-[var(--border-default)] bg-[var(--color-surface-2)] px-6 py-6"}>
    {mode === "overview" ? <>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        ["Agente", currentSetup?.agent?.name ?? "Agente de cobrança"],
        ["WhatsApp", whatsAppInstanceLabel(currentSetup?.instance?.name ?? selectedInstance, currentSetup?.instance?.provider, currentSetup?.instance?.phoneNumber)],
        ["Pipeline", currentSetup?.pipeline?.name ?? "Pipeline de cobrança"],
        ["Régua", currentSetup?.funnel?.name ?? "Régua de cobrança"],
      ].map(([label, value]) => <div key={label} className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--color-surface-1)] px-4 py-3"><p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--color-gray-500)]">{label}</p><p className="mt-1 truncate text-sm font-medium text-[var(--color-gray-900)]">{value}</p></div>)}
    </div>
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-[var(--color-gray-500)]">O pipeline de cobrança pode ser compartilhado por outras fontes compatíveis.</p><Button type="button" variant="ghost" size="sm" onClick={() => setPipelineEditOpen((value) => !value)} disabled={busy !== null}><Settings2 />{pipelineEditOpen ? "Fechar" : "Alterar pipeline"}</Button></div>
    {pipelineEditOpen ? <div className="mt-3 flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-4 sm:flex-row sm:items-end"><div className="min-w-0 flex-1 space-y-2"><Label>Pipeline de cobrança</Label><Select value={selectedPipelineId} onValueChange={setSelectedPipelineId}><SelectTrigger><SelectValue placeholder="Selecione um pipeline" /></SelectTrigger><SelectContent>{pipelines.filter((pipeline) => pipeline.is_active && (pipeline.classifier_key === "crm_collection" || pipeline.name.toLowerCase().includes("cobrança") || pipeline.name.toLowerCase().includes("cobranca"))).map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}</SelectContent></Select></div><div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={() => changePipeline()} disabled={!selectedPipelineId || busy !== null}>{busy === `pipeline-${source.id}` ? <Loader2 className="animate-spin" /> : null}Salvar</Button><Button type="button" size="sm" onClick={() => changePipeline(true)} disabled={busy !== null}><Plus />Novo</Button></div></div> : null}

    </> : null}
    {mode === "overview" ? <div className="mt-6 flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-5 sm:flex-row sm:items-center sm:justify-between"><div><h5 className="font-semibold text-[var(--color-gray-900)]">Mensagens da régua</h5><p className="mt-1 text-sm text-[var(--color-gray-500)]">{messages.length === 0 ? "Nenhuma mensagem configurada." : `${messages.length} ${messages.length === 1 ? "mensagem configurada" : "mensagens configuradas"}.`}</p></div><Button type="button" className="shadow-primary" onClick={onOpenMessages} disabled={busy !== null}><Settings2 />Configurar mensagens</Button></div> : null}
      {mode === "messages" ? <div className="mt-0">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
          <Card className="border-[var(--border-default)] bg-[var(--color-surface-1)] p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h5 className="font-semibold text-[var(--color-gray-900)]">Mensagens</h5><p className="mt-1 text-xs text-[var(--color-gray-500)]">Crie e organize os envios desta régua.</p></div><Button type="button" size="sm" variant="outline" onClick={() => { setSelectedMessageId(null); setDraft(emptyDraft()); }} disabled={busy !== null}><Plus />Nova</Button></div><div className="mt-5 space-y-2">{messages.length === 0 ? <p className="rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] p-4 text-sm text-[var(--color-gray-500)]">Nenhuma mensagem criada ainda.</p> : messages.map((message) => { const state = messageStatus(message); return <button key={message.id} type="button" onClick={() => selectMessage(message)} className={`flex w-full items-center justify-between gap-3 rounded-[var(--radius-lg)] border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:shadow-focus ${selectedMessageId === message.id ? "border-[var(--color-primary-400)] bg-[var(--color-primary-50)]" : "border-[var(--border-default)] bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)]"}`}><span className="min-w-0 truncate text-sm font-medium text-[var(--color-gray-900)]">{message.label || "Mensagem sem nome"}</span><span className={`shrink-0 text-xs font-medium ${state.className}`}>{state.label}</span></button>; })}</div></Card>
          <Card className="border-[var(--border-default)] bg-[var(--color-surface-1)] p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--color-gray-500)]">Editor</p><h5 className="mt-2 font-semibold text-[var(--color-gray-900)]">{draft.id ? "Editar mensagem" : "Nova mensagem"}</h5><p className="mt-1 text-xs text-[var(--color-gray-500)]">O momento do envio pertence à mensagem.</p></div>{draft.id ? <span className="text-xs font-medium text-[var(--color-gray-600)]">{selectedMessage?.is_active ? "Ativa" : "Rascunho"}</span> : null}</div>
            <div className="mt-5 space-y-4"><div className="space-y-2"><Label htmlFor={`message-label-${source.id}`}>Nome da mensagem</Label><Input id={`message-label-${source.id}`} value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Lembrete no vencimento" disabled={busy !== null} /></div>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]"><div className="space-y-2"><Label>Momento do envio</Label><Select value={draft.timingRelation} onValueChange={(value: CollectionTimingRelation) => setDraft((current) => ({ ...current, timingRelation: value, daysOffset: value === "on_due" ? 0 : current.daysOffset }))} disabled={busy !== null}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="before_due">Antes do vencimento</SelectItem><SelectItem value="on_due">No vencimento</SelectItem><SelectItem value="after_due">Após o vencimento</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor={`message-days-${source.id}`}>Dias</Label><Input id={`message-days-${source.id}`} type="number" min={0} value={draft.daysOffset} onChange={(event) => setDraft((current) => ({ ...current, daysOffset: Number(event.target.value) }))} disabled={busy !== null || draft.timingRelation === "on_due"} /></div></div>
              {isOfficialProvider ? <div className="space-y-3 rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><Label>Template de envio</Label><Button type="button" variant="ghost" size="sm" onClick={() => setShowCreateTemplate((value) => !value)} disabled={busy !== null}>{showCreateTemplate ? "Fechar" : "Criar template"}</Button></div><Select value={draft.templateId} onValueChange={selectTemplate} disabled={busy !== null || templatesLoading}><SelectTrigger><SelectValue placeholder={templatesLoading ? "Carregando templates..." : "Selecione um template aprovado"} /></SelectTrigger><SelectContent>{templates.map((template) => <SelectItem key={template.id || template.name} value={template.id || template.name}>{template.name} · {template.status}</SelectItem>)}</SelectContent></Select>{selectedTemplate ? <p className={`text-xs ${isApprovedTemplateStatus(selectedTemplate.status) ? "text-[var(--color-success-600)]" : "text-[var(--color-warning-600)]"}`}>{isApprovedTemplateStatus(selectedTemplate.status) ? "Aprovado e pronto para usar" : "Aguardando aprovação"}</p> : null}{templatesError ? <p className="text-xs text-[var(--color-error-600)]">{templatesError}</p> : null}{showCreateTemplate ? <div className="space-y-3 border-t border-[var(--border-subtle)] pt-3"><Input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Nome do template" /><Textarea value={templateBody} onChange={(event) => setTemplateBody(event.target.value)} className="min-h-24" placeholder="Olá {nome}, sua pendência é de {valor}." /><Input value={templateExample} onChange={(event) => setTemplateExample(event.target.value)} placeholder="Mariana,249.90,10/09/2026" /><Button type="button" size="sm" onClick={createTemplate} disabled={!templateName.trim() || !templateBody.trim() || busy !== null}>{busy === `template-${source.id}` ? <Loader2 className="animate-spin" /> : <Save />}Criar e usar</Button></div> : null}</div> : null}
              <div className="space-y-2"><Label htmlFor={`message-content-${source.id}`}>Mensagem</Label><Textarea id={`message-content-${source.id}`} className="min-h-36 resize-y" value={draft.messageTemplate} onChange={(event) => setDraft((current) => ({ ...current, messageTemplate: event.target.value }))} placeholder="Escreva a mensagem que será enviada..." disabled={busy !== null || (isOfficialProvider && Boolean(selectedTemplate))} /><div className="flex flex-wrap gap-2 text-xs text-[var(--color-gray-500)]"><span className="rounded-full bg-[var(--color-surface-2)] px-2 py-1">nome</span><span className="rounded-full bg-[var(--color-surface-2)] px-2 py-1">valor</span><span className="rounded-full bg-[var(--color-surface-2)] px-2 py-1">vencimento</span></div></div>
              <div className="flex flex-wrap gap-2 border-t border-[var(--border-subtle)] pt-4"><Button type="button" variant="outline" disabled={!draft.messageTemplate.trim() || busy !== null} onClick={saveMessage}>{busy === `message-${source.id}` ? <Loader2 className="animate-spin" /> : <Save />}Salvar mensagem</Button>{isActive ? <Button type="button" variant="outline" disabled={busy !== null} onClick={pause}>{busy === `sending-pause-${source.id}` ? <Loader2 className="animate-spin" /> : <Pause />}Pausar envios</Button> : <Button type="button" className="shadow-primary" disabled={!draft.messageTemplate.trim() || source.status !== "active" || busy !== null || templatePending || (isOfficialProvider && (!selectedTemplate || !isApprovedTemplateStatus(selectedTemplate.status)))} onClick={activate}>{busy === `activate-${source.id}` ? <Loader2 className="animate-spin" /> : <Play />}Ativar {currentSetup?.agent?.is_active ? "envios" : "agente e envios"}</Button>}</div>
            </div>
          </Card>
        </div>
    </div> : null}
  </div>;
}
