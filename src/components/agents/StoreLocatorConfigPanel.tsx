import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, Edit3, Folder, FolderPlus, Loader2, Pencil, Plus, Search, Store, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCompanies } from "@/hooks/useCompanies";
import { formatCnpj } from "@/lib/cnpj";
import {
  createStoreLocatorFolder,
  deleteStoreLocatorFolder,
  listStoreLocatorFolders,
  listStoreLocatorStores,
  renameStoreLocatorFolder,
  saveStoreLocatorStore,
  setStoreLocatorStoreFolder,
  setStoreLocatorStoreVisibility,
  updateAgentTool,
  type AgentTool,
  type StoreHours,
  type StoreLocatorFolder,
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

function emptyForm(folderId: string | null = null): StoreFormState {
  return {
    folderId,
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
    folderId: store.folderId,
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

function visibilityCopy(store: StoreLocatorStore) {
  if (!store.isActive) return "Inativa globalmente";
  if (!store.aiVisible) return statusCopy(store);
  return store.isVisibleForAgent ? "Disponível para esta IA" : "Oculta para esta IA";
}

function statusDotClass(store: StoreLocatorStore) {
  if (!store.isActive || !store.isVisibleForAgent) return "bg-[var(--color-gray-400)]";
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
  const [folders, setFolders] = useState<StoreLocatorFolder[]>([]);
  const [form, setForm] = useState<StoreFormState>(() => emptyForm());
  const [search, setSearch] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive" | "pending">("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmVisibilityId, setConfirmVisibilityId] = useState<string | null>(null);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderDraft, setFolderDraft] = useState("");
  const [editingFolder, setEditingFolder] = useState<StoreLocatorFolder | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<StoreLocatorFolder | null>(null);
  const [savingFolder, setSavingFolder] = useState(false);
  const [draggedStoreId, setDraggedStoreId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | "__root__" | null>(null);

  const { companies, loading: companiesLoading } = useCompanies();
  const [allowedCompanyIds, setAllowedCompanyIds] = useState<string[]>(
    () => (Array.isArray(tool.config.allowedCompanyIds) ? (tool.config.allowedCompanyIds as string[]) : []),
  );
  const [companiesDirty, setCompaniesDirty] = useState(false);
  const [savingCompanies, setSavingCompanies] = useState(false);

  const activeCompanies = useMemo(
    () => companies.filter((company) => company.isActive),
    [companies],
  );

  const visibleCompanies = useMemo(() => {
    const query = companySearch.trim().toLocaleLowerCase("pt-BR");
    if (!query) return activeCompanies;

    return activeCompanies.filter((company) =>
      [company.name, company.cnpj, company.city, company.state]
        .some((value) => value.toLocaleLowerCase("pt-BR").includes(query)),
    );
  }, [activeCompanies, companySearch]);

  const selectedCompanyCount = activeCompanies.filter((company) => allowedCompanyIds.includes(company.id)).length;
  const companySummary = companiesLoading
    ? "Carregando empresas"
    : activeCompanies.length === 0
      ? "Nenhuma empresa cadastrada"
      : selectedCompanyCount === 0
        ? "Nenhuma empresa selecionada"
        : `${selectedCompanyCount} ${selectedCompanyCount === 1 ? "empresa selecionada" : "empresas selecionadas"}`;

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
    Promise.all([listStoreLocatorStores(agentId), listStoreLocatorFolders(agentId)])
      .then(([storeResult, folderResult]) => {
        if (!active) return;
        setStores(storeResult);
        setFolders(folderResult);
      })
      .catch((error: unknown) => {
        if (!active) return;
        toast.error("Não foi possível carregar filiais e pastas", {
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

  function startCreate(folderId: string | null = null) {
    setForm(emptyForm(folderId));
    setMode("form");
  }

  function openCreateFolder() {
    setEditingFolder(null);
    setFolderDraft("");
    setFolderDialogOpen(true);
  }

  function openRenameFolder(folder: StoreLocatorFolder) {
    setEditingFolder(folder);
    setFolderDraft(folder.name);
    setFolderDialogOpen(true);
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
        description: !saved.aiVisible
          ? "A filial foi salva, mas a localização precisa ser revisada."
          : !saved.isVisibleForAgent
            ? "A filial foi atualizada, mas continua oculta para esta IA."
            : "A localização foi validada e já pode ser usada por esta IA.",
      });
    } catch (error) {
      toast.error("Não foi possível salvar a filial", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  async function updateVisibility(store: StoreLocatorStore, isVisible: boolean) {
    setSaving(true);
    try {
      const updated = await setStoreLocatorStoreVisibility(agentId, store.id, isVisible);
      setStores((current) => current.map((item) => item.id === updated.id ? updated : item));
      setConfirmVisibilityId(null);
      onChanged();
      toast.success(isVisible ? "Filial reativada para esta IA" : "Filial desativada para esta IA", {
        description: isVisible
          ? "As outras IAs não foram alteradas."
          : "A filial continua disponível para as outras IAs.",
      });
    } catch (error) {
      toast.error(isVisible ? "Não foi possível reativar a filial" : "Não foi possível desativar a filial para esta IA", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  async function submitFolder(event: React.FormEvent) {
    event.preventDefault();
    const name = folderDraft.trim();
    if (!name) return;
    setSavingFolder(true);
    try {
      const saved = editingFolder
        ? await renameStoreLocatorFolder(agentId, editingFolder.id, name)
        : await createStoreLocatorFolder(agentId, name);
      setFolders((current) => {
        const remaining = current.filter((folder) => folder.id !== saved.id);
        return [...remaining, saved].sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
      });
      setFolderDialogOpen(false);
      toast.success(editingFolder ? "Pasta renomeada" : "Pasta criada");
    } catch (error) {
      toast.error(editingFolder ? "Não foi possível renomear a pasta" : "Não foi possível criar a pasta", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSavingFolder(false);
    }
  }

  async function removeFolder() {
    if (!folderToDelete) return;
    setSavingFolder(true);
    try {
      await deleteStoreLocatorFolder(agentId, folderToDelete.id);
      setFolders((current) => current.filter((folder) => folder.id !== folderToDelete.id));
      setStores((current) => current.map((store) => (
        store.folderId === folderToDelete.id ? { ...store, folderId: null } : store
      )));
      setFolderToDelete(null);
      toast.success("Pasta excluída", { description: "As filiais voltaram para Sem pasta." });
    } catch (error) {
      toast.error("Não foi possível excluir a pasta", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSavingFolder(false);
    }
  }

  async function moveStore(storeId: string, folderId: string | null) {
    const store = stores.find((item) => item.id === storeId);
    if (!store || store.folderId === folderId) return;
    try {
      const updated = await setStoreLocatorStoreFolder(agentId, storeId, folderId);
      setStores((current) => current.map((item) => item.id === updated.id ? updated : item));
      toast.success(folderId ? "Filial adicionada à pasta" : "Filial removida da pasta");
    } catch (error) {
      toast.error("Não foi possível mover a filial", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setDraggedStoreId(null);
      setDragOverFolderId(null);
    }
  }

  function startDragging(event: React.DragEvent, store: StoreLocatorStore) {
    setDraggedStoreId(store.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", store.id);
  }

  function dropStore(event: React.DragEvent, folderId: string | null) {
    event.preventDefault();
    const storeId = event.dataTransfer.getData("text/plain") || draggedStoreId;
    setDragOverFolderId(null);
    if (storeId) void moveStore(storeId, folderId);
  }

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    stores.forEach((store) => {
      if (store.folderId) counts.set(store.folderId, (counts.get(store.folderId) ?? 0) + 1);
    });
    return counts;
  }, [stores]);

  const ungroupedStores = useMemo(
    () => visibleStores.filter((store) => !store.folderId),
    [visibleStores],
  );

  function renderStoreItems(items: StoreLocatorStore[]) {
    return (
      <Accordion type="single" collapsible className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--color-surface-1)]">
        {items.map((store) => (
          <AccordionItem
            key={store.id}
            value={store.id}
            draggable
            onDragStart={(event) => startDragging(event, store)}
            onDragEnd={() => { setDraggedStoreId(null); setDragOverFolderId(null); }}
            className={`[content-visibility:auto] border-[var(--border-default)] last:border-b-0 ${draggedStoreId === store.id ? "opacity-50" : ""}`}
          >
            <AccordionTrigger className="cursor-grab px-4 py-3 text-left hover:no-underline focus-visible:outline-none focus-visible:shadow-focus active:cursor-grabbing">
              <span className="flex min-w-0 items-center gap-3 pr-3">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass(store)}`} aria-hidden="true" />
                <span className="min-w-0">
                  <strong className="block truncate text-sm font-semibold text-[var(--color-gray-900)]">{store.displayName}</strong>
                  <span className="mt-0.5 block truncate text-xs font-normal text-[var(--color-gray-500)]">
                    {store.neighborhood} · {store.city}/{store.state} · {visibilityCopy(store)}
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
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                {confirmVisibilityId === store.id ? (
                  <>
                    <span className="mr-auto text-xs text-[var(--color-gray-600)]">Ocultar somente para esta IA? As outras IAs continuarão vendo a filial.</span>
                    <button type="button" onClick={() => setConfirmVisibilityId(null)} className="h-9 rounded-[var(--radius-md)] px-3 text-xs font-semibold text-[var(--color-gray-600)] focus-visible:outline-none focus-visible:shadow-focus">Cancelar</button>
                    <button type="button" disabled={saving} onClick={() => void updateVisibility(store, false)} className="h-9 rounded-[var(--radius-md)] border border-[var(--color-danger-300)] px-3 text-xs font-semibold text-[var(--color-danger-700)] focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-60">Confirmar desativação para esta IA</button>
                  </>
                ) : (
                  <>
                    {store.isActive && store.aiVisible ? (
                      store.isVisibleForAgent ? (
                        <button type="button" onClick={() => setConfirmVisibilityId(store.id)} className="h-9 rounded-[var(--radius-md)] px-3 text-xs font-semibold text-[var(--color-gray-600)] focus-visible:outline-none focus-visible:shadow-focus">Desativar para esta IA</button>
                      ) : (
                        <button type="button" disabled={saving} onClick={() => void updateVisibility(store, true)} className="h-9 rounded-[var(--radius-md)] px-3 text-xs font-semibold text-[var(--color-primary-600)] focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-60">Reativar para esta IA</button>
                      )
                    ) : null}
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
    );
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
          ) : null}
          <div className="min-w-0">
            {mode === "form" ? (
              <>
                <h2 className="text-sm font-semibold text-[var(--color-gray-900)]">
                  {form.id ? "Editar filial" : "Adicionar filial"}
                </h2>
                <p className="mt-1 text-xs text-[var(--color-gray-500)]">
                  Alterações no endereço validam novamente a localização antes de liberar a filial para a IA.
                </p>
              </>
            ) : null}
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
          <Accordion
            type="single"
            collapsible
            className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-1)] shadow-sm"
          >
            <AccordionItem value="companies" className="border-0">
              <AccordionTrigger
                className="px-4 py-3 text-left hover:no-underline focus-visible:outline-none focus-visible:shadow-focus"
                aria-label="Expandir empresas com acesso da IA"
              >
                <span className="flex min-w-0 items-center gap-3 pr-3">
                  <Building2 className="h-4 w-4 shrink-0 text-[var(--color-primary-500)]" aria-hidden="true" />
                  <span className="min-w-0">
                    <strong className="block truncate text-sm font-semibold text-[var(--color-gray-900)]">Empresas com acesso da IA</strong>
                    <span className="mt-0.5 block truncate text-xs font-normal text-[var(--color-gray-500)]">{companySummary}</span>
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-4">
                <div className="space-y-3 border-t border-[var(--border-default)] pt-3">
                  {activeCompanies.length > 0 ? (
                    <label className="relative block">
                      <span className="sr-only">Buscar empresa</span>
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-gray-400)]" aria-hidden="true" />
                      <Input
                        value={companySearch}
                        onChange={(event) => setCompanySearch(event.target.value)}
                        placeholder="Buscar empresa ou CNPJ"
                        className="pl-10"
                      />
                    </label>
                  ) : null}

                  {companiesLoading ? (
                    <div className="flex items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-bg-subtle)] px-3 py-6 text-sm text-[var(--color-gray-500)]" aria-live="polite">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      Carregando empresas
                    </div>
                  ) : activeCompanies.length === 0 ? (
                    <div className="rounded-[var(--radius-lg)] bg-[var(--color-bg-subtle)] px-3 py-5 text-center text-sm text-[var(--color-gray-500)]">
                      Nenhuma empresa cadastrada.
                    </div>
                  ) : visibleCompanies.length === 0 ? (
                    <div className="rounded-[var(--radius-lg)] bg-[var(--color-bg-subtle)] px-3 py-5 text-center text-sm text-[var(--color-gray-500)]">
                      Nenhuma empresa encontrada.
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)]">
                      {visibleCompanies.map((company) => {
                        const checked = allowedCompanyIds.includes(company.id);

                        return (
                          <label
                            key={company.id}
                            className="flex cursor-pointer items-center gap-3 border-b border-[var(--border-default)] px-3 py-2.5 last:border-b-0 hover:bg-[var(--color-surface-2)]"
                          >
                            <Checkbox
                              checked={checked}
                              disabled={savingCompanies}
                              onCheckedChange={(value) => {
                                const nextIds = value === true
                                  ? [...new Set([...allowedCompanyIds, company.id])]
                                  : allowedCompanyIds.filter((id) => id !== company.id);
                                setAllowedCompanyIds(nextIds);
                                setCompaniesDirty(true);
                              }}
                              aria-label={`${checked ? "Remover" : "Adicionar"} ${company.name}`}
                            />
                            <Building2 className="h-4 w-4 shrink-0 text-[var(--color-gray-500)]" aria-hidden="true" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-[var(--color-gray-800)]">{company.name}</span>
                              <span className="mt-0.5 block truncate font-mono text-[11px] text-[var(--color-gray-500)]">
                                {company.city}/{company.state} · {formatCnpj(company.cnpj)}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={!companiesDirty || savingCompanies}
                      onClick={() => void saveAllowedCompanies()}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary-500)] px-4 text-sm font-semibold text-white shadow-primary transition-[background-color,box-shadow] hover:bg-[var(--color-primary-600)] hover:shadow-primary-hover focus-visible:outline-none focus-visible:shadow-focus active:shadow-inset disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {savingCompanies ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                      Salvar empresas
                    </button>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

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
              onClick={openCreateFolder}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-input)] text-[var(--color-primary-600)] shadow-sm transition-[background-color,box-shadow] hover:bg-[var(--color-primary-50)] focus-visible:outline-none focus-visible:shadow-focus active:shadow-inset"
              aria-label="Criar pasta"
              title="Criar pasta"
            >
              <FolderPlus className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => startCreate()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary-500)] px-4 text-sm font-semibold text-white shadow-sm transition-[background-color,box-shadow] hover:bg-[var(--color-primary-600)] focus-visible:outline-none focus-visible:shadow-focus active:shadow-inset"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Adicionar filial
            </button>
          </div>

          {loading ? (
            <div className="flex min-h-48 items-center justify-center text-sm text-[var(--color-gray-500)]" aria-live="polite">
              <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Carregando filiais e pastas
            </div>
          ) : visibleStores.length === 0 ? (
            <div className="mt-4 rounded-[var(--radius-xl)] border border-dashed border-[var(--border-default)] bg-[var(--color-bg-subtle)] p-8 text-center">
              <Store className="mx-auto h-6 w-6 text-[var(--color-gray-400)]" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold text-[var(--color-gray-800)]">Nenhuma filial encontrada</p>
              <p className="mt-1 text-xs text-[var(--color-gray-500)]">Ajuste os filtros ou cadastre a primeira filial desta Tool.</p>
            </div>
          ) : (
            <Accordion type="multiple" className="mt-4 space-y-2">
              {folders.map((folder) => {
                const folderStores = visibleStores.filter((store) => store.folderId === folder.id);
                const total = folderCounts.get(folder.id) ?? 0;
                const isDropTarget = dragOverFolderId === folder.id;
                return (
                  <AccordionItem
                    key={folder.id}
                    value={folder.id}
                    onDragOver={(event) => { event.preventDefault(); setDragOverFolderId(folder.id); }}
                    onDragLeave={() => setDragOverFolderId((current) => current === folder.id ? null : current)}
                    onDrop={(event) => dropStore(event, folder.id)}
                    className={`overflow-hidden rounded-[var(--radius-xl)] border bg-[var(--color-surface-1)] shadow-sm transition-[border-color,background-color,box-shadow] ${isDropTarget ? "border-[var(--color-primary-400)] bg-[var(--color-primary-50)] shadow-md" : "border-[var(--border-default)]"}`}
                  >
                    <div className="flex items-center gap-2">
                      <AccordionTrigger className="min-w-0 flex-1 px-4 py-4 text-left hover:no-underline focus-visible:outline-none focus-visible:shadow-focus">
                        <span className="flex min-w-0 items-center gap-3 pr-3">
                          <Folder className="h-5 w-5 shrink-0 text-[var(--color-primary-500)]" aria-hidden="true" />
                          <span className="min-w-0">
                            <strong className="block truncate text-sm font-semibold text-[var(--color-gray-900)]">{folder.name}</strong>
                            <span className="mt-0.5 block truncate text-xs font-normal text-[var(--color-gray-500)]">{total} {total === 1 ? "filial" : "filiais"}</span>
                          </span>
                        </span>
                      </AccordionTrigger>
                    </div>
                    <AccordionContent className="px-3 pb-3 sm:px-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-default)] pb-3">
                        <span className="text-xs text-[var(--color-gray-500)]">Arraste uma filial para esta pasta ou adicione diretamente.</span>
                        <span className="flex items-center gap-1">
                          <button type="button" onClick={() => startCreate(folder.id)} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 text-xs font-semibold text-[var(--color-primary-600)] hover:bg-[var(--color-primary-50)] focus-visible:outline-none focus-visible:shadow-focus" aria-label={`Adicionar filial em ${folder.name}`}>
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                            Adicionar filial
                          </button>
                          <button type="button" onClick={() => openRenameFolder(folder)} className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--color-gray-500)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-gray-800)] focus-visible:outline-none focus-visible:shadow-focus" aria-label={`Renomear pasta ${folder.name}`} title="Renomear pasta">
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => setFolderToDelete(folder)} className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--color-gray-500)] hover:bg-[var(--color-error-50)] hover:text-[var(--color-error-600)] focus-visible:outline-none focus-visible:shadow-focus" aria-label={`Excluir pasta ${folder.name}`} title="Excluir pasta">
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </span>
                      </div>
                      {folderStores.length > 0 ? renderStoreItems(folderStores) : (
                        <div className={`rounded-[var(--radius-lg)] border border-dashed p-6 text-center text-xs ${isDropTarget ? "border-[var(--color-primary-400)] text-[var(--color-primary-700)]" : "border-[var(--border-default)] text-[var(--color-gray-500)]"}`}>
                          Solte uma filial aqui para adicioná-la à pasta.
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
              <AccordionItem
                value="__root__"
                onDragOver={(event) => { event.preventDefault(); setDragOverFolderId("__root__"); }}
                onDragLeave={() => setDragOverFolderId((current) => current === "__root__" ? null : current)}
                onDrop={(event) => dropStore(event, null)}
                className={`overflow-hidden rounded-[var(--radius-xl)] border bg-[var(--color-surface-1)] shadow-sm transition-[border-color,background-color,box-shadow] ${dragOverFolderId === "__root__" ? "border-[var(--color-primary-400)] bg-[var(--color-primary-50)] shadow-md" : "border-[var(--border-default)]"}`}
              >
                <AccordionTrigger className="px-4 py-4 text-left hover:no-underline focus-visible:outline-none focus-visible:shadow-focus">
                  <span className="flex min-w-0 items-center gap-3 pr-3">
                    <Folder className="h-5 w-5 shrink-0 text-[var(--color-gray-400)]" aria-hidden="true" />
                    <span className="min-w-0">
                      <strong className="block truncate text-sm font-semibold text-[var(--color-gray-900)]">Sem pasta</strong>
                      <span className="mt-0.5 block truncate text-xs font-normal text-[var(--color-gray-500)]">{ungroupedStores.length} {ungroupedStores.length === 1 ? "filial" : "filiais"} nesta visualização</span>
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="px-3 pb-3 sm:px-4">
                  {ungroupedStores.length > 0 ? renderStoreItems(ungroupedStores) : (
                    <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-default)] p-6 text-center text-xs text-[var(--color-gray-500)]">
                      Nenhuma filial sem pasta corresponde aos filtros atuais.
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
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
            <label className="grid gap-1.5 sm:col-span-2">
              <span className="text-xs font-medium text-[var(--color-gray-700)]">Pasta</span>
              <select
                value={form.folderId ?? ""}
                onChange={(event) => updateField("folderId", event.target.value || null)}
                className="input h-10 px-3 text-sm"
              >
                <option value="">Sem pasta</option>
                {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
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
            <label className="mt-4 flex items-center justify-between gap-3">
              <span><strong className="block text-sm font-medium text-[var(--color-gray-800)]">Filial ativa globalmente</strong><span className="mt-0.5 block text-xs text-[var(--color-gray-500)]">Desliga esta filial para todas as IAs. Para ocultar somente desta IA, use “Desativar para esta IA” na lista.</span></span>
              <Switch checked={form.isActive !== false} onCheckedChange={(checked) => updateField("isActive", checked)} aria-label="Filial ativa globalmente" />
            </label>
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

      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingFolder ? "Renomear pasta" : "Criar pasta"}</DialogTitle>
            <DialogDescription>
              {editingFolder ? "Atualize o nome usado para organizar as filiais." : "Crie uma pasta compartilhada para organizar as filiais desta conta."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitFolder} className="grid gap-4">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-[var(--color-gray-700)]">Nome da pasta</span>
              <Input autoFocus required maxLength={100} value={folderDraft} onChange={(event) => setFolderDraft(event.target.value)} placeholder="Ex.: Atacadão dos Óculos" />
            </label>
            <DialogFooter>
              <button type="button" onClick={() => setFolderDialogOpen(false)} disabled={savingFolder} className="h-10 rounded-[var(--radius-md)] px-4 text-sm font-semibold text-[var(--color-gray-600)] focus-visible:outline-none focus-visible:shadow-focus">Cancelar</button>
              <button type="submit" disabled={savingFolder || !folderDraft.trim()} className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary-500)] px-4 text-sm font-semibold text-white shadow-primary transition-[background-color,box-shadow] hover:bg-[var(--color-primary-600)] focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-60">
                {savingFolder ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <FolderPlus className="h-4 w-4" aria-hidden="true" />}
                {editingFolder ? "Salvar nome" : "Criar pasta"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(folderToDelete)} onOpenChange={(open) => { if (!open) setFolderToDelete(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir pasta?</DialogTitle>
            <DialogDescription>
              {folderToDelete ? `A pasta “${folderToDelete.name}” será excluída. As filiais continuarão cadastradas e voltarão para Sem pasta.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" onClick={() => setFolderToDelete(null)} disabled={savingFolder} className="h-10 rounded-[var(--radius-md)] px-4 text-sm font-semibold text-[var(--color-gray-600)] focus-visible:outline-none focus-visible:shadow-focus">Cancelar</button>
            <button type="button" onClick={() => void removeFolder()} disabled={savingFolder} className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-error-300)] px-4 text-sm font-semibold text-[var(--color-error-600)] hover:bg-[var(--color-error-50)] focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-60">
              {savingFolder ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
              Excluir pasta
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
