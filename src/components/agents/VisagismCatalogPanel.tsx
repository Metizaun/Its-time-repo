import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  Glasses,
  ImagePlus,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { VISAGISM_THINKING_PHRASES } from "@/lib/visagismThinkingPhrases";
import {
  analyzeVisagismCatalogItem,
  deactivateVisagismCatalogItem,
  listVisagismCatalog,
  saveVisagismCatalogItem,
  type VisagismAnalysis,
  type VisagismCatalogItem,
} from "@/services/agentToolsService";

type Props = {
  agentId: string;
  onClose: () => void;
  onChanged: () => void;
};

type View = "catalog" | "create" | "analyzing" | "review" | "edit";

type AnalysisForm = {
  productName: string;
  color: string;
  shape: string;
  material: string;
  style: string;
  faceShapes: string;
  personalityTraits: string;
  perception: string;
  styleProfiles: string;
  description: string;
};

const EMPTY_FORM: AnalysisForm = {
  productName: "",
  color: "",
  shape: "",
  material: "",
  style: "",
  faceShapes: "",
  personalityTraits: "",
  perception: "",
  styleProfiles: "",
  description: "",
};

const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const inputClass =
  "h-10 w-full rounded-[var(--radius-md)] border border-[var(--border-input)] bg-[var(--color-surface-1)] px-3 text-sm text-[var(--color-gray-700)] shadow-inset outline-none transition-shadow focus:shadow-focus disabled:cursor-not-allowed disabled:text-[var(--color-gray-400)]";
const textareaClass = cn(inputClass, "h-auto min-h-28 resize-y py-3 leading-relaxed");
const labelClass =
  "font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--color-gray-600)]";
const sectionLabelClass =
  "flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--color-gray-600)] before:block before:h-0.5 before:w-5 before:bg-[var(--color-primary-500)] before:content-['']";

function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean).join(", ") : "";
}

function analysisToForm(analysis: Partial<VisagismAnalysis>, fallbackName: string): AnalysisForm {
  return {
    productName: analysis.product_name?.trim() || fallbackName,
    color: analysis.color?.trim() || "",
    shape: analysis.shape?.trim() || "",
    material: analysis.material?.trim() || "",
    style: analysis.style?.trim() || "",
    faceShapes: joinList(analysis.recommended_face_shapes),
    personalityTraits: joinList(analysis.recommended_personality_traits),
    perception: joinList(analysis.recommended_perception),
    styleProfiles: joinList(analysis.recommended_style_profiles),
    description: analysis.recommendation_description?.trim() || "",
  };
}

function itemToForm(item: VisagismCatalogItem): AnalysisForm {
  const attributes = item.attributes ?? {};
  return analysisToForm(
    {
      product_name: String(attributes.product_name ?? item.product_code),
      color: String(attributes.color ?? ""),
      shape: String(attributes.shape ?? ""),
      material: String(attributes.material ?? ""),
      style: String(attributes.style ?? ""),
      recommended_face_shapes: Array.isArray(attributes.recommended_face_shapes)
        ? attributes.recommended_face_shapes.map(String)
        : [],
      recommended_personality_traits: Array.isArray(attributes.recommended_personality_traits)
        ? attributes.recommended_personality_traits.map(String)
        : [],
      recommended_perception: Array.isArray(attributes.recommended_perception)
        ? attributes.recommended_perception.map(String)
        : [],
      recommended_style_profiles: Array.isArray(attributes.recommended_style_profiles)
        ? attributes.recommended_style_profiles.map(String)
        : [],
      recommendation_description: item.recommendation_description,
    },
    item.product_code
  );
}

