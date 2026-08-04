import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Loader2, Plus, ScanLine, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import {
  deactivateLensPriceRule,
  listLensPriceRules,
  saveLensPriceRule,
  type LensPriceRule,
} from "@/services/agentToolsService";
import { VisagismCatalogPanel } from "@/components/agents/VisagismCatalogPanel";

type Props = { agentId: string; toolKey: "prescription_analyst" | "visagism"; onClose: () => void; onChanged: () => void };

const inputClass = "h-10 w-full rounded-[var(--radius-md)] border border-[var(--border-input)] bg-[var(--color-surface-1)] px-3 text-sm shadow-inset outline-none transition-shadow focus:shadow-focus";
const labelClass = "font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--color-gray-600)]";

function rulesOverlap(left: LensPriceRule, right: LensPriceRule) {
  if (!left.isActive || !right.isActive || left.lensCategory !== right.lensCategory) return false;
  const sphere = left.minSphere <= right.maxSphere && right.minSphere <= left.maxSphere;
  if (!sphere) return false;
  if (left.lensCategory === "single_vision") return true;
  return (left.minAddition ?? 0) <= (right.maxAddition ?? 0) && (right.minAddition ?? 0) <= (left.maxAddition ?? 0);
}

export function OpticsToolConfigPanel({ agentId, toolKey, onClose, onChanged }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rules, setRules] = useState<LensPriceRule[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      if (toolKey === "prescription_analyst") setRules(await listLensPriceRules(agentId));
    } catch (error) {
      toast.error("Nao foi possivel carregar a configuracao", { description: error instanceof Error ? error.message : undefined });
    } finally { setLoading(false); }
  }, [agentId, toolKey]);

  useEffect(() => { void reload(); }, [reload]);

  async function submitRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const category = data.get("category") === "multifocal" ? "multifocal" : "single_vision";
    setSaving(true);
    try {
      await saveLensPriceRule(agentId, {
        displayName: String(data.get("name") ?? ""), lensCategory: category,
        minSphere: Number(data.get("minSphere")), maxSphere: Number(data.get("maxSphere")),
        maxAbsCylinder: Number(data.get("cylinder")),
        minAddition: category === "multifocal" && String(data.get("minAddition") ?? "").trim() ? Number(data.get("minAddition")) : null,
        maxAddition: category === "multifocal" && String(data.get("maxAddition") ?? "").trim() ? Number(data.get("maxAddition")) : null,
        priceCents: Math.round(Number(data.get("price")) * 100), priority: Number(data.get("priority")), isActive: true,
      });
      event.currentTarget.reset();
      toast.success("Regra de preco salva"); await reload(); onChanged();
    } catch (error) { toast.error("Nao foi possivel salvar a regra", { description: error instanceof Error ? error.message : undefined }); }
    finally { setSaving(false); }
  }

  const overlaps = rules.flatMap((rule, index) => rules.slice(index + 1).filter((candidate) => rulesOverlap(rule, candidate)).map((candidate) => `${rule.displayName} / ${candidate.displayName}`));

  if (toolKey === "visagism") {
    return <VisagismCatalogPanel agentId={agentId} onClose={onClose} onChanged={onChanged} />;
  }

  return <div className="rounded-[var(--radius-xl)] border border-[var(--color-primary-200)] bg-[var(--color-bg-subtle)] p-4 shadow-sm">
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="flex gap-3"><div className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-primary-50)] text-[var(--color-primary-600)]"><ScanLine className="h-4 w-4" /></div><div><p className="text-sm font-bold text-[var(--color-gray-900)]">Regras de lentes</p><p className="text-xs text-[var(--color-gray-600)]">O preco sempre vem da primeira faixa compativel.</p></div></div>
      <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-[var(--color-bg-muted)]" aria-label="Fechar"><X className="h-4 w-4" /></button>
    </div>
    {loading ? <div className="grid min-h-28 place-items-center"><Loader2 className="h-5 w-5 animate-spin" /></div> : <>
      {overlaps.length > 0 && <div className="mb-3 flex gap-2 rounded-[var(--radius-md)] border border-[var(--color-warning-border)] bg-[var(--color-warning-50)] p-3 text-xs text-[var(--color-warning-700)]"><AlertTriangle className="h-4 w-4 shrink-0" /><span>Faixas sobrepostas: {overlaps.join(", ")}. A menor prioridade numerica vence.</span></div>}
      <form onSubmit={submitRule} className="grid gap-3 rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-3 md:grid-cols-4">
        <label className="md:col-span-2"><span className={labelClass}>Nome</span><input name="name" required className={inputClass} placeholder="Lente basica" /></label>
        <label><span className={labelClass}>Categoria</span><select name="category" className={inputClass}><option value="single_vision">Visao simples</option><option value="multifocal">Multifocal</option></select></label>
        <label><span className={labelClass}>Prioridade</span><input name="priority" type="number" min="0" defaultValue="100" required className={inputClass} /></label>
        <label><span className={labelClass}>Esfera minima</span><input name="minSphere" type="number" step="0.25" required className={inputClass} /></label>
        <label><span className={labelClass}>Esfera maxima</span><input name="maxSphere" type="number" step="0.25" required className={inputClass} /></label>
        <label><span className={labelClass}>Cilindro absoluto max.</span><input name="cylinder" type="number" min="0" step="0.25" required className={inputClass} /></label>
        <label><span className={labelClass}>Preco (R$)</span><input name="price" type="number" min="0" step="0.01" required className={inputClass} /></label>
        <label><span className={labelClass}>Adicao minima</span><input name="minAddition" type="number" min="0" step="0.25" className={inputClass} /></label>
        <label><span className={labelClass}>Adicao maxima</span><input name="maxAddition" type="number" min="0" step="0.25" className={inputClass} /></label>
        <button disabled={saving} className="md:col-span-2 mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary-500)] px-4 text-sm font-semibold text-white shadow-primary disabled:opacity-60"><Plus className="h-4 w-4" />Adicionar regra</button>
      </form>
      <div className="mt-3 grid gap-2">{rules.map((rule) => <div key={rule.id} className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-3"><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{rule.displayName}</p><p className="font-mono text-[10px] text-[var(--color-gray-600)]">{rule.lensCategory === "multifocal" ? "MULTIFOCAL" : "VISAO SIMPLES"} | esfera {rule.minSphere} a {rule.maxSphere} | prioridade {rule.priority}</p></div><strong className="text-sm">{(rule.priceCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong>{rule.isActive && <button onClick={() => deactivateLensPriceRule(agentId, rule.id).then(reload)} className="p-2 text-[var(--color-error-600)]" aria-label="Desativar regra"><Trash2 className="h-4 w-4" /></button>}</div>)}</div>
    </>}
  </div>;
}
