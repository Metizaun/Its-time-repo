import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Banknote,
  Building2,
  CircleDollarSign,
  Gauge,
  Landmark,
  Plus,
  RefreshCcw,
  ShieldCheck,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { Navigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { KPICard } from "@/components/KPICard";
import { SectionLabel } from "@/components/dashboard/SectionLabel";
import { AccountRankingChart, FinancialSeriesChart } from "@/components/superadmin/FinancialCharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsStaff } from "@/hooks/useIsStaff";
import {
  deleteCrmBackend,
  getCrmBackend,
  patchCrmBackend,
  postCrmBackend,
} from "@/services/crmBackend";
import type {
  AdminAccount,
  AdminAccountDetail,
  AdminExchangeRate,
  AdminFinanceCatalog,
  AdminFixedCost,
  AdminOverview,
  AdminPlan,
  AdminRevenueEntry,
} from "@/types/superadmin";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number = (value: unknown) => Number(value ?? 0);
const moneyValue = (value: unknown) => money.format(number(value));
const monthInput = () => new Date().toISOString().slice(0, 7) + "-01";
const dateTimeInput = () => new Date().toISOString();

function Empty({ children }: { children: string }) {
  return <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-[var(--border-default)] text-sm text-[var(--color-gray-500)]">{children}</div>;
}

function StatusText({ status }: { status: string | null | undefined }) {
  const color = status === "blocked" || status === "canceled"
    ? "text-[var(--color-error-600)]"
    : status === "warned" || status === "exceeded" || status === "suspended"
      ? "text-[var(--color-warning-600)]"
      : "text-[var(--color-success-600)]";
  const labels: Record<string, string> = {
    active: "Ativo", suspended: "Suspenso", canceled: "Cancelado",
    ok: "Dentro do teto", warned: "Em atenção", exceeded: "Teto ultrapassado", blocked: "IA bloqueada",
  };
  return <span className={`text-sm font-semibold ${color}`}>{labels[status ?? ""] ?? "Sem contrato"}</span>;
}

function LoadingPage() {
  return <div className="space-y-5"><Skeleton className="h-20 w-full" /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((key) => <Skeleton key={key} className="h-36" />)}</div><Skeleton className="h-96" /></div>;
}

function OverviewScreen({ data }: { data: AdminOverview }) {
  const latestProvider = data.providers.reduce((total, item) => total + number(item.provider_cost_brl), 0);
  const latestBilled = data.providers.reduce((total, item) => total + number(item.billed_cost_brl), 0);
  const spreadPct = latestProvider > 0 ? ((latestBilled - latestProvider) / latestProvider) * 100 : 0;
  return <div className="space-y-6">
    <section>
      <SectionLabel>Indicadores do mês</SectionLabel>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KPICard title="MRR projetado" value={moneyValue(data.kpis.mrrBrl)} icon={TrendingUp} subtitle="Contratos ativos" />
        <KPICard title="Receita lançada" value={moneyValue(data.kpis.revenueBookedBrl)} icon={Banknote} subtitle={`${moneyValue(data.kpis.revenuePaidBrl)} pagos`} />
        <KPICard title="Consumo cobrado" value={moneyValue(data.kpis.billedConsumptionBrl)} icon={Gauge} subtitle="Dólar interno" />
        <KPICard title="Custo real de IA" value={moneyValue(data.kpis.providerCostBrl)} icon={CircleDollarSign} subtitle="Dólar de provider" />
        <KPICard title="Margem do cliente" value={moneyValue(data.kpis.clientMarginBrl)} icon={WalletCards} subtitle="Receita menos IA" />
        <KPICard title="Margem cambial" value={moneyValue(data.kpis.fxMarginBrl)} icon={Landmark} subtitle={`${spreadPct.toFixed(1)}% de spread`} />
        <KPICard title="Custos fixos" value={moneyValue(data.kpis.fixedCostBrl)} icon={Building2} subtitle="Competência atual" />
        <KPICard title="Resultado" value={moneyValue(data.kpis.resultBrl)} icon={ShieldCheck} subtitle={`${data.unratedCount} eventos aguardando rating`} />
      </div>
    </section>
    <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
      <FinancialSeriesChart data={data.series} />
      <AccountRankingChart data={data.ranking} />
    </div>
    <Card className="border-[var(--border-default)] bg-[var(--color-surface-1)] p-6 shadow-sm">
      <SectionLabel>Spread cambial</SectionLabel>
      <div className="grid gap-5 sm:grid-cols-3">
        <div><p className="text-sm text-[var(--color-gray-500)]">Consumo cobrado</p><p className="mt-1 font-mono text-2xl font-semibold">{moneyValue(latestBilled)}</p></div>
        <div><p className="text-sm text-[var(--color-gray-500)]">Custo de provider</p><p className="mt-1 font-mono text-2xl font-semibold">{moneyValue(latestProvider)}</p></div>
        <div><p className="text-sm text-[var(--color-gray-500)]">Margem cambial</p><p className="mt-1 font-mono text-2xl font-semibold text-[var(--color-primary-600)]">{moneyValue(latestBilled - latestProvider)}</p></div>
      </div>
    </Card>
  </div>;
}