function formToAttributes(form: AnalysisForm) {
  return {
    product_name: form.productName.trim(),
    color: form.color.trim(),
    shape: form.shape.trim(),
    material: form.material.trim(),
    style: form.style.trim(),
    recommended_face_shapes: splitList(form.faceShapes),
    recommended_personality_traits: splitList(form.personalityTraits),
    recommended_perception: splitList(form.perception),
    recommended_style_profiles: splitList(form.styleProfiles),
    recommendation_description: form.description.trim(),
  };
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Nao foi possivel ler a imagem"));
    reader.readAsDataURL(file);
  });
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function EditFields({ form, onChange }: { form: AnalysisForm; onChange: (form: AnalysisForm) => void }) {
  const update = (field: keyof AnalysisForm) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onChange({ ...form, [field]: event.target.value });
  };

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <p className={sectionLabelClass}>Caracteristicas da armacao</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className={labelClass}>Cor</span>
            <input className={inputClass} value={form.color} onChange={update("color")} />
          </label>
          <label>
            <span className={labelClass}>Formato</span>
            <input className={inputClass} value={form.shape} onChange={update("shape")} />
          </label>
          <label>
            <span className={labelClass}>Material</span>
            <input className={inputClass} value={form.material} onChange={update("material")} />
          </label>
          <label>
            <span className={labelClass}>Estilo</span>
            <input className={inputClass} value={form.style} onChange={update("style")} />
          </label>
        </div>
      </section>

      <section className="space-y-3">
        <p className={sectionLabelClass}>Perfil recomendado</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className={labelClass}>Formatos de rosto</span>
            <input className={inputClass} value={form.faceShapes} onChange={update("faceShapes")} placeholder="Oval, redondo" />
          </label>
          <label>
            <span className={labelClass}>Personalidade transmitida</span>
            <input className={inputClass} value={form.personalityTraits} onChange={update("personalityTraits")} placeholder="Confiante, criativa" />
          </label>
          <label>
            <span className={labelClass}>Percepcao comunicada</span>
            <input className={inputClass} value={form.perception} onChange={update("perception")} placeholder="Autoridade, leveza" />
          </label>
          <label>
            <span className={labelClass}>Perfis de estilo</span>
            <input className={inputClass} value={form.styleProfiles} onChange={update("styleProfiles")} placeholder="Classico, contemporaneo" />
          </label>
        </div>
        <p className="text-xs text-[var(--color-gray-500)]">Separe mais de uma opcao por virgulas.</p>
      </section>

      <section className="space-y-3">
        <p className={sectionLabelClass}>Descricao para recomendacao</p>
        <label className="block">
          <span className="sr-only">Descricao visagista</span>
          <textarea className={textareaClass} value={form.description} onChange={update("description")} />
        </label>
      </section>
    </div>
  );
}

