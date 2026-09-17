import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Edit3, Loader2, MapPin, Plus, Search, Store, X } from "lucide-react";
import { toast } from "sonner";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CompanyMultiSelect } from "@/components/agents/CompanyMultiSelect";
import { useCompanies } from "@/hooks/useCompanies";
import {
  deactivateStoreLocatorStore,
  listStoreLocatorStores,
  saveStoreLocatorStore,
  updateAgentTool,
  type AgentTool,
  type StoreHours,
  type StoreLocatorStore,
  type StoreLocatorStoreInput,
} from "@/services/agentToolsService";

type StoreLocatorConfigPanelProps = {
  agentId: string;
  tool: AgentTool;
  onClose: () => void;
  onChanged: () => void;
};

type StoreFormState = StoreLocatorStoreInput;

const DAYS = [
  { key: "monday", label: "Segunda" },
  { key: "tuesday", label: "Terça" },
  { key: "wednesday", label: "Quarta" },
  { key: "thursday", label: "Quinta" },
  { key: "friday", label: "Sexta" },
  { key: "saturday", label: "Sábado" },
  { key: "sunday", label: "Domingo" },
] as const;

function emptyForm(): StoreFormState {
  return {
    displayName: "",
    addressLine: "",
    addressNumber: "",
    addressComplement: "",
    neighborhood: "",
    city: "",
    state: "",
    postalCode: "",
    phone: "",
    weeklyHours: {},
    hoursExceptions: [],
    hoursNotes: "",
    isActive: true,
  };
}

function storeToForm(store: StoreLocatorStore): StoreFormState {
  return {
    id: store.id,
    displayName: store.displayName,
    addressLine: store.addressLine,
    addressNumber: store.addressNumber,
    addressComplement: store.addressComplement,
    neighborhood: store.neighborhood,
    city: store.city,
    state: store.state,
    postalCode: store.postalCode,
    phone: store.phone,
    weeklyHours: store.weeklyHours,
    hoursExceptions: store.hoursExceptions,
    hoursNotes: store.hoursNotes,
    isActive: store.isActive,
  };
}

