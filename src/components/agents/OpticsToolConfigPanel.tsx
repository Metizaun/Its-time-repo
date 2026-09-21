import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Loader2, Pencil, Plus, ScanLine, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { deactivateOpticalCatalogProduct, listOpticalCatalogProducts, saveOpticalCatalogProduct, type OpticalCatalogProduct } from "@/services/agentToolsService";
import { VisagismCatalogPanel } from "@/components/agents/VisagismCatalogPanel";

type Props = { agentId: string; toolKey: "prescription_analyst" | "visagism"; onClose: () => void; onChanged: () => void };
type LensCategory = "single_vision" | "multifocal";
const inputClass = "h-10 w-full rounded-[var(--radius-md)] border border-[var(--border-input)] bg-[var(--color-surface-1)] px-3 text-sm shadow-inset outline-none transition-shadow focus:shadow-focus";
const labelClass = "font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--color-gray-600)]";
const categoryLabel = (category: LensCategory) => category === "multifocal" ? "Multifocal" : "Visão simples";

export function OpticsToolConfigPanel({ agentId, toolKey, onClose, onChanged }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [category, setCategory] = useState<LensCategory>("single_vision");
  const [products, setProducts] = useState<OpticalCatalogProduct[]>([]);
  const [editing, setEditing] = useState<OpticalCatalogProduct | null>(null);
  const reload = useCallback(async () => {
    setLoading(true);
    try { if (toolKey === "prescription_analyst") setProducts(await listOpticalCatalogProducts(agentId)); }
    catch (error) { toast.error("Não foi possível carregar o catálogo", { description: error instanceof Error ? error.message : undefined }); }
    finally { setLoading(false); }
  }, [agentId, toolKey]);
  useEffect(() => { void reload(); }, [reload]);

  async function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setSaving(true);
    try {
      await saveOpticalCatalogProduct(agentId, {
        id: editing?.id,
        lensCategory: category, displayName: String(data.get("name") ?? ""),
        brand: String(data.get("brand") ?? "").trim() || null,
        treatments: String(data.get("treatments") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
        description: String(data.get("description") ?? "").trim() || null,
        priceCents: Math.round(Number(data.get("price")) * 100), isActive: true,
      });
      event.currentTarget.reset(); setEditing(null); toast.success(editing ? "Produto atualizado" : "Produto adicionado ao catálogo"); await reload(); onChanged();
    } catch (error) { toast.error("Não foi possível salvar o produto", { description: error instanceof Error ? error.message : undefined }); }
    finally { setSaving(false); }
  }

  if (toolKey === "visagism") return <VisagismCatalogPanel agentId={agentId} onClose={onClose} onChanged={onChanged} />;
  const visibleProducts = products.filter((product) => product.isActive && product.lensCategory === category);
  return <div className="rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-4 shadow-sm">
    <div className="mb-4 flex items-start justify-between gap-4"><div className="flex gap-3"><div className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-primary-50)] text-[var(--color-primary-600)]"><ScanLine className="h-4 w-4" /></div><div><p className="text-sm font-bold text-[var(--color-gray-900)]">Catálogo de lentes</p><p className="text-xs text-[var(--color-gray-600)]">Cadastre produtos finais, tratamentos incluídos e preço.</p></div></div><button type="button" onClick={onClose} className="rounded-full p-2 focus-visible:shadow-focus hover:bg-[var(--color-bg-subtle)]" aria-label="Fechar"><X className="h-4 w-4" /></button></div>
    <div className="mb-4 inline-flex rounded-[var(--radius-lg)] bg-[var(--color-bg-subtle)] p-1" role="tablist" aria-label="Categoria de lente">{(["single_vision", "multifocal"] as LensCategory[]).map((item) => <button key={item} type="button" role="tab" aria-selected={category === item} onClick={() => { setCategory(item); setEditing(null); }} className={`h-9 rounded-[var(--radius-md)] px-4 text-sm font-semibold transition-colors focus-visible:shadow-focus ${category === item ? "bg-[var(--color-surface-1)] text-[var(--color-primary-600)] shadow-sm" : "text-[var(--color-gray-600)] hover:text-[var(--color-gray-900)]"}`}>{categoryLabel(item)}</button>)}</div>
    {loading ? <div className="grid min-h-28 place-items-center"><Loader2 className="h-5 w-5 animate-spin" /></div> : <><form key={editing?.id ?? `new-${category}`} onSubmit={submitProduct} className="grid gap-3 rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-2)] p-4 md:grid-cols-2"><label><span className={labelClass}>Produto</span><input name="name" required defaultValue={editing?.displayName} className={inputClass} placeholder={`Lente ${categoryLabel(category).toLowerCase()}`} /></label><label><span className={labelClass}>Marca</span><input name="brand" defaultValue={editing?.brand ?? ""} className={inputClass} placeholder="Opcional" /></label><label><span className={labelClass}>Tratamentos incluídos</span><input name="treatments" defaultValue={editing?.treatments.join(", ") ?? ""} className={inputClass} placeholder="Antirreflexo, filtro azul" /></label><label><span className={labelClass}>Preço final (R$)</span><input name="price" type="number" min="0" step="0.01" required defaultValue={editing ? editing.priceCents / 100 : undefined} className={inputClass} /></label><label className="md:col-span-2"><span className={labelClass}>Descrição comercial</span><input name="description" defaultValue={editing?.description ?? ""} className={inputClass} placeholder="Opcional" /></label><button disabled={saving} className="md:col-span-2 inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-primary-500)] px-4 text-sm font-semibold text-white shadow-primary transition-colors hover:bg-[var(--color-primary-600)] focus-visible:shadow-focus disabled:opacity-60"><Plus className="h-4 w-4" />{editing ? "Salvar alterações" : "Adicionar produto"}</button></form><div className="mt-4 grid gap-2">{visibleProducts.length === 0 ? <p className="py-4 text-center text-sm text-[var(--color-gray-500)]">Nenhum produto cadastrado em {categoryLabel(category).toLowerCase()}.</p> : visibleProducts.map((product) => <div key={product.id} className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-3"><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-[var(--color-gray-900)]">{product.displayName}</p><p className="truncate text-xs text-[var(--color-gray-600)]">{[product.brand, product.treatments.join(", "), product.description].filter(Boolean).join(" · ") || "Sem tratamentos informados"}</p></div><strong className="whitespace-nowrap text-sm text-[var(--color-gray-900)]">{(product.priceCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong>{product.isActive && <><button type="button" onClick={() => { setCategory(product.lensCategory); setEditing(product); }} className="rounded p-2 text-[var(--color-primary-600)] focus-visible:shadow-focus" aria-label={`Editar ${product.displayName}`}><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => deactivateOpticalCatalogProduct(agentId, product.id).then(reload).catch((error) => toast.error("Não foi possível desativar", { description: error instanceof Error ? error.message : undefined }))} className="rounded p-2 text-[var(--color-error-600)] focus-visible:shadow-focus" aria-label={`Desativar ${product.displayName}`}><Trash2 className="h-4 w-4" /></button></>}</div>)}</div></>}
  </div>;
}
