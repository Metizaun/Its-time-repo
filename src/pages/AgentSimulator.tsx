import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Bot, Check, ChevronRight, CircleAlert, FileAudio, Image as ImageIcon,
  Loader2, Minus, Play, RefreshCcw, RotateCcw, Send, ShieldCheck, Wrench, X,
} from "lucide-react";
import { toast } from "sonner";

import { ChatInput } from "@/components/chat/ChatInput";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useIsSupportStaff } from "@/hooks/useIsSupportStaff";
import {
  getSimulatorAgentConfig, listSimulatorAccounts, listSimulatorAgents,
  sendSimulatorReport, simulateAgentTurn,
} from "@/services/agentSimulatorService";
import type { ChatComposerPayload } from "@/types/chat";
import type { SimulatorMessage, SimulatorTest, SimulatorTestStatus } from "@/types/agentSimulator";
import { cn } from "@/lib/utils";

const SCENARIOS = [
  { key: "new-lead", name: "Novo lead interessado", prompt: "Olá! Vi o trabalho de vocês e gostaria de entender como funciona." },
  { key: "pricing", name: "Dúvida sobre preço", prompt: "Quanto custa o serviço? Existe alguma condição ou pacote?" },
  { key: "objection", name: "Objeção", prompt: "Achei interessante, mas preciso pensar melhor antes de decidir." },
  { key: "human", name: "Atendimento humano", prompt: "Prefiro falar com uma pessoa antes de continuar, pode me ajudar?" },
  { key: "outside-scope", name: "Fora do escopo", prompt: "Vocês também resolvem uma questão que não tem relação com o serviço principal?" },
  { key: "scheduling", name: "Agendamento", prompt: "Quero agendar um horário para esta semana." },
  { key: "difficult", name: "Cliente confuso ou agressivo", prompt: "Ninguém me explica direito! Estou cansado de receber respostas vagas." },
] as const;

function newId() {
  return crypto.randomUUID();
}

function statusLabel(status: SimulatorTestStatus) {
  return status === "passed" ? "Aprovado" : status === "failed" ? "Reprovado" : "Não testado";
}

function StatusButton({ status, onChange }: { status: SimulatorTestStatus; onChange: (value: SimulatorTestStatus) => void }) {
  const next = status === "not_tested" ? "passed" : status === "passed" ? "failed" : "not_tested";
  const Icon = status === "passed" ? Check : status === "failed" ? X : Minus;
  return <button type="button" onClick={() => onChange(next)} className={cn(
    "flex h-8 w-8 items-center justify-center rounded-full border transition-colors focus-ring",
    status === "passed" && "border-[var(--color-success-500)] bg-[var(--color-success-50)] text-[var(--color-success-700)]",
    status === "failed" && "border-[var(--color-error-500)] bg-[var(--color-error-50)] text-[var(--color-error-700)]",
    status === "not_tested" && "border-[var(--border-default)] bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]",
  )} aria-label={`Status: ${statusLabel(status)}. Clique para marcar como ${statusLabel(next).toLowerCase()}`} title={`Status: ${statusLabel(status)} · clique para alterar`}><Icon className="h-4 w-4" strokeWidth={status === "not_tested" ? 2.5 : 2.75} /></button>;
}

