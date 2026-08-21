import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Building2, Loader2, MessageCircle, Pencil, Plus, Route, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  deactivateForwardingDestination,
  getForwardingSetup,
  saveForwardingDestination,
  type ForwardingDestination,
  type ForwardingSetup,
} from "@/services/agentToolsService";

type DestinationMode = "external_notification" | "internal_company" | "agent";

type ForwardingConfigPanelProps = {
  agentId: string;
  onClose: () => void;
  onChanged: () => void;
};

const EMPTY_SETUP: ForwardingSetup = {
  destinations: [],
  companies: [],
  sellers: [],
  memberships: [],
  agents: [],
};

function normalizedPhoneDigits(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length <= 11 ? `55${digits}` : digits;
}

function destinationKey(mode: DestinationMode, targetId: string) {
  const prefix = mode === "internal_company" ? "empresa" : mode === "agent" ? "agente" : "externo";
  return `${prefix}-${mode === "external_notification" ? normalizedPhoneDigits(targetId) : targetId}`;
}

export function ForwardingConfigPanel({ agentId, onClose, onChanged }: ForwardingConfigPanelProps) {
  const [setup, setSetup] = useState<ForwardingSetup>(EMPTY_SETUP);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"destinations" | "form">("destinations");
  const [mode, setMode] = useState<DestinationMode>("internal_company");
  const [empresaId, setEmpresaId] = useState("");
  const [targetAgentId, setTargetAgentId] = useState("");
  const [targetPhone, setTargetPhone] = useState("");
  const [sellerIds, setSellerIds] = useState<string[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [editingDestinationKey, setEditingDestinationKey] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const nextSetup = await getForwardingSetup(agentId);
      setSetup(nextSetup);
      if (!nextSetup.destinations.some((destination) => destination.is_active)) {
        setActiveTab("form");
      }
    } catch (error) {
      toast.error("Nao foi possivel carregar o encaminhamento", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sellerIdsForCompany = useMemo(() => new Set(
    setup.memberships
      .filter((membership) => membership.empresa_id === empresaId)
      .map((membership) => membership.crm_user_id),
  ), [empresaId, setup.memberships]);

  const availableSellers = useMemo(
    () => setup.sellers.filter((seller) => sellerIdsForCompany.has(seller.id)),
    [sellerIdsForCompany, setup.sellers],
  );

  const companiesById = useMemo(
    () => new Map(setup.companies.map((company) => [company.id, company])),
    [setup.companies],
  );
  const agentsById = useMemo(
    () => new Map(setup.agents.map((agent) => [agent.id, agent])),
    [setup.agents],
  );
  const activeTargetAgents = useMemo(
    () => setup.agents.filter((agent) => agent.is_active),
    [setup.agents],
  );

  const resetForm = () => {
    setMode("internal_company");
    setEmpresaId("");
    setTargetAgentId("");
    setTargetPhone("");
    setSellerIds([]);
    setDisplayName("");
    setInstruction("");
    setEditingDestinationKey("");
  };

  const selectCompany = (companyId: string) => {
    const company = companiesById.get(companyId);
    const relatedSellerIds = setup.memberships
      .filter((membership) => membership.empresa_id === companyId)
      .map((membership) => membership.crm_user_id);
    setEmpresaId(companyId);
    setSellerIds(relatedSellerIds);
    setDisplayName(company ? `Equipe ${company.name}` : "");
    setInstruction(company
      ? `Encaminhe para esta equipe quando o atendimento estiver relacionado a ${company.name} e o cliente precisar de um vendedor.`
      : "");
  };

  const selectAgent = useCallback((selectedAgentId: string) => {
    const target = agentsById.get(selectedAgentId);
    if (!target?.is_active) return;
    setTargetAgentId(selectedAgentId);
    setDisplayName(target ? `IA ${target.name}` : "");
    setInstruction(target
      ? `Encaminhe para ${target.name} quando o assunto pertencer ao fluxo especializado desta IA.`
      : "");
  }, [agentsById]);

  useEffect(() => {
    if (mode !== "agent" || targetAgentId || activeTargetAgents.length !== 1) return;
    selectAgent(activeTargetAgents[0].id);
  }, [activeTargetAgents, mode, selectAgent, targetAgentId]);

  const editDestination = (destination: ForwardingDestination) => {
    if (destination.destination_key === "legacy-handoff") return;
    setMode(destination.mode);
    setEmpresaId(destination.empresa_id ?? "");
    setTargetAgentId(destination.target_agent_id ?? "");
    setTargetPhone(destination.target_phone ?? "");
    setSellerIds(destination.seller_ids ?? []);
    setDisplayName(destination.display_name);
    setInstruction(destination.context_instruction);
    setEditingDestinationKey(destination.destination_key);
    setActiveTab("form");
  };

  const openNewDestination = () => {
    resetForm();
    setActiveTab("form");
  };

  const submit = async () => {
    const targetId = mode === "internal_company" ? empresaId : mode === "agent" ? targetAgentId : targetPhone;
    if (!targetId || !displayName.trim() || !instruction.trim()) {
      toast.error("Preencha o destino e a orientacao de encaminhamento.");
      return;
    }
    const phoneDigits = targetPhone.replace(/\D/g, "");
    if (mode === "external_notification" && (phoneDigits.length < 10 || phoneDigits.length > 15)) {
      toast.error("Informe um numero de WhatsApp valido, com DDD.");
      return;
    }
    if (mode === "internal_company" && sellerIds.length === 0) {
      toast.error("Selecione ao menos um vendedor relacionado a empresa.");
      return;
    }

    try {
      setSaving(true);
      await saveForwardingDestination(agentId, {
        destinationKey: editingDestinationKey || destinationKey(mode, targetId),
        displayName: displayName.trim(),
        mode,
        targetPhone: mode === "external_notification" ? targetPhone.trim() : null,
        empresaId: mode === "internal_company" ? empresaId : null,
        sellerIds: mode === "internal_company" ? sellerIds : [],
        targetAgentId: mode === "agent" ? targetAgentId : null,
        contextInstruction: instruction.trim(),
      });
      toast.success("Destino de encaminhamento salvo");
      resetForm();
      await load();
      setActiveTab("destinations");
      onChanged();
    } catch (error) {
      toast.error("Nao foi possivel salvar o destino", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (destinationId: string) => {
    try {
      await deactivateForwardingDestination(agentId, destinationId);
      toast.success("Destino desativado");
      await load();
      onChanged();
    } catch (error) {
      toast.error("Nao foi possivel desativar o destino", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <section className="rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
            <Route className="h-4 w-4 text-[var(--color-accent)]" />
            Destinos de encaminhamento
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--color-text-secondary)]">
            A IA escolhe o destino pelo contexto. O encaminhamento externo apenas notifica o WhatsApp informado e mantem a IA ativa na conversa.
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Fechar configuracao">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {loading ? (
        <div className="flex min-h-28 items-center justify-center text-sm text-[var(--color-text-secondary)]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Carregando destinos...
        </div>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as "destinations" | "form")}
          className="mt-4"
        >
          <TabsList className="h-auto w-full justify-start gap-1 bg-[var(--color-bg-subtle)] p-1">
            <TabsTrigger value="destinations" className="gap-2">
              <Route className="h-4 w-4" />
              Destinos configurados
            </TabsTrigger>
            <TabsTrigger value="form" className="gap-2" onClick={() => {
              if (activeTab !== "form") resetForm();
            }}>
              <Plus className="h-4 w-4" />
              Novo destino
            </TabsTrigger>
          </TabsList>

          <TabsContent value="form" className="mt-5">
          <div className="max-w-xl space-y-4">
            <div className="space-y-2">
              <Label>Encaminhar para</Label>
              <Select
                value={mode}
                onValueChange={(value) => {
                  resetForm();
                  setMode(value as DestinationMode);
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal_company">Equipe de uma empresa</SelectItem>
                  <SelectItem value="agent">Outra IA interna</SelectItem>
                  <SelectItem value="external_notification">Encaminhamento externo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {mode === "internal_company" ? (
              <>
                <div className="space-y-2">
                  <Label>Empresa</Label>
                  <Select value={empresaId} onValueChange={selectCompany}>
                    <SelectTrigger><SelectValue placeholder="Selecione a empresa" /></SelectTrigger>
                    <SelectContent>
                      {setup.companies.map((company) => (
                        <SelectItem key={company.id} value={company.id}>
                          {company.name} - {company.city}/{company.state}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {empresaId ? (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2"><Users className="h-3.5 w-3.5" /> Vendedores da fila</Label>
                    {availableSellers.length === 0 ? (
                      <p className="rounded-[var(--radius-lg)] bg-[var(--color-warning-bg)] p-3 text-xs text-[var(--color-warning-600)]">
                        Esta empresa ainda nao possui vendedores vinculados. Configure o acesso na gestao de usuarios do Admin.
                      </p>
                    ) : (
                      <div className="grid gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] p-3">
                        {availableSellers.map((seller) => (
                          <label key={seller.id} className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text-primary)]">
                            <Checkbox
                              checked={sellerIds.includes(seller.id)}
                              onCheckedChange={(checked) => setSellerIds((current) => checked
                                ? [...new Set([...current, seller.id])]
                                : current.filter((id) => id !== seller.id))}
                            />
                            <span>{seller.name || seller.email}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </>
            ) : mode === "agent" ? (
              <div className="space-y-2">
                <Label>IA principal e instancia de destino</Label>
                <Select value={targetAgentId} onValueChange={selectAgent}>
                  <SelectTrigger><SelectValue placeholder="Selecione a IA" /></SelectTrigger>
                  <SelectContent>
                    {setup.agents.map((target) => (
                      <SelectItem key={target.id} value={target.id} disabled={!target.is_active}>
                        {target.name} - {target.instance_name}{target.is_active ? "" : " (Pausada)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {setup.agents.length === 0 ? (
                  <p className="rounded-[var(--radius-lg)] bg-[var(--color-warning-bg)] p-3 text-xs leading-relaxed text-[var(--color-warning-600)]">
                    Nenhuma outra IA principal foi criada nesta conta. Crie uma IA principal para usar este encaminhamento.
                  </p>
                ) : activeTargetAgents.length === 0 ? (
                  <p className="rounded-[var(--radius-lg)] bg-[var(--color-warning-bg)] p-3 text-xs leading-relaxed text-[var(--color-warning-600)]">
                    As IAs principais disponíveis estão pausadas. Ative a IA de destino na tela de Agentes para que ela possa assumir a conversa.
                  </p>
                ) : activeTargetAgents.length === 1 ? (
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    A única IA principal ativa foi selecionada automaticamente para assumir o atendimento.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="forwarding-phone">WhatsApp de destino</Label>
                <Input
                  id="forwarding-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={targetPhone}
                  onChange={(event) => setTargetPhone(event.target.value)}
                  placeholder="Ex.: 55 11 99999-9999"
                />
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Este contato recebera uma notificacao; a IA continuara atendendo o lead.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="forwarding-name">Nome do destino</Label>
              <Input id="forwarding-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="forwarding-instruction">Quando usar</Label>
              <Textarea
                id="forwarding-instruction"
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                className="min-h-24 bg-[var(--color-surface-1)]"
                placeholder="Descreva em linguagem simples quando este destino deve receber o atendimento."
              />
            </div>

            <Button type="button" onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar destino
            </Button>
          </div>
          </TabsContent>

          <TabsContent value="destinations" className="mt-5">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">Destinos ativos</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Edite equipes e IAs sem abrir o formulário ao lado da lista.</p>
              </div>
              <Button type="button" size="sm" onClick={openNewDestination}>
                <Plus className="h-4 w-4" />
                Novo destino
              </Button>
            </div>
            {setup.destinations.filter((destination) => destination.is_active).length === 0 ? (
              <div className="rounded-[var(--radius-xl)] border border-dashed border-[var(--color-border-medium)] p-5 text-center">
                <Route className="mx-auto h-5 w-5 text-[var(--color-text-muted)]" />
                <p className="mt-2 text-sm font-medium text-[var(--color-text-primary)]">Nenhum destino ativo</p>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Cadastre uma empresa, outra IA ou um WhatsApp externo para liberar a Tool.</p>
              </div>
            ) : setup.destinations.filter((destination) => destination.is_active).map((destination) => {
              const company = destination.empresa_id ? companiesById.get(destination.empresa_id) : null;
              const target = destination.target_agent_id ? agentsById.get(destination.target_agent_id) : null;
              const isLegacyHandoff = destination.destination_key === "legacy-handoff";
              const DestinationIcon = destination.mode === "internal_company"
                ? Building2
                : destination.mode === "external_notification"
                  ? MessageCircle
                  : Bot;
              return (
                <article key={destination.id} className="rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] p-3">
                  <div className="flex items-start gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--color-primary-50)] text-[var(--color-primary-700)]">
                      <DestinationIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{destination.display_name}</p>
                      <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                        {company
                          ? `${company.name} - ${destination.seller_ids.length} vendedor(es)`
                          : target
                            ? `${target.name} - ${target.instance_name}`
                            : destination.mode === "external_notification"
                              ? `${isLegacyHandoff ? "WhatsApp externo legado" : "WhatsApp externo"} - ${destination.target_phone ?? "numero indisponivel"}`
                              : "Destino indisponivel"}
                      </p>
                    </div>
                    {!isLegacyHandoff ? (
                      <Button type="button" variant="ghost" size="icon" onClick={() => editDestination(destination)} aria-label="Editar destino">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                    <Button type="button" variant="ghost" size="icon" onClick={() => void deactivate(destination.id)} aria-label="Desativar destino">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
          </TabsContent>
        </Tabs>
      )}
    </section>
  );
}