export function VisagismCatalogPanel({ agentId, onClose, onChanged }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [catalog, setCatalog] = useState<VisagismCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<View>("catalog");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<VisagismCatalogItem | null>(null);
  const [form, setForm] = useState<AnalysisForm>(EMPTY_FORM);
  const [progress, setProgress] = useState(12);
  const [phraseIndex, setPhraseIndex] = useState(() => Math.floor(Math.random() * VISAGISM_THINKING_PHRASES.length));

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setCatalog(await listVisagismCatalog(agentId));
    } catch (error) {
      toast.error("Nao foi possivel carregar o catalogo", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (view !== "analyzing") return;
    const progressTimer = window.setInterval(() => {
      setProgress((current) => (current >= 91 ? 18 : Math.min(91, current + Math.max(1, Math.round(Math.random() * 4)))));
    }, 360);
    const phraseTimer = window.setInterval(() => {
      setPhraseIndex((current) => {
        const offset = 1 + Math.floor(Math.random() * (VISAGISM_THINKING_PHRASES.length - 1));
        return (current + offset) % VISAGISM_THINKING_PHRASES.length;
      });
    }, 2400);
    return () => {
      window.clearInterval(progressTimer);
      window.clearInterval(phraseTimer);
    };
  }, [view]);

  useEffect(() => () => {
    if (localPreview?.startsWith("blob:")) URL.revokeObjectURL(localPreview);
  }, [localPreview]);

  function resetCreation() {
    if (localPreview?.startsWith("blob:")) URL.revokeObjectURL(localPreview);
    setName("");
    setFile(null);
    setLocalPreview(null);
    setDraftId(null);
    setEditItem(null);
    setForm(EMPTY_FORM);
    setProgress(12);
  }

  function startCreate() {
    resetCreation();
    setView("create");
  }

  function acceptFile(candidate: File | null) {
    if (!candidate) return;
    if (!ACCEPTED_IMAGE_TYPES.has(candidate.type)) {
      toast.error("Formato de imagem nao aceito", { description: "Use JPG, PNG ou WebP." });
      return;
    }
    if (candidate.size > MAX_IMAGE_BYTES) {
      toast.error("Imagem acima do limite", { description: "Envie um arquivo de ate 10 MB." });
      return;
    }
    if (localPreview?.startsWith("blob:")) URL.revokeObjectURL(localPreview);
    setFile(candidate);
    setLocalPreview(URL.createObjectURL(candidate));
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    acceptFile(event.dataTransfer.files?.[0] ?? null);
  }

  async function analyzeImage() {
    if (!file || !name.trim()) return;
    setProgress(12);
    setView("analyzing");
    try {
      const base64 = await readFileAsDataUrl(file);
      const [draft] = await Promise.all([
        analyzeVisagismCatalogItem(agentId, {
          productCode: name.trim(),
          fileName: file.name,
          mimeType: file.type,
          base64,
        }),
        wait(2600),
      ]);
      setProgress(100);
      setDraftId(draft.draftId);
      setLocalPreview(draft.previewUrl || localPreview);
      setForm(analysisToForm(draft.analysis, name.trim()));
      await wait(260);
      setView("review");
    } catch (error) {
      setView("create");
      toast.error("Nao foi possivel analisar a armacao", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }

  function openEdit(item: VisagismCatalogItem) {
    setEditItem(item);
    setDraftId(null);
    setForm(itemToForm(item));
    setView("edit");
  }

  async function saveCurrent() {
    const productCode = form.productName.trim();
    const description = form.description.trim();
    if (!productCode || !description) {
      toast.error("Preencha o nome e a descricao antes de salvar");
      return;
    }
    setSaving(true);
    try {
      await saveVisagismCatalogItem(agentId, {
        id: editItem?.id,
        draftId: draftId ?? undefined,
        productCode,
        recommendationDescription: description,
        attributes: formToAttributes(form),
        displayOrder: editItem?.display_order ?? 0,
        isActive: true,
      });
      toast.success(editItem ? "Armacao atualizada" : "Armacao adicionada ao catalogo");
      resetCreation();
      await reload();
      onChanged();
      setView("catalog");
    } catch (error) {
      toast.error("Nao foi possivel salvar a armacao", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  async function archiveItem(item: VisagismCatalogItem) {
    try {
      await deactivateVisagismCatalogItem(agentId, item.id);
      await reload();
      onChanged();
      toast.success("Armacao removida do catalogo");
    } catch (error) {
      toast.error("Nao foi possivel remover a armacao", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }

  const activeCatalog = catalog.filter((item) => item.is_active);
  const canContinue = Boolean(name.trim() && file);
  const preview = view === "edit" ? editItem?.preview_url ?? null : localPreview;

  return (
    <div className="rounded-[var(--radius-xl)] border border-[var(--color-primary-200)] bg-[var(--color-bg-subtle)] p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--color-surface-1)] shadow-sm">
            <Glasses className="h-5 w-5 text-[var(--color-primary-600)]" />
          </div>
          <div>
            <p className="text-sm font-bold text-[var(--color-gray-900)]">Visagismo</p>
            <p className="text-xs text-[var(--color-gray-600)]">
              {view === "catalog" ? "Catalogo de armacoes analisadas pela IA." : "Cadastre e revise uma armacao."}
            </p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-2 text-[var(--color-gray-500)] transition-colors hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-gray-900)] focus-visible:shadow-focus" aria-label="Fechar">
          <X className="h-4 w-4" />
        </button>
      </div>

      {view === "catalog" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className={sectionLabelClass}>Catalogo de imagens</p>
            <Button size="sm" onClick={startCreate}>
              <Plus /> Adicionar armacao
            </Button>
          </div>
          {loading ? (
            <div className="grid min-h-44 place-items-center text-[var(--color-gray-500)]">
              <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-label="Carregando catalogo" />
            </div>
          ) : activeCatalog.length === 0 ? (
            <button type="button" onClick={startCreate} className="grid min-h-48 w-full place-items-center rounded-[var(--radius-xl)] border border-dashed border-[var(--color-primary-300)] bg-[var(--color-surface-1)] p-6 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:shadow-focus">
              <span>
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-[var(--radius-xl)] bg-[image:var(--gradient-orange-coral)] text-white shadow-sm">
                  <ImagePlus className="h-6 w-6" />
                </span>
                <strong className="mt-4 block text-sm text-[var(--color-gray-900)]">Adicione a primeira armacao</strong>
                <span className="mt-1 block text-xs text-[var(--color-gray-500)]">A IA cria a descricao visagista para voce revisar.</span>
              </span>
            </button>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {activeCatalog.map((item) => (
                <article key={item.id} className="group relative overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-1)] shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
                  <button type="button" onClick={() => openEdit(item)} className="block w-full text-left focus-visible:shadow-focus">
                    <div className="aspect-[16/10] overflow-hidden bg-[var(--color-bg-muted)]">
                      {item.preview_url ? (
                        <img src={item.preview_url} alt={`Armacao ${item.product_code}`} className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transition-none" />
                      ) : (
                        <div className="grid h-full place-items-center text-[var(--color-gray-400)]"><Glasses className="h-8 w-8" /></div>
                      )}
                    </div>
                    <div className="p-4 pr-12">
                      <h3 className="truncate text-sm font-semibold text-[var(--color-gray-900)]">{item.product_code}</h3>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--color-gray-600)]">{item.recommendation_description}</p>
                    </div>
                  </button>
                  <button type="button" onClick={(event) => { event.stopPropagation(); void archiveItem(item); }} className="absolute bottom-3 right-3 rounded-full p-2 text-[var(--color-gray-400)] transition-colors hover:bg-[var(--color-error-50)] hover:text-[var(--color-error-600)] focus-visible:shadow-focus" aria-label={`Remover ${item.product_code}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {view === "create" ? (
        <div className="space-y-5 rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-4 shadow-sm sm:p-5">
          <button type="button" onClick={() => setView("catalog")} className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--color-gray-600)] hover:text-[var(--color-gray-900)] focus-visible:shadow-focus">
            <ArrowLeft className="h-4 w-4" /> Voltar ao catalogo
          </button>
          <div>
            <h3 className="text-base font-bold text-[var(--color-gray-900)]">Cadastrar nova armacao</h3>
            <p className="mt-1 text-sm text-[var(--color-gray-600)]">Informe o nome e envie uma foto nítida do oculos.</p>
          </div>
          <label className="block">
            <span className={labelClass}>Nome do oculos</span>
            <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex: Aurora Preto" autoFocus />
          </label>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => acceptFile(event.target.files?.[0] ?? null)} />
          <button type="button" onClick={() => fileInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop} className={cn("relative grid min-h-56 w-full place-items-center overflow-hidden rounded-[var(--radius-xl)] border border-dashed bg-[var(--color-bg-base)] p-5 text-center transition-all focus-visible:shadow-focus", file ? "border-[var(--color-primary-300)] shadow-inset" : "border-[var(--border-strong)] hover:border-[var(--color-primary-300)] hover:shadow-sm")}>
            {localPreview ? (
              <>
                <img src={localPreview} alt="Previa da armacao" className="absolute inset-0 h-full w-full object-contain p-3" />
                <span className="absolute bottom-3 left-3 right-3 rounded-[var(--radius-md)] bg-[var(--color-surface-overlay)] px-3 py-2 text-xs font-medium text-[var(--color-gray-700)] backdrop-blur-sm">{file?.name}</span>
              </>
            ) : (
              <span>
                <UploadCloud className="mx-auto h-8 w-8 text-[var(--color-primary-500)]" />
                <strong className="mt-3 block text-sm text-[var(--color-gray-900)]">Solte a imagem aqui ou clique para selecionar</strong>
                <span className="mt-1 block text-xs text-[var(--color-gray-500)]">JPG, PNG ou WebP de ate 10 MB</span>
              </span>
            )}
          </button>
          <div className="flex justify-end">
            <button type="button" disabled={!canContinue} onClick={() => void analyzeImage()} className={cn("inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] px-5 text-sm font-semibold shadow-sm transition-all focus-visible:shadow-focus disabled:cursor-not-allowed", canContinue ? "bg-[image:var(--gradient-orange-pink-electric)] text-white hover:-translate-y-0.5 hover:shadow-md" : "bg-[var(--color-bg-muted)] text-[var(--color-gray-900)] opacity-70")}>
              Continuar <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {view === "analyzing" ? (
        <div className="grid min-h-[420px] place-items-center rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-6 text-center shadow-sm">
          <div className="w-full max-w-md">
            <div className="relative mx-auto grid h-16 w-16 place-items-center rounded-[var(--radius-2xl)] bg-[image:var(--gradient-coral-pink)] text-white shadow-md">
              <BrainCircuit className="h-8 w-8" />
              <Sparkles className="absolute -right-2 -top-2 h-5 w-5 animate-pulse text-[var(--color-primary-500)] motion-reduce:animate-none" />
            </div>
            <h3 className="mt-5 text-lg font-bold text-[var(--color-gray-900)]">Analisando a armacao</h3>
            <p className="mt-2 min-h-10 text-sm leading-relaxed text-[var(--color-gray-600)]" aria-live="polite">{VISAGISM_THINKING_PHRASES[phraseIndex]}</p>
            <div className="mt-6 h-2 overflow-hidden rounded-full bg-[var(--color-bg-muted)] shadow-inset" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <div className="h-full rounded-full bg-[image:var(--gradient-orange-pink-electric)] transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-[var(--color-gray-500)]">{progress}% concluido</p>
          </div>
        </div>
      ) : null}

      {view === "review" || view === "edit" ? (
        <div className="space-y-5 rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-4 shadow-sm sm:p-5">
          <button type="button" onClick={() => setView(view === "edit" ? "catalog" : "create")} className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--color-gray-600)] hover:text-[var(--color-gray-900)] focus-visible:shadow-focus">
            <ArrowLeft className="h-4 w-4" /> {view === "edit" ? "Voltar ao catalogo" : "Voltar"}
          </button>
          <div className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-center">
            <div className="aspect-square overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-bg-muted)] shadow-inset">
              {preview ? <img src={preview} alt={`Armacao ${form.productName}`} className="h-full w-full object-contain p-2" /> : <div className="grid h-full place-items-center text-[var(--color-gray-400)]"><Glasses className="h-8 w-8" /></div>}
            </div>
            <div>
              <p className={sectionLabelClass}>{view === "edit" ? "Editar armacao" : "Analise concluida"}</p>
              <label className="mt-3 block">
                <span className={labelClass}>Nome do oculos</span>
                <input className={inputClass} value={form.productName} onChange={(event) => setForm({ ...form, productName: event.target.value })} />
              </label>
              <p className="mt-2 text-xs text-[var(--color-gray-500)]">Revise os dados identificados pela IA antes de salvar.</p>
            </div>
          </div>
          <EditFields form={form} onChange={setForm} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setView("catalog")} disabled={saving}>Cancelar</Button>
            <Button type="button" onClick={() => void saveCurrent()} disabled={saving || !form.productName.trim() || !form.description.trim()}>
              {saving ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}
              Salvar armacao
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