function AccountsScreen({ accounts, onOpen }: { accounts: AdminAccount[]; onOpen: (acesId: number) => void }) {
  return <Card className="overflow-hidden border-[var(--border-default)] bg-[var(--color-surface-1)] shadow-sm">
    <div className="border-b border-[var(--border-default)] p-6"><SectionLabel>Portfólio</SectionLabel><h2 className="text-xl font-semibold">Contas e rentabilidade</h2><p className="mt-1 text-sm text-[var(--color-gray-500)]">Consumo, teto, custo e contrato em uma leitura.</p></div>
    <div className="overflow-x-auto p-4 sm:p-6">
      {accounts.length === 0 ? <Empty>Nenhuma conta cadastrada.</Empty> : <Table className="min-w-[1080px]">
        <TableHeader><TableRow><TableHead>Conta</TableHead><TableHead>Plano</TableHead><TableHead>Status</TableHead><TableHead className="min-w-52">Consumo do ciclo</TableHead><TableHead className="text-right">MRR</TableHead><TableHead className="text-right">Custo real</TableHead><TableHead className="text-right">Margem</TableHead><TableHead className="text-right">Instâncias</TableHead></TableRow></TableHeader>
        <TableBody>{accounts.map((account) => {
          const pct = Math.max(0, number(account.consumed_pct));
          const margin = number(account.revenue_brl || account.mrr_brl) - number(account.provider_cost_brl);
          return <TableRow key={account.aces_id} className="cursor-pointer" onClick={() => onOpen(account.aces_id)} tabIndex={0} role="button" aria-label={`Abrir detalhes da conta ${account.account_name}`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(account.aces_id); } }}>
            <TableCell><p className="font-medium">{account.account_name}</p><p className="text-xs text-[var(--color-gray-500)]">#{account.aces_id}{account.is_internal ? " · interna" : ""}</p></TableCell>
            <TableCell>{account.plan_name ?? "Sem plano"}</TableCell><TableCell><StatusText status={account.cycle_status ?? account.subscription_status} /></TableCell>
            <TableCell><div className="space-y-2"><div className="flex justify-between font-mono text-xs"><span>{moneyValue(account.effective_consumed_brl)}</span><span>{account.budget_brl === null ? "Sem teto" : moneyValue(account.budget_brl)}</span></div><Progress value={Math.min(pct, 100)} className="h-2" /><p className="text-right font-mono text-xs text-[var(--color-gray-500)]">{pct.toFixed(1)}%</p></div></TableCell>
            <TableCell className="text-right font-mono">{moneyValue(account.mrr_brl)}</TableCell><TableCell className="text-right font-mono">{moneyValue(account.provider_cost_brl)}</TableCell><TableCell className="text-right font-mono">{moneyValue(margin)}</TableCell><TableCell className="text-right font-mono">{account.instances_count ?? 0}</TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>}
    </div>
  </Card>;
}

function AccountDetailScreen({ detail, plans, onBack, onChanged }: { detail: AdminAccountDetail; plans: AdminPlan[]; onBack: () => void; onChanged: () => void }) {
  const account = detail.account;
  const subscription = detail.subscription;
  const [planId, setPlanId] = useState(subscription?.plan_id ?? plans[0]?.id ?? "");
  const [status, setStatus] = useState(subscription?.status ?? "active");
  const [budget, setBudget] = useState(subscription?.ai_budget_brl_override?.toString() ?? "");
  const [monthly, setMonthly] = useState(subscription?.mensalidade_brl_override?.toString() ?? "");
  const [enforcement, setEnforcement] = useState(subscription?.enforcement_enabled ?? false);
  const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => patchCrmBackend(`/api/admin/accounts/${account.aces_id}/subscription`, { planId, status, aiBudgetBrlOverride: budget === "" ? null : Number(budget), mensalidadeBrlOverride: monthly === "" ? null : Number(monthly), enforcementEnabled: enforcement }), onSuccess: () => { toast.success("Contrato atualizado"); onChanged(); }, onError: (error: Error) => toast.error(error.message) });
  const reset = useMutation({ mutationFn: () => postCrmBackend(`/api/admin/accounts/${account.aces_id}/reset-budget`, { reason }), onSuccess: () => { toast.success("Crédito de reset aplicado"); setReason(""); onChanged(); }, onError: (error: Error) => toast.error(error.message) });
  return <div className="space-y-6">
    <Button variant="ghost" onClick={onBack}><ArrowLeft />Voltar para contas</Button>
    <div><SectionLabel>Detalhe da conta</SectionLabel><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-3xl font-bold">{account.account_name}</h2><p className="mt-1 text-[var(--color-gray-500)]">Conta #{account.aces_id} · <StatusText status={account.cycle_status ?? account.subscription_status} /></p></div><p className="font-mono text-2xl font-semibold text-[var(--color-primary-600)]">{number(account.consumed_pct).toFixed(1)}%</p></div></div>
    <div className="grid gap-6 xl:grid-cols-[1fr_1.35fr]">
      <Card className="border-[var(--border-default)] bg-[var(--color-surface-1)] p-6 shadow-sm">
        <SectionLabel>Contrato</SectionLabel><div className="space-y-4">
          <div><Label htmlFor="contract-plan">Plano</Label><select id="contract-plan" value={planId} onChange={(event) => setPlanId(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></div>
          <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="contract-monthly">Mensalidade override</Label><Input id="contract-monthly" type="number" min="0" step="0.01" value={monthly} onChange={(event) => setMonthly(event.target.value)} className="mt-2" /></div><div><Label htmlFor="contract-budget">Teto de IA override</Label><Input id="contract-budget" type="number" min="0" step="0.01" value={budget} onChange={(event) => setBudget(event.target.value)} className="mt-2" /></div></div>
          <div><Label htmlFor="contract-status">Status</Label><select id="contract-status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="active">Ativo</option><option value="suspended">Suspenso</option><option value="canceled">Cancelado</option></select></div>
          <div className="flex items-center justify-between rounded-xl bg-[var(--color-bg-subtle)] p-4"><div><p className="font-medium">Enforcement</p><p className="text-sm text-[var(--color-gray-500)]">Bloquear a próxima chamada ao atingir o teto</p></div><Switch checked={enforcement} onCheckedChange={setEnforcement} /></div>
          <Button className="w-full" onClick={() => save.mutate()} disabled={!planId || save.isPending}>{save.isPending ? "Salvando..." : "Salvar contrato"}</Button>
        </div>
      </Card>
      <Card className="border-[var(--border-default)] bg-[var(--color-surface-1)] p-6 shadow-sm">
        <SectionLabel>Consumo por dimensão</SectionLabel>
        <div className="overflow-x-auto"><Table className="min-w-[700px]"><TableHeader><TableRow><TableHead>Feature</TableHead><TableHead>Provider / modelo</TableHead><TableHead>Instância</TableHead><TableHead className="text-right">Cobrado</TableHead><TableHead className="text-right">Real</TableHead></TableRow></TableHeader><TableBody>{detail.dimensions.slice(0, 20).map((item, index) => <TableRow key={`${item.competencia}-${item.feature_key}-${item.model}-${index}`}><TableCell>{item.feature_key}</TableCell><TableCell><p>{item.provider}</p><p className="text-xs text-[var(--color-gray-500)]">{item.model}</p></TableCell><TableCell>{item.instance_name ?? "—"}</TableCell><TableCell className="text-right font-mono">{moneyValue(item.billed_cost_brl)}</TableCell><TableCell className="text-right font-mono">{moneyValue(item.provider_cost_brl)}</TableCell></TableRow>)}</TableBody></Table></div>
      </Card>
    </div>
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="border-[var(--border-default)] bg-[var(--color-surface-1)] p-6 shadow-sm"><SectionLabel>Reset auditável</SectionLabel><p className="mb-4 text-sm text-[var(--color-gray-500)]">Aplica crédito sem apagar nem alterar o ledger.</p><Label htmlFor="reset-reason">Motivo obrigatório</Label><Input id="reset-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: cortesia comercial aprovada" className="mt-2" /><Button variant="outline" className="mt-4" onClick={() => reset.mutate()} disabled={reason.trim().length < 3 || reset.isPending}><RefreshCcw />Aplicar reset</Button></Card>
      <Card className="border-[var(--border-default)] bg-[var(--color-surface-1)] p-6 shadow-sm"><SectionLabel>Receita da conta</SectionLabel>{detail.revenue.length === 0 ? <Empty>Sem lançamentos para esta conta.</Empty> : <div className="space-y-3">{detail.revenue.slice(0, 8).map((entry) => <div key={entry.id} className="flex items-center justify-between border-b border-[var(--border-default)] pb-3"><div><p className="font-medium">{entry.tipo}</p><p className="text-xs text-[var(--color-gray-500)]">{entry.competencia} · {entry.status}</p></div><p className="font-mono font-semibold">{moneyValue(entry.valor_brl)}</p></div>)}</div>}</Card>
    </div>
  </div>;
}

function LaunchesScreen({ catalog, accounts, refresh }: { catalog: AdminFinanceCatalog; accounts: AdminAccount[]; refresh: () => void }) {
  const [revenue, setRevenue] = useState({ acesId: String(accounts[0]?.aces_id ?? ""), competencia: monthInput(), tipo: "mensalidade", valorBrl: "", status: "previsto", descricao: "" });
  const [fixed, setFixed] = useState({ nome: "", categoria: "infra", valorBrl: "", recorrencia: "mensal", vigenciaInicio: monthInput() });
  const [rate, setRate] = useState({ rateKind: "internal", rate: "", source: "manual", effectiveAt: dateTimeInput() });
  const createRevenue = useMutation({ mutationFn: () => postCrmBackend("/api/admin/revenue-entries", { ...revenue, acesId: Number(revenue.acesId), valorBrl: Number(revenue.valorBrl), pagoEm: revenue.status === "pago" ? dateTimeInput() : null }), onSuccess: () => { toast.success("Receita lançada"); setRevenue((value) => ({ ...value, valorBrl: "", descricao: "" })); refresh(); }, onError: (error: Error) => toast.error(error.message) });
  const createFixed = useMutation({ mutationFn: () => postCrmBackend("/api/admin/fixed-costs", { ...fixed, valorBrl: Number(fixed.valorBrl) }), onSuccess: () => { toast.success("Custo fixo cadastrado"); setFixed((value) => ({ ...value, nome: "", valorBrl: "" })); refresh(); }, onError: (error: Error) => toast.error(error.message) });
  const createRate = useMutation({ mutationFn: () => postCrmBackend("/api/admin/exchange-rates", { ...rate, rate: Number(rate.rate), fromCurrency: "USD", toCurrency: "BRL" }), onSuccess: () => { toast.success("Câmbio cadastrado"); setRate((value) => ({ ...value, rate: "" })); refresh(); }, onError: (error: Error) => toast.error(error.message) });
  const remove = async (path: string) => { try { await deleteCrmBackend(path); toast.success("Lançamento removido"); refresh(); } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao remover"); } };
  return <div className="space-y-6">
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="border-[var(--border-default)] bg-[var(--color-surface-1)] p-6 shadow-sm"><SectionLabel>Nova receita</SectionLabel><form className="space-y-3" onSubmit={(event) => { event.preventDefault(); createRevenue.mutate(); }}><select value={revenue.acesId} onChange={(event) => setRevenue({ ...revenue, acesId: event.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{accounts.map((item) => <option key={item.aces_id} value={item.aces_id}>{item.account_name}</option>)}</select><div className="grid grid-cols-2 gap-3"><Input type="date" value={revenue.competencia} onChange={(event) => setRevenue({ ...revenue, competencia: event.target.value })} /><select value={revenue.tipo} onChange={(event) => setRevenue({ ...revenue, tipo: event.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="mensalidade">Mensalidade</option><option value="implantacao">Implantação</option><option value="avulso">Avulso</option><option value="desconto">Desconto</option></select></div><Input type="number" step="0.01" value={revenue.valorBrl} onChange={(event) => setRevenue({ ...revenue, valorBrl: event.target.value })} placeholder="Valor em R$" required /><Input value={revenue.descricao} onChange={(event) => setRevenue({ ...revenue, descricao: event.target.value })} placeholder="Descrição" /><select value={revenue.status} onChange={(event) => setRevenue({ ...revenue, status: event.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="previsto">Previsto</option><option value="pago">Pago</option></select><Button type="submit" className="w-full" disabled={createRevenue.isPending}><Plus />Lançar receita</Button></form></Card>
      <Card className="border-[var(--border-default)] bg-[var(--color-surface-1)] p-6 shadow-sm"><SectionLabel>Novo custo fixo</SectionLabel><form className="space-y-3" onSubmit={(event) => { event.preventDefault(); createFixed.mutate(); }}><Input value={fixed.nome} onChange={(event) => setFixed({ ...fixed, nome: event.target.value })} placeholder="Nome do custo" required /><div className="grid grid-cols-2 gap-3"><select value={fixed.categoria} onChange={(event) => setFixed({ ...fixed, categoria: event.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="infra">Infra</option><option value="ferramenta">Ferramenta</option><option value="pessoal">Pessoal</option><option value="outro">Outro</option></select><select value={fixed.recorrencia} onChange={(event) => setFixed({ ...fixed, recorrencia: event.target.value })} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="mensal">Mensal</option><option value="anual">Anual</option><option value="unico">Único</option></select></div><Input type="number" min="0" step="0.01" value={fixed.valorBrl} onChange={(event) => setFixed({ ...fixed, valorBrl: event.target.value })} placeholder="Valor em R$" required /><Input type="date" value={fixed.vigenciaInicio} onChange={(event) => setFixed({ ...fixed, vigenciaInicio: event.target.value })} /><Button type="submit" className="w-full" disabled={createFixed.isPending}><Plus />Cadastrar custo</Button></form></Card>
      <Card className="border-[var(--border-default)] bg-[var(--color-surface-1)] p-6 shadow-sm"><SectionLabel>Novo câmbio</SectionLabel><form className="space-y-3" onSubmit={(event) => { event.preventDefault(); createRate.mutate(); }}><select value={rate.rateKind} onChange={(event) => setRate({ ...rate, rateKind: event.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="internal">Dólar interno</option><option value="provider">Dólar provider</option></select><Input type="number" min="0.0001" step="0.0001" value={rate.rate} onChange={(event) => setRate({ ...rate, rate: event.target.value })} placeholder="USD → BRL" required /><Input value={rate.source} onChange={(event) => setRate({ ...rate, source: event.target.value })} placeholder="Fonte" required /><Button type="submit" className="w-full" disabled={createRate.isPending}><Plus />Cadastrar câmbio</Button></form></Card>
    </div>
    <div className="grid gap-6 xl:grid-cols-3">
      <LaunchList title="Receitas" items={catalog.revenue} render={(item: AdminRevenueEntry) => <><div><p className="font-medium">{item.tipo} · conta #{item.aces_id}</p><p className="text-xs text-[var(--color-gray-500)]">{item.competencia} · {item.status}</p></div><div className="text-right"><p className="font-mono font-semibold">{moneyValue(item.valor_brl)}</p><button className="text-xs text-[var(--color-error-600)]" onClick={() => remove(`/api/admin/revenue-entries/${item.id}`)}>Excluir</button></div></>} />
      <LaunchList title="Custos fixos" items={catalog.fixedCosts} render={(item: AdminFixedCost) => <><div><p className="font-medium">{item.nome}</p><p className="text-xs text-[var(--color-gray-500)]">{item.categoria} · {item.recorrencia}</p></div><div className="text-right"><p className="font-mono font-semibold">{moneyValue(item.valor_brl)}</p><button className="text-xs text-[var(--color-error-600)]" onClick={() => remove(`/api/admin/fixed-costs/${item.id}`)}>Excluir</button></div></>} />
      <LaunchList title="Câmbios" items={catalog.exchangeRates} render={(item: AdminExchangeRate) => <><div><p className="font-medium">{item.rate_kind === "internal" ? "Interno" : "Provider"}</p><p className="text-xs text-[var(--color-gray-500)]">{item.source} · {new Date(item.effective_at).toLocaleDateString("pt-BR")}</p></div><div className="text-right"><p className="font-mono font-semibold">R$ {number(item.rate).toFixed(4)}</p><button className="text-xs text-[var(--color-error-600)]" onClick={() => remove(`/api/admin/exchange-rates/${item.id}`)}>Excluir</button></div></>} />
    </div>
  </div>;
}

function LaunchList<T extends { id: string }>({ title, items, render }: { title: string; items: T[]; render: (item: T) => ReactNode }) {
  return <Card className="border-[var(--border-default)] bg-[var(--color-surface-1)] p-6 shadow-sm"><SectionLabel>{title}</SectionLabel>{items.length === 0 ? <Empty>Sem registros.</Empty> : <div className="max-h-96 space-y-3 overflow-y-auto">{items.map((item) => <div key={item.id} className="flex items-center justify-between gap-4 border-b border-[var(--border-default)] pb-3">{render(item)}</div>)}</div>}</Card>;
}

function PlansScreen({ plans, refresh }: { plans: AdminPlan[]; refresh: () => void }) {
  const [form, setForm] = useState({ code: "", name: "", mensalidadeBrl: "", implantacaoBrl: "", aiBudgetBrl: "", warnThresholdPct: "80", maxUsuarios: "", maxInstancias: "" });
  const create = useMutation({ mutationFn: () => postCrmBackend("/api/admin/plans", { ...form, mensalidadeBrl: Number(form.mensalidadeBrl), implantacaoBrl: Number(form.implantacaoBrl), aiBudgetBrl: form.aiBudgetBrl === "" ? null : Number(form.aiBudgetBrl), warnThresholdPct: Number(form.warnThresholdPct), maxUsuarios: form.maxUsuarios === "" ? null : Number(form.maxUsuarios), maxInstancias: form.maxInstancias === "" ? null : Number(form.maxInstancias), isActive: true }), onSuccess: () => { toast.success("Plano criado"); setForm({ code: "", name: "", mensalidadeBrl: "", implantacaoBrl: "", aiBudgetBrl: "", warnThresholdPct: "80", maxUsuarios: "", maxInstancias: "" }); refresh(); }, onError: (error: Error) => toast.error(error.message) });
  const toggle = async (plan: AdminPlan) => { try { await patchCrmBackend(`/api/admin/plans/${plan.id}`, { isActive: !plan.is_active }); toast.success("Plano atualizado"); refresh(); } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao atualizar"); } };
  return <div className="space-y-6"><Card className="border-[var(--border-default)] bg-[var(--color-surface-1)] p-6 shadow-sm"><SectionLabel>Novo plano</SectionLabel><form onSubmit={(event: FormEvent) => { event.preventDefault(); create.mutate(); }} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><Input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="Código" required /><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nome" required /><Input type="number" min="0" step="0.01" value={form.mensalidadeBrl} onChange={(event) => setForm({ ...form, mensalidadeBrl: event.target.value })} placeholder="Mensalidade" required /><Input type="number" min="0" step="0.01" value={form.implantacaoBrl} onChange={(event) => setForm({ ...form, implantacaoBrl: event.target.value })} placeholder="Implantação" required /><Input type="number" min="0" step="0.01" value={form.aiBudgetBrl} onChange={(event) => setForm({ ...form, aiBudgetBrl: event.target.value })} placeholder="Teto de IA" /><Input type="number" min="1" max="100" value={form.warnThresholdPct} onChange={(event) => setForm({ ...form, warnThresholdPct: event.target.value })} placeholder="Alerta %" /><Input type="number" min="0" value={form.maxUsuarios} onChange={(event) => setForm({ ...form, maxUsuarios: event.target.value })} placeholder="Máx. usuários" /><Input type="number" min="0" value={form.maxInstancias} onChange={(event) => setForm({ ...form, maxInstancias: event.target.value })} placeholder="Máx. instâncias" /><Button type="submit" className="md:col-span-2 xl:col-span-4" disabled={create.isPending}><Plus />Criar plano</Button></form></Card>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{plans.map((plan) => <Card key={plan.id} className="border-[var(--border-default)] bg-[var(--color-surface-1)] p-6 shadow-sm"><div className="flex items-start justify-between gap-4"><div><SectionLabel>{plan.code}</SectionLabel><h3 className="text-xl font-semibold">{plan.name}</h3></div><Switch checked={plan.is_active} onCheckedChange={() => toggle(plan)} aria-label={`Ativar plano ${plan.name}`} /></div><p className="mt-5 font-mono text-3xl font-semibold">{moneyValue(plan.mensalidade_brl)}<span className="text-sm font-normal text-[var(--color-gray-500)]">/mês</span></p><dl className="mt-5 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-[var(--color-gray-500)]">Implantação</dt><dd className="mt-1 font-mono">{moneyValue(plan.implantacao_brl)}</dd></div><div><dt className="text-[var(--color-gray-500)]">Teto de IA</dt><dd className="mt-1 font-mono">{plan.ai_budget_brl === null ? "Sem teto" : moneyValue(plan.ai_budget_brl)}</dd></div><div><dt className="text-[var(--color-gray-500)]">Alerta</dt><dd className="mt-1 font-mono">{plan.warn_threshold_pct}%</dd></div><div><dt className="text-[var(--color-gray-500)]">Limites</dt><dd className="mt-1">{plan.max_usuarios ?? "∞"} usuários · {plan.max_instancias ?? "∞"} instâncias</dd></div></dl></Card>)}</div>
  </div>;
}

export default function SuperAdmin() {
  const { isStaff, loading: accessLoading } = useIsStaff();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const accountId = Number(searchParams.get("account")) || null;
  const [tab, setTab] = useState("overview");
  const overview = useQuery({ queryKey: ["superadmin-overview"], queryFn: () => getCrmBackend<AdminOverview>("/api/admin/overview"), enabled: isStaff });
  const accounts = useQuery({ queryKey: ["superadmin-accounts"], queryFn: () => getCrmBackend<AdminAccount[]>("/api/admin/accounts"), enabled: isStaff });
  const catalog = useQuery({ queryKey: ["superadmin-catalog"], queryFn: async () => {
    const [plansResult, revenueResult, fixedResult, ratesResult] = await Promise.all([
      getCrmBackend<Pick<AdminFinanceCatalog, "plans">>("/api/admin/plans"),
      getCrmBackend<Pick<AdminFinanceCatalog, "revenue">>("/api/admin/revenue-entries"),
      getCrmBackend<Pick<AdminFinanceCatalog, "fixedCosts">>("/api/admin/fixed-costs"),
      getCrmBackend<Pick<AdminFinanceCatalog, "exchangeRates">>("/api/admin/exchange-rates"),
    ]);
    return { plans: plansResult.plans ?? [], revenue: revenueResult.revenue ?? [], fixedCosts: fixedResult.fixedCosts ?? [], exchangeRates: ratesResult.exchangeRates ?? [] };
  }, enabled: isStaff });
  const detail = useQuery({ queryKey: ["superadmin-account", accountId], queryFn: () => getCrmBackend<AdminAccountDetail>(`/api/admin/accounts/${accountId}`), enabled: isStaff && accountId !== null });
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["superadmin"] }); void queryClient.invalidateQueries({ queryKey: ["superadmin-overview"] }); void queryClient.invalidateQueries({ queryKey: ["superadmin-accounts"] }); void queryClient.invalidateQueries({ queryKey: ["superadmin-catalog"] }); void queryClient.invalidateQueries({ queryKey: ["superadmin-account"] }); };

  const customerAccounts = useMemo(() => (accounts.data ?? []).filter((item) => !item.is_internal), [accounts.data]);
  if (accessLoading) return <LoadingPage />;
  if (!isStaff) return <Navigate to="/" replace />;
  if (overview.isLoading || accounts.isLoading || catalog.isLoading || (accountId && detail.isLoading)) return <LoadingPage />;
  if (overview.error || accounts.error || catalog.error || detail.error) return <Empty>Não foi possível carregar o painel financeiro.</Empty>;
  if (accountId && detail.data) return <AccountDetailScreen detail={detail.data} plans={catalog.data?.plans ?? []} onBack={() => setSearchParams({})} onChanged={refresh} />;

  return <div className="space-y-6">
    <header><SectionLabel>Superadmin</SectionLabel><h1 className="flex items-center gap-3 text-3xl font-bold text-[var(--color-gray-900)]"><ShieldCheck className="h-8 w-8 text-[var(--color-primary-500)]" />Economia da operação</h1><p className="mt-2 max-w-3xl text-[var(--color-gray-500)]">Comportamento financeiro por cliente, custo real dos providers e controle seguro de contratos e tetos.</p></header>
    <Tabs value={tab} onValueChange={setTab} className="space-y-6"><TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto bg-[var(--color-bg-subtle)] p-1 sm:w-fit"><TabsTrigger value="overview">Visão geral</TabsTrigger><TabsTrigger value="accounts">Contas</TabsTrigger><TabsTrigger value="launches">Lançamentos</TabsTrigger><TabsTrigger value="plans">Planos</TabsTrigger></TabsList>
      <TabsContent value="overview" className="mt-0">{overview.data && <OverviewScreen data={overview.data} />}</TabsContent>
      <TabsContent value="accounts" className="mt-0"><AccountsScreen accounts={accounts.data ?? []} onOpen={(acesId) => setSearchParams({ account: String(acesId) })} /></TabsContent>
      <TabsContent value="launches" className="mt-0">{catalog.data && <LaunchesScreen catalog={catalog.data} accounts={customerAccounts} refresh={refresh} />}</TabsContent>
      <TabsContent value="plans" className="mt-0"><PlansScreen plans={catalog.data?.plans ?? []} refresh={refresh} /></TabsContent>
    </Tabs>
  </div>;
}
