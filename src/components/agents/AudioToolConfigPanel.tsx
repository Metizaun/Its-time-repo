import { useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { listAudioVoices, updateAgentTool, type AgentTool, type AudioVoice } from "@/services/agentToolsService";

type AudioToolConfigPanelProps = {
  agentId: string;
  tool: AgentTool;
  onClose: () => void;
  onChanged: () => void;
};

function voiceCategoryCopy(category: string | null) {
  if (category === "premade") return "Voz pronta para uso";
  if (category === "cloned") return "Voz personalizada";
  if (category === "generated") return "Voz criada para narracao";
  return null;
}

export function AudioToolConfigPanel({ agentId, tool, onClose, onChanged }: AudioToolConfigPanelProps) {
  const [query, setQuery] = useState("");
  const [voices, setVoices] = useState<AudioVoice[]>([]);
  const [selectedId, setSelectedId] = useState(typeof tool.config.voiceId === "string" ? tool.config.voiceId : "");
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function load(reset: boolean) {
    setError(false);
    if (reset) setLoading(true);
    try {
      const page = await listAudioVoices(agentId, { search: query, nextPageToken: reset ? null : nextPageToken });
      setVoices((current) => reset ? page.voices : [...current, ...page.voices]);
      setNextPageToken(page.nextPageToken);
      setHasMore(page.hasMore);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(true);
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
    // The initial catalogue is intentionally loaded once; searches are submitted explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  function togglePreview(voice: AudioVoice) {
    if (!voice.previewUrl) return;
    if (playingId === voice.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(voice.previewUrl);
    audioRef.current = audio;
    setPlayingId(voice.id);
    audio.addEventListener("ended", () => setPlayingId(null), { once: true });
    void audio.play().catch(() => {
      setPlayingId(null);
      toast.error("Nao foi possivel reproduzir esta amostra");
    });
  }

  async function save() {
    const selected = voices.find((voice) => voice.id === selectedId);
    if (!selectedId || (!selected?.previewUrl && selected)) {
      toast.error("Escolha uma voz disponivel antes de salvar");
      return;
    }
    setSaving(true);
    try {
      await updateAgentTool(agentId, "ai_audio", { config: { voiceId: selectedId } });
      toast.success("Voz salva. O Audio IA ja pode ser ativado quando estiver disponivel.");
      onChanged();
      onClose();
    } catch (error) {
      toast.error("Nao foi possivel salvar a voz", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-sm font-semibold text-[var(--color-gray-900)]">Escolha a voz do agente</p><p className="mt-1 text-xs text-[var(--color-gray-500)]">Escute as amostras e selecione uma voz antes de ativar.</p></div>
        <div className="flex w-full gap-2 sm:max-w-xs"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-gray-500)]" /><Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void load(true)} placeholder="Buscar vozes" className="pl-9" /></div><Button variant="outline" onClick={() => void load(true)}>Buscar</Button></div>
      </div>

      {loading ? <div className="flex h-32 items-center justify-center text-sm text-[var(--color-gray-500)]"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando vozes</div> : error ? <div className="flex h-32 flex-col items-center justify-center gap-2 text-center"><p className="text-sm text-[var(--color-gray-600)]">As vozes estao indisponiveis no momento.</p><Button variant="outline" size="sm" onClick={() => void load(true)}>Tentar novamente</Button></div> : <div className="mt-4 grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {voices.map((voice) => <div key={voice.id} className={cn("flex items-center gap-3 rounded-[var(--radius-lg)] border p-3 transition-all", selectedId === voice.id ? "border-[var(--color-primary-300)] bg-[var(--color-primary-50)] shadow-sm" : "border-[var(--border-default)]")}><Button type="button" variant="ghost" size="icon" disabled={!voice.previewUrl} onClick={() => togglePreview(voice)} aria-label={playingId === voice.id ? `Pausar ${voice.name}` : `Escutar ${voice.name}`}>{playingId === voice.id ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button><button type="button" disabled={!voice.previewUrl} onClick={() => setSelectedId(voice.id)} className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-50"><p className="truncate text-sm font-semibold text-[var(--color-gray-900)]">{voice.name}</p><p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-gray-500)]">{voice.description || voiceCategoryCopy(voice.category) || (voice.previewUrl ? "Amostra disponivel" : "Amostra indisponivel")}</p></button></div>)}
        {voices.length === 0 ? <p className="col-span-full py-8 text-center text-sm text-[var(--color-gray-500)]">Nenhuma voz encontrada.</p> : null}
      </div>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div>{hasMore ? <Button variant="ghost" size="sm" onClick={() => void load(false)}>Carregar mais</Button> : null}</div>
        <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button disabled={!selectedId || saving} onClick={() => void save()}>{saving ? "Salvando..." : "Salvar voz"}</Button></div>
      </div>
    </section>
  );
}