function formatPostalCode(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

function statusCopy(store: StoreLocatorStore) {
  if (!store.isActive) return "Inativa";
  if (store.geocodeStatus === "ready") return "Disponível para a IA";
  if (store.geocodeStatus === "needs_review") return "Revisar localização";
  if (store.geocodeStatus === "failed") return "Falha na localização";
  return "Localização pendente";
}

function statusDotClass(store: StoreLocatorStore) {
  if (!store.isActive) return "bg-[var(--color-gray-400)]";
  if (store.geocodeStatus === "ready") return "bg-[var(--color-success-500)]";
  if (store.geocodeStatus === "failed") return "bg-[var(--color-danger-500)]";
  return "bg-[var(--color-warning-500)]";
}

function hoursSummary(hours: StoreHours) {
  const configured = DAYS.filter((day) => (hours[day.key]?.length ?? 0) > 0);
  if (configured.length === 0) return "Horários não informados";
  return configured
    .map((day) => {
      const period = hours[day.key][0];
      return `${day.label.slice(0, 3)} ${period.opensAt}–${period.closesAt}`;
    })
    .join(" · ");
}

export function StoreLocatorConfigPanel({ agentId, tool, onClose, onChanged }: StoreLocatorConfigPanelProps) {
  const [mode, setMode] = useState<"list" | "form">("list");
  const [stores, setStores] = useState<StoreLocatorStore[]>([]);
  const [form, setForm] = useState<StoreFormState>(() => emptyForm());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive" | "pending">("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);

  const { companies, loading: companiesLoading } = useCompanies();
  const [allowedCompanyIds, setAllowedCompanyIds] = useState<string[]>(
    () => (Array.isArray(tool.config.allowedCompanyIds) ? (tool.config.allowedCompanyIds as string[]) : []),
  );
  const [companiesDirty, setCompaniesDirty] = useState(false);
  const [savingCompanies, setSavingCompanies] = useState(false);

  async function saveAllowedCompanies() {
    setSavingCompanies(true);
    try {
      await updateAgentTool(agentId, "store_locator", {
        config: { ...tool.config, allowedCompanyIds },
      });
      setCompaniesDirty(false);
      onChanged();
      toast.success("Empresas atualizadas");
    } catch (error) {
      toast.error("Nao foi possivel salvar as empresas", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSavingCompanies(false);
    }
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    listStoreLocatorStores(agentId)
      .then((result) => {
        if (active) setStores(result);
      })
      .catch((error: unknown) => {
        if (!active) return;
        toast.error("Não foi possível carregar as filiais", {
          description: error instanceof Error ? error.message : undefined,
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [agentId]);

  const visibleStores = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return stores.filter((store) => {
      const matchesQuery = !query || [store.displayName, store.neighborhood, store.city]
        .some((value) => value.toLocaleLowerCase("pt-BR").includes(query));
      const matchesStatus = status === "all"
        || (status === "active" && store.isActive)
        || (status === "inactive" && !store.isActive)
        || (status === "pending" && store.geocodeStatus !== "ready");
      return matchesQuery && matchesStatus;
    });
  }, [search, status, stores]);

  function startCreate() {
    setForm(emptyForm());
    setMode("form");
  }

  function startEdit(store: StoreLocatorStore) {
    setForm(storeToForm(store));
    setMode("form");
  }

  function updateField<Key extends keyof StoreFormState>(key: Key, value: StoreFormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateDay(day: string, enabled: boolean, field?: "opensAt" | "closesAt", value?: string) {
    setForm((current) => {
      const hours = { ...(current.weeklyHours ?? {}) };
      if (!enabled) {
        delete hours[day];
      } else {
        const existing = hours[day]?.[0] ?? { opensAt: "09:00", closesAt: "18:00" };
        hours[day] = [{ ...existing, ...(field ? { [field]: value ?? "" } : {}) }];
      }
      return { ...current, weeklyHours: hours };
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = await saveStoreLocatorStore(agentId, {
        ...form,
        postalCode: form.postalCode.replace(/\D/g, ""),
        state: form.state.trim().toUpperCase(),
      });
      setStores((current) => {
        const remaining = current.filter((store) => store.id !== saved.id);
        return [...remaining, saved].sort((left, right) => left.displayName.localeCompare(right.displayName, "pt-BR"));
      });
      setMode("list");
      onChanged();
      toast.success(form.id ? "Filial atualizada" : "Filial cadastrada", {
        description: saved.aiVisible
          ? "A localização foi validada e já pode ser usada pela IA."
          : "A filial foi salva, mas a localização precisa ser revisada.",
      });
    } catch (error) {
      toast.error("Não foi possível salvar a filial", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(store: StoreLocatorStore) {
    setSaving(true);
    try {
      const updated = await deactivateStoreLocatorStore(agentId, store.id);
      setStores((current) => current.map((item) => item.id === updated.id ? updated : item));
      setConfirmDeactivateId(null);
      onChanged();
      toast.success("Filial desativada");
    } catch (error) {
      toast.error("Não foi possível desativar a filial", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="min-w-0" aria-label="Configuração da Busca de filiais">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--border-default)] bg-[var(--color-surface-1)] pb-4">
        <div className="flex min-w-0 items-start gap-3">
          {mode === "form" ? (
            <button
              type="button"
              onClick={() => setMode("list")}
              className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] border border-[var(--border-input)] text-[var(--color-gray-600)] focus-visible:outline-none focus-visible:shadow-focus"
              aria-label="Voltar para filiais cadastradas"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-lg)] border border-[var(--cq-flow-icon-border)] bg-[var(--color-surface-1)] shadow-sm">
              <MapPin className="h-5 w-5 text-[var(--color-primary-600)]" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-[var(--color-gray-900)]">
              {mode === "list" ? "Filiais cadastradas" : form.id ? "Editar filial" : "Adicionar filial"}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-gray-500)]">
              {mode === "list"
                ? "Cadastre unidades exclusivas desta Tool e controle quais podem ser recomendadas."
                : "Alterações no endereço validam novamente a localização antes de liberar a filial para a IA."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] text-[var(--color-gray-500)] focus-visible:outline-none focus-visible:shadow-focus"
          aria-label="Fechar configuração"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      {mode === "list" ? (
        <div className="pt-4">
          <section
            className="rounded-[var(--radius-xl)] border border-[var(--border-default)] p-4"
            aria-label="Empresas visíveis para este agente"
          >
            <h3 className="text-sm font-semibold text-[var(--color-gray-900)]">Empresas que este agente pode citar</h3>
            <p className="mt-1 text-xs text-[var(--color-gray-500)]">
              Controla quais empresas cadastradas (agenda, preços e dados de contato) este agente pode ver e oferecer.
              Sem nenhuma selecionada, o agente não enxerga nenhuma empresa.
            </p>
            <div className="mt-3 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <CompanyMultiSelect
                companies={companies
                  .filter((company) => company.isActive)
                  .map((company) => ({ id: company.id, name: company.name, cnpj: company.cnpj, city: company.city, state: company.state }))}
                loading={companiesLoading}
                disabled={savingCompanies}
                selectedIds={allowedCompanyIds}
                onChange={(ids) => {
                  setAllowedCompanyIds(ids);
                  setCompaniesDirty(true);
                }}
              />
              <button
                type="button"
                disabled={!companiesDirty || savingCompanies}
                onClick={() => void saveAllowedCompanies()}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary-500)] px-4 text-sm font-semibold text-white shadow-sm transition-[background-color,box-shadow] hover:bg-[var(--color-primary-600)] focus-visible:outline-none focus-visible:shadow-focus active:shadow-inset disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingCompanies ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                Salvar empresas
              </button>
            </div>
          </section>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Buscar filial</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-gray-400)]" aria-hidden="true" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nome, bairro ou cidade"
                className="pl-10"
              />
            </label>
            <label>
              <span className="sr-only">Filtrar filiais</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as typeof status)}
                className="input h-10 min-w-40 px-3 text-sm"
              >
                <option value="all">Todas</option>
                <option value="active">Ativas</option>
                <option value="inactive">Inativas</option>
                <option value="pending">Pendentes</option>
              </select>
            </label>
            <button
              type="button"
              onClick={startCreate}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary-500)] px-4 text-sm font-semibold text-white shadow-sm transition-[background-color,box-shadow] hover:bg-[var(--color-primary-600)] focus-visible:outline-none focus-visible:shadow-focus active:shadow-inset"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Adicionar filial
            </button>
          </div>

          {loading ? (
            <div className="flex min-h-48 items-center justify-center text-sm text-[var(--color-gray-500)]" aria-live="polite">
              <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Carregando filiais
            </div>
          ) : visibleStores.length === 0 ? (
            <div className="mt-4 rounded-[var(--radius-xl)] border border-dashed border-[var(--border-default)] bg-[var(--color-bg-subtle)] p-8 text-center">
              <Store className="mx-auto h-6 w-6 text-[var(--color-gray-400)]" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold text-[var(--color-gray-800)]">Nenhuma filial encontrada</p>
              <p className="mt-1 text-xs text-[var(--color-gray-500)]">Ajuste os filtros ou cadastre a primeira filial desta Tool.</p>
            </div>
          ) : (
            <Accordion type="single" collapsible className="mt-4 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-1)] shadow-sm">
              {visibleStores.map((store) => (
                <AccordionItem key={store.id} value={store.id} className="[content-visibility:auto] border-[var(--border-default)] last:border-b-0">
                  <AccordionTrigger className="px-4 py-3 text-left hover:no-underline focus-visible:outline-none focus-visible:shadow-focus">
                    <span className="flex min-w-0 items-center gap-3 pr-3">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass(store)}`} aria-hidden="true" />
                      <span className="min-w-0">
                        <strong className="block truncate text-sm font-semibold text-[var(--color-gray-900)]">{store.displayName}</strong>
                        <span className="mt-0.5 block truncate text-xs font-normal text-[var(--color-gray-500)]">
                          {store.neighborhood} · {store.city}/{store.state} · {statusCopy(store)}
                        </span>
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-4">
                    <div className="grid gap-3 rounded-[var(--radius-lg)] bg-[var(--color-bg-subtle)] p-4 text-sm text-[var(--color-gray-700)] sm:grid-cols-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-gray-500)]">Endereço</p>
                        <p className="mt-1">{store.addressLine}{store.addressNumber ? `, ${store.addressNumber}` : ""}{store.addressComplement ? ` · ${store.addressComplement}` : ""}</p>
                        <p>{store.neighborhood} · {store.city}/{store.state} · CEP {formatPostalCode(store.postalCode)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-gray-500)]">Contato e horários</p>
                        <p className="mt-1">{store.phone || "Telefone não informado"}</p>
                        <p className="mt-1 text-xs leading-relaxed">{hoursSummary(store.weeklyHours)}</p>
                        {store.hoursNotes ? <p className="mt-1 text-xs">{store.hoursNotes}</p> : null}
                      </div>
                      <div className="sm:col-span-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-gray-500)]">Validação da localização</p>
                        <p className="mt-1">{statusCopy(store)}{store.geocodeAccuracy ? ` · ${store.geocodeAccuracy}` : ""}</p>
                        {store.geocodeError ? <p className="mt-1 text-xs text-[var(--color-danger-600)]">{store.geocodeError}</p> : null}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                      {confirmDeactivateId === store.id ? (
                        <>
                          <span className="mr-auto text-xs text-[var(--color-gray-600)]">Desativar esta filial sem apagar o histórico?</span>
                          <button type="button" onClick={() => setConfirmDeactivateId(null)} className="h-9 rounded-[var(--radius-md)] px-3 text-xs font-semibold text-[var(--color-gray-600)] focus-visible:outline-none focus-visible:shadow-focus">Cancelar</button>
                          <button type="button" disabled={saving} onClick={() => void deactivate(store)} className="h-9 rounded-[var(--radius-md)] border border-[var(--color-danger-300)] px-3 text-xs font-semibold text-[var(--color-danger-700)] focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-60">Confirmar desativação</button>
                        </>
                      ) : (
                        <>
                          {store.isActive ? <button type="button" onClick={() => setConfirmDeactivateId(store.id)} className="h-9 rounded-[var(--radius-md)] px-3 text-xs font-semibold text-[var(--color-gray-600)] focus-visible:outline-none focus-visible:shadow-focus">Desativar</button> : null}
                          <button type="button" onClick={() => startEdit(store)} className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-input)] px-3 text-xs font-semibold text-[var(--color-gray-700)] shadow-sm focus-visible:outline-none focus-visible:shadow-focus">
                            <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                            Editar
                          </button>
                        </>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-5 pt-5">
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-3 text-sm font-semibold text-[var(--color-gray-900)]">Identificação e endereço</legend>
            <label className="grid gap-1.5 sm:col-span-2"><span className="text-xs font-medium text-[var(--color-gray-700)]">Nome da filial</span><Input required value={form.displayName} onChange={(event) => updateField("displayName", event.target.value)} /></label>
            <label className="grid gap-1.5"><span className="text-xs font-medium text-[var(--color-gray-700)]">Endereço</span><Input required value={form.addressLine} onChange={(event) => updateField("addressLine", event.target.value)} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1.5"><span className="text-xs font-medium text-[var(--color-gray-700)]">Número</span><Input value={form.addressNumber ?? ""} onChange={(event) => updateField("addressNumber", event.target.value)} /></label>
              <label className="grid gap-1.5"><span className="text-xs font-medium text-[var(--color-gray-700)]">Complemento</span><Input value={form.addressComplement ?? ""} onChange={(event) => updateField("addressComplement", event.target.value)} /></label>
            </div>
            <label className="grid gap-1.5"><span className="text-xs font-medium text-[var(--color-gray-700)]">Bairro</span><Input required value={form.neighborhood} onChange={(event) => updateField("neighborhood", event.target.value)} /></label>
            <label className="grid gap-1.5"><span className="text-xs font-medium text-[var(--color-gray-700)]">Cidade</span><Input required value={form.city} onChange={(event) => updateField("city", event.target.value)} /></label>
            <div className="grid grid-cols-[100px_1fr] gap-3">
              <label className="grid gap-1.5"><span className="text-xs font-medium text-[var(--color-gray-700)]">UF</span><Input required maxLength={2} value={form.state} onChange={(event) => updateField("state", event.target.value.toUpperCase())} /></label>
              <label className="grid gap-1.5"><span className="text-xs font-medium text-[var(--color-gray-700)]">CEP</span><Input required inputMode="numeric" value={formatPostalCode(form.postalCode)} onChange={(event) => updateField("postalCode", event.target.value)} /></label>
            </div>
            <label className="grid gap-1.5"><span className="text-xs font-medium text-[var(--color-gray-700)]">Telefone</span><Input value={form.phone ?? ""} onChange={(event) => updateField("phone", event.target.value)} /></label>
            <label className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--border-default)] px-4 py-3">
              <span><strong className="block text-sm font-medium text-[var(--color-gray-800)]">Filial ativa</strong><span className="mt-0.5 block text-xs text-[var(--color-gray-500)]">A IA só utiliza filiais ativas com localização validada.</span></span>
              <Switch checked={form.isActive !== false} onCheckedChange={(checked) => updateField("isActive", checked)} aria-label="Filial ativa" />
            </label>
          </fieldset>

          <fieldset>
            <legend className="mb-3 text-sm font-semibold text-[var(--color-gray-900)]">Horários de atendimento</legend>
            <div className="grid gap-2 rounded-[var(--radius-xl)] border border-[var(--border-default)] p-3">
              {DAYS.map((day) => {
                const period = form.weeklyHours?.[day.key]?.[0];
                const enabled = Boolean(period);
                return (
                  <div key={day.key} className="grid items-center gap-2 border-b border-[var(--border-default)] py-2 last:border-b-0 sm:grid-cols-[120px_1fr]">
                    <label className="flex items-center gap-2 text-sm text-[var(--color-gray-700)]">
                      <input type="checkbox" checked={enabled} onChange={(event) => updateDay(day.key, event.target.checked)} className="h-4 w-4 accent-[var(--color-primary-500)]" />
                      {day.label}
                    </label>
                    {enabled ? (
                      <div className="flex items-center gap-2">
                        <Input type="time" aria-label={`Abertura ${day.label}`} value={period.opensAt} onChange={(event) => updateDay(day.key, true, "opensAt", event.target.value)} className="h-9" />
                        <span className="text-xs text-[var(--color-gray-500)]">até</span>
                        <Input type="time" aria-label={`Fechamento ${day.label}`} value={period.closesAt} onChange={(event) => updateDay(day.key, true, "closesAt", event.target.value)} className="h-9" />
                      </div>
                    ) : <span className="text-xs text-[var(--color-gray-400)]">Fechada</span>}
                  </div>
                );
              })}
            </div>
            <label className="mt-3 grid gap-1.5"><span className="text-xs font-medium text-[var(--color-gray-700)]">Exceções e observações</span><Textarea value={form.hoursNotes ?? ""} onChange={(event) => updateField("hoursNotes", event.target.value)} placeholder="Feriados, horários especiais ou observações úteis" /></label>
          </fieldset>

          <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--border-default)] bg-[var(--color-surface-1)] py-4">
            <button type="button" onClick={() => setMode("list")} className="h-10 rounded-[var(--radius-md)] px-4 text-sm font-semibold text-[var(--color-gray-600)] focus-visible:outline-none focus-visible:shadow-focus">Cancelar</button>
            <button type="submit" disabled={saving} className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary-500)] px-5 text-sm font-semibold text-white shadow-sm transition-[background-color,box-shadow] hover:bg-[var(--color-primary-600)] focus-visible:outline-none focus-visible:shadow-focus active:shadow-inset disabled:cursor-not-allowed disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              Salvar filial
            </button>
          </footer>
        </form>
      )}
    </section>
  );
}