export default function AgentSimulator() {
  const { isSupportStaff, loading: accessLoading } = useIsSupportStaff();
  const [accountId, setAccountId] = useState<number | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [scenarioKey, setScenarioKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<SimulatorMessage[]>([]);
  const [tests, setTests] = useState<SimulatorTest[]>([]);
  const [generalNote, setGeneralNote] = useState("");
  const transcriptRef = useRef<HTMLDivElement>(null);

  const accounts = useQuery({ queryKey: ["agent-simulator-accounts"], queryFn: listSimulatorAccounts, enabled: isSupportStaff });
  const agents = useQuery({ queryKey: ["agent-simulator-agents", accountId], queryFn: () => listSimulatorAgents(accountId!), enabled: isSupportStaff && accountId !== null });
  const config = useQuery({
    queryKey: ["agent-simulator-agent", accountId, agentId],
    queryFn: () => getSimulatorAgentConfig(accountId!, agentId!),
    enabled: isSupportStaff && accountId !== null && agentId !== null,
  });

  useEffect(() => {
    if (!accountId && accounts.data?.[0]) setAccountId(accounts.data[0].acesId);
  }, [accountId, accounts.data]);

  useEffect(() => {
    setAgentId(null);
    setMessages([]);
    setTests([]);
    setScenarioKey(null);
  }, [accountId]);

  useEffect(() => {
    if (!agentId && agents.data?.[0]) setAgentId(agents.data[0].id);
  }, [agentId, agents.data]);

  useEffect(() => {
    setMessages([]);
    setTests([]);
    setScenarioKey(null);
  }, [agentId]);

  const activeTools = useMemo(() => config.data?.tools ?? [], [config.data?.tools]);
  const selectedAccount = accounts.data?.find((account) => account.acesId === accountId) ?? null;
  const selectedAgent = config.data?.agent ?? agents.data?.find((agent) => agent.id === agentId) ?? null;
  const selectedScenario = SCENARIOS.find((scenario) => scenario.key === scenarioKey) ?? null;

  const visibleTests = useMemo(() => {
    const toolTests = activeTools.map((tool) => ({ id: `tool:${tool.id}`, kind: "tool" as const, name: tool.name }));
    const scenarioTests = selectedScenario ? [{ id: `scenario:${selectedScenario.key}`, kind: "scenario" as const, name: selectedScenario.name }] : [];
    return [...scenarioTests, ...toolTests].map((definition) => tests.find((test) => test.id === definition.id) ?? { ...definition, status: "not_tested" as const, note: "" });
  }, [activeTools, selectedScenario, tests]);

  const turn = useMutation({
    mutationFn: simulateAgentTurn,
    onSuccess: (response) => {
      setMessages((current) => [
        ...current,
        ...response.replyBlocks.map((content) => ({ id: newId(), role: "agent" as const, content })),
        ...(response.toolEvents.length ? [{ id: newId(), role: "agent" as const, content: "", toolEvents: response.toolEvents }] : []),
      ]);
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível simular a resposta."),
  });

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [messages.length, turn.isPending]);

  const report = useMutation({
    mutationFn: sendSimulatorReport,
    onSuccess: () => {
      toast.success("Avaliação enviada no chat interno para acompanhamento.");
      setGeneralNote("");
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível enviar a avaliação."),
  });

  const updateTest = (test: SimulatorTest, patch: Partial<SimulatorTest>) => {
    setTests((current) => {
      const next = { ...test, ...patch };
      return [...current.filter((item) => item.id !== test.id), next];
    });
  };

  const chooseScenario = (key: string) => {
    setScenarioKey(key);
    const scenario = SCENARIOS.find((item) => item.key === key);
    if (scenario && messages.length === 0) {
      setMessages([{ id: newId(), role: "lead", content: scenario.prompt }]);
    }
  };

  const restartConversation = () => setMessages([]);
  const newTest = () => {
    setMessages([]);
    setTests([]);
    setScenarioKey(null);
    setGeneralNote("");
  };

  const sendLeadMessage = async (payload: ChatComposerPayload) => {
    if (!accountId || !agentId) throw new Error("Escolha uma conta e um agente antes de iniciar.");
    const attachment = payload.attachment && (payload.attachment.kind === "image" || payload.attachment.kind === "audio") ? [{
      kind: payload.attachment.kind,
      fileName: payload.attachment.file.name,
      mimeType: payload.attachment.mimeType,
      size: payload.attachment.file.size,
    }] : [];
    const leadMessage: SimulatorMessage = {
      id: newId(), role: "lead", content: payload.content || "[Anexo de teste]", attachment: attachment[0] ?? null,
    };
    const nextMessages = [...messages, leadMessage];
    setMessages(nextMessages);
    await turn.mutateAsync({ acesId: accountId, agentId, scenarioKey, messages: nextMessages, attachments: attachment });
  };

  const submitReport = () => {
    if (!accountId || !selectedAccount || !selectedAgent) return;
    report.mutate({
      clientReportId: newId(), accountName: selectedAccount.name, targetAcesId: accountId,
      agentName: selectedAgent.name, tests: visibleTests, generalNote,
    });
  };

  if (accessLoading) return <div className="flex min-h-[40vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--color-primary-500)]" /></div>;
  if (!isSupportStaff) return <Navigate to="/" replace />;

  return <main className="space-y-5">
    <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-primary-600)]">Time interno</p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-bold text-[var(--color-gray-900)]"><Play className="h-7 w-7 text-[var(--color-primary-500)]" />Simulador de agentes</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--color-text-secondary)]">Teste agentes de qualquer conta sem criar leads, disparar mensagens ou guardar o histórico da conversa.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={restartConversation} disabled={!messages.length}><RotateCcw />Reiniciar conversa</Button>
        <Button type="button" variant="outline" onClick={newTest}><RefreshCcw />Novo teste</Button>
      </div>
    </header>

    <div className="grid gap-5 2xl:grid-cols-[17rem_minmax(0,1fr)_20rem]">
      <aside className="space-y-4">
        <Card className="border-[var(--border-default)] bg-[var(--color-surface-1)] p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-text-secondary)]">Alvo do teste</p>
          <div className="mt-3 space-y-3">
            <Select value={accountId ? String(accountId) : undefined} onValueChange={(value) => setAccountId(Number(value))}>
              <SelectTrigger aria-label="Selecionar conta"><SelectValue placeholder={accounts.isLoading ? "Carregando contas..." : "Selecionar conta"} /></SelectTrigger>
              <SelectContent>{(accounts.data ?? []).map((account) => <SelectItem key={account.acesId} value={String(account.acesId)}>{account.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={agentId ?? undefined} onValueChange={setAgentId} disabled={!accountId || agents.isLoading}>
              <SelectTrigger aria-label="Selecionar agente"><SelectValue placeholder={agents.isLoading ? "Carregando agentes..." : "Selecionar agente"} /></SelectTrigger>
              <SelectContent>{(agents.data ?? []).map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.name}{!agent.isActive ? " (inativo)" : ""}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </Card>

        <Card className="border-[var(--border-default)] bg-[var(--color-surface-1)] px-4 shadow-sm">
          <Accordion type="multiple" defaultValue={["scenarios", "tools"]}>
            <AccordionItem value="scenarios">
              <AccordionTrigger><span className="flex items-center gap-2"><CircleAlert className="h-4 w-4 text-[var(--color-primary-500)]" />Cenários</span></AccordionTrigger>
              <AccordionContent className="space-y-1">
                {SCENARIOS.map((scenario) => <button key={scenario.key} type="button" onClick={() => chooseScenario(scenario.key)} className={cn("flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-[var(--color-bg-subtle)] focus-ring", scenarioKey === scenario.key && "bg-[var(--color-primary-50)] text-[var(--color-primary-700)]")}><span>{scenario.name}</span><ChevronRight className="h-4 w-4" /></button>)}
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="tools" className="border-0">
              <AccordionTrigger><span className="flex items-center gap-2"><Wrench className="h-4 w-4 text-[var(--color-primary-500)]" />Ferramentas ativas</span></AccordionTrigger>
              <AccordionContent className="space-y-2">
                {!agentId ? <p className="text-xs text-[var(--color-text-secondary)]">Selecione um agente para conferir as ferramentas.</p> : activeTools.length === 0 && !config.isLoading ? <p className="text-xs text-[var(--color-text-secondary)]">Nenhuma ferramenta ativa e pronta.</p> : activeTools.map((tool) => <div key={tool.id} className="rounded-md border border-[var(--border-default)] p-2"><p className="text-sm font-medium">{tool.name}</p><p className="mt-1 text-xs text-[var(--color-text-secondary)]">{tool.description || tool.key}</p></div>)}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Card>
      </aside>

      <section className="flex h-[min(680px,calc(100vh-14rem))] min-h-[560px] max-h-[680px] min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--color-surface-1)] shadow-sm max-[767px]:h-[min(640px,calc(100vh-10rem))] max-[767px]:min-h-[480px]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] px-5 py-4">
          <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-primary-50)]"><Bot className="h-5 w-5 text-[var(--color-primary-600)]" /></div><div><p className="font-semibold text-[var(--color-gray-900)]">{selectedAgent?.name ?? "Escolha um agente"}</p><p className="text-xs text-[var(--color-text-secondary)]">{selectedScenario?.name ?? "Conversa livre"} · ambiente efêmero</p></div></div>
          <Badge variant="outline" className="gap-1 border-[var(--color-success-500)] text-[var(--color-success-700)]"><ShieldCheck className="h-3.5 w-3.5" />Sem ações reais</Badge>
        </div>
        <div ref={transcriptRef} role="log" aria-live="polite" aria-label="Histórico do simulador" className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-[var(--color-bg-subtle)] p-5">
          {!messages.length && <div className="flex h-full min-h-[380px] flex-col items-center justify-center text-center"><Bot className="h-10 w-10 text-[var(--color-primary-400)]" /><h2 className="mt-4 font-semibold text-[var(--color-gray-900)]">Pronto para simular</h2><p className="mt-2 max-w-sm text-sm text-[var(--color-text-secondary)]">Escolha um cenário ou escreva como um lead. O histórico existe apenas nesta aba.</p></div>}
          {messages.map((message) => <div key={message.id} className={cn("flex", message.role === "lead" ? "justify-end" : "justify-start")}>
            {message.content && <div className={cn("max-w-[86%] rounded-xl px-4 py-3 text-sm leading-6", message.role === "lead" ? "bg-[var(--color-primary-500)] text-white" : "border border-[var(--border-default)] bg-[var(--color-surface-1)] text-[var(--color-gray-800)]")}><p>{message.content}</p>{message.attachment && <p className={cn("mt-2 flex items-center gap-1 text-xs", message.role === "lead" ? "text-white/80" : "text-[var(--color-text-secondary)]")}>{message.attachment.kind === "image" ? <ImageIcon className="h-3.5 w-3.5" /> : <FileAudio className="h-3.5 w-3.5" />}{message.attachment.fileName}</p>}</div>}
            {message.toolEvents?.length ? <div className="w-full space-y-2">{message.toolEvents.map((event) => <div key={`${message.id}-${event.key}`} className="rounded-lg border border-[var(--color-primary-200)] bg-[var(--color-primary-50)] p-3"><div className="flex items-center gap-2 text-sm font-medium text-[var(--color-primary-700)]"><Wrench className="h-4 w-4" />{event.name}<Badge variant="outline" className="ml-auto text-xs">{event.mode === "read_only" ? "consulta segura" : "simulado"}</Badge></div><p className="mt-1 text-xs text-[var(--color-text-secondary)]">{event.detail}</p></div>)}</div> : null}
          </div>)}
          {turn.isPending && <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"><Loader2 className="h-4 w-4 animate-spin" />O agente está respondendo...</div>}
        </div>
        <div className="border-t border-[var(--border-default)] p-3"><ChatInput onSend={sendLeadMessage} disabled={!accountId || !agentId || turn.isPending} allowedAttachmentKinds={["image", "audio"]} /></div>
      </section>

      <aside className="space-y-4">
        <Card className="border-[var(--border-default)] bg-[var(--color-surface-1)] p-4 shadow-sm">
          <div><p className="font-semibold text-[var(--color-gray-900)]">Checklist</p><p className="text-xs text-[var(--color-text-secondary)]">Clique no status para alternar entre não testado, aprovado e reprovado.</p></div>
          <div className="mt-4 space-y-3">{visibleTests.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">Selecione um cenário ou um agente com tools ativas.</p> : visibleTests.map((test) => <div key={test.id} className="rounded-lg border border-[var(--border-default)] p-3"><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-medium text-[var(--color-gray-900)]">{test.name}</p><p className="text-xs text-[var(--color-text-secondary)]">{test.kind === "tool" ? "Ferramenta" : "Cenário"}</p></div><StatusButton status={test.status} onChange={(status) => updateTest(test, { status })} /></div>{test.status === "failed" && <Textarea value={test.note} onChange={(event) => updateTest(test, { note: event.target.value })} className="mt-3 min-h-16 text-xs" placeholder="Descreva o erro encontrado" />}</div>)}</div>
          <div className="mt-5 border-t border-[var(--border-default)] pt-4">
            <p className="font-semibold text-[var(--color-gray-900)]">Registrar avaliação</p><p className="mt-1 text-xs text-[var(--color-text-secondary)]">Envia somente o resumo e os erros ao chat interno.</p>
            <Textarea value={generalNote} onChange={(event) => setGeneralNote(event.target.value)} className="mt-3 min-h-20 text-sm" placeholder="Observação opcional para o suporte" />
            <Button type="button" className="mt-3 w-full" onClick={submitReport} disabled={report.isPending || !selectedAgent || (!visibleTests.some((test) => test.status === "failed") && !generalNote.trim())}>{report.isPending ? <Loader2 className="animate-spin" /> : <Send />}Enviar avaliação</Button>
          </div>
        </Card>
      </aside>
    </div>
  </main>;
}
