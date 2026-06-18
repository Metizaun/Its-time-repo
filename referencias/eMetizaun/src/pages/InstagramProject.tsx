import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, FileText, Loader2, PlayCircle, Sparkles } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

import { useInstagramInsights } from "@/features/instagram-analyzer/hooks/useInstagramInsights";
import {
  useInstagramProjects,
  type ResearchProjectDetail,
  type ResearchSavedItemView,
} from "@/features/instagram-analyzer/hooks/useInstagramProjects";
import type {
  InstagramInsightsFocus,
} from "@/features/instagram-analyzer/types";

const INSIGHTS_FOCUS_OPTIONS: Array<{ value: InstagramInsightsFocus; label: string }> = [
  { value: "posicionamento", label: "Posicionamento" },
  { value: "conteudo", label: "Conteudo" },
  { value: "copy", label: "Copy" },
  { value: "formato_video", label: "Formato de video" },
];

export default function InstagramProject() {
  const { projectId } = useParams<{ projectId: string }>();
  const { toast } = useToast();

  const { fetchProjectDetail, createDocument, updateDocument } = useInstagramProjects();
  const { generateInsights, improveScript, insightsLoading, scriptLoading } = useInstagramInsights();

  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<ResearchProjectDetail | null>(null);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [docTitle, setDocTitle] = useState("");
  const [docContent, setDocContent] = useState("");
  const [savingDoc, setSavingDoc] = useState(false);
  const [focus, setFocus] = useState<InstagramInsightsFocus>("posicionamento");
  const [originalScript, setOriginalScript] = useState("");
  const [improvementGoal, setImprovementGoal] = useState("");
  const [scriptResult, setScriptResult] = useState<{ improvedScript: string; rationale: string } | null>(null);
  const [selectedSavedItem, setSelectedSavedItem] = useState<ResearchSavedItemView | null>(null);
  const [modalScriptBase, setModalScriptBase] = useState("");
  const [modalScriptGoal, setModalScriptGoal] = useState("");
  const [modalScriptResult, setModalScriptResult] = useState<{ improvedScript: string; rationale: string } | null>(null);

  const activeDocument = useMemo(
    () => detail?.documents.find((doc) => doc.id === activeDocId) || null,
    [activeDocId, detail?.documents],
  );

  const loadProject = useCallback(async () => {
    if (!projectId) return;

    setLoading(true);
    try {
      const loaded = await fetchProjectDetail(projectId);
      setDetail(loaded);

      if (!activeDocId && loaded.documents.length) {
        const firstDoc = loaded.documents[0];
        setActiveDocId(firstDoc.id);
        setDocTitle(firstDoc.title);
        setDocContent(firstDoc.content_md || "");
      } else if (!loaded.documents.length) {
        setActiveDocId(null);
        setDocTitle("");
        setDocContent("");
      }
    } catch (error) {
      toast({
        title: "Falha ao carregar projeto",
        description: error instanceof Error ? error.message : "Nao foi possivel carregar o projeto.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [activeDocId, fetchProjectDetail, projectId, toast]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  useEffect(() => {
    if (!activeDocument) {
      return;
    }

    setDocTitle(activeDocument.title);
    setDocContent(activeDocument.content_md || "");
  }, [activeDocument]);

  useEffect(() => {
    if (!selectedSavedItem) return;
    setModalScriptBase(selectedSavedItem.item.caption || "");
    setModalScriptGoal("");
    setModalScriptResult(null);
  }, [selectedSavedItem]);

  const handleSaveDocument = async () => {
    if (!activeDocId) {
      return;
    }

    setSavingDoc(true);
    try {
      await updateDocument(activeDocId, {
        title: docTitle,
        content_md: docContent,
      });
      await loadProject();
      toast({
        title: "Documento salvo",
        description: "As alteracoes foram persistidas.",
      });
    } catch (error) {
      toast({
        title: "Falha ao salvar documento",
        description: error instanceof Error ? error.message : "Nao foi possivel salvar o documento.",
        variant: "destructive",
      });
    } finally {
      setSavingDoc(false);
    }
  };

  const handleCreateNotesDocument = async () => {
    if (!projectId) {
      return;
    }

    try {
      const created = await createDocument(projectId, {
        title: `Notas ${new Date().toLocaleDateString("pt-BR")}`,
        docType: "notes",
        contentMd: "",
      });
      await loadProject();
      setActiveDocId(created.id);
      setDocTitle(created.title);
      setDocContent(created.content_md || "");
    } catch (error) {
      toast({
        title: "Falha ao criar documento",
        description: error instanceof Error ? error.message : "Nao foi possivel criar documento de notas.",
        variant: "destructive",
      });
    }
  };

  const handleGenerateInsights = async () => {
    if (!projectId) return;

    try {
      const result = await generateInsights({
        projectId,
        focus,
      });
      await loadProject();
      setActiveDocId(result.analysisDocumentId);
      setDocContent(result.analysisText);
      toast({
        title: "Analise gerada",
        description: "Documento de analise posicional criado no projeto.",
      });
    } catch (error) {
      toast({
        title: "Falha ao gerar analise",
        description: error instanceof Error ? error.message : "Nao foi possivel gerar insights.",
        variant: "destructive",
      });
    }
  };

  const handleImproveScript = async () => {
    if (!projectId || !originalScript.trim()) {
      return;
    }

    try {
      const result = await improveScript({
        projectId,
        originalScript: originalScript.trim(),
        improvementGoal: improvementGoal.trim(),
      });
      setScriptResult(result);
      await loadProject();
      toast({
        title: "Roteiro melhorado",
        description: "Versao otimizada gerada e salva nos arquivos do projeto.",
      });
    } catch (error) {
      toast({
        title: "Falha ao melhorar roteiro",
        description: error instanceof Error ? error.message : "Nao foi possivel otimizar o roteiro.",
        variant: "destructive",
      });
    }
  };

  const handleImproveScriptFromModal = async () => {
    if (!projectId || !selectedSavedItem || !modalScriptBase.trim()) {
      return;
    }

    try {
      const result = await improveScript({
        projectId,
        originalScript: modalScriptBase.trim(),
        improvementGoal: modalScriptGoal.trim(),
      });
      setModalScriptResult(result);
      await loadProject();
      toast({
        title: "Roteiro melhorado",
        description: "Versao otimizada gerada e salva nos arquivos do projeto.",
      });
    } catch (error) {
      toast({
        title: "Falha ao melhorar roteiro",
        description: error instanceof Error ? error.message : "Nao foi possivel otimizar o roteiro.",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Projeto nao encontrado.</p>
        <Button asChild variant="outline" size="sm">
          <Link to="/instagram-analyzer">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar ao Analyzer
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">{detail.project.name}</h1>
          <p className="text-xs text-muted-foreground">
            Competidor: @{detail.project.competitor_username}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/instagram-analyzer">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Link>
        </Button>
      </header>

      <Tabs defaultValue="posts" className="flex h-full min-h-0 flex-col">
        <TabsList className="w-fit">
          <TabsTrigger value="posts">Posts</TabsTrigger>
          <TabsTrigger value="files">Arquivos</TabsTrigger>
        </TabsList>

        <TabsContent value="posts" className="mt-4 h-full min-h-0">
          <ScrollArea className="h-full rounded-lg border bg-card">
            <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {!detail.savedItems.length ? (
                <div className="col-span-full rounded-lg border border-dashed p-8 text-center">
                  <p className="text-sm font-medium">Nenhum post salvo</p>
                  <p className="text-xs text-muted-foreground">
                    Volte para o Scrap Page e selecione fotos/reels para este projeto.
                  </p>
                </div>
              ) : null}

              {detail.savedItems.map((saved) => (
                <Card
                  key={saved.relationId}
                  className="overflow-hidden transition hover:bg-muted/20"
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">{saved.item.type === "reel" ? "Reel" : "Foto"}</CardTitle>
                      <Badge variant="outline">{saved.item.type}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3" onClick={() => setSelectedSavedItem(saved)}>
                    <button type="button" className="w-full text-left">
                      {saved.item.thumbnail_url || saved.item.display_url ? (
                        <img
                          src={saved.item.thumbnail_url || saved.item.display_url || ""}
                          alt={saved.item.caption?.slice(0, 30) || saved.item.permalink}
                          className="h-48 w-full rounded-md object-cover"
                        />
                      ) : (
                        <div className="flex h-48 items-center justify-center rounded-md border bg-muted/30 text-xs text-muted-foreground">
                          Sem preview
                        </div>
                      )}
                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                        <div className="rounded bg-muted/30 px-2 py-1">Likes: {saved.item.likes_count || 0}</div>
                        <div className="rounded bg-muted/30 px-2 py-1">Coms: {saved.item.comments_count || 0}</div>
                        <div className="rounded bg-muted/30 px-2 py-1">Views: {saved.item.views_count || 0}</div>
                      </div>
                    </button>
                    <Button asChild size="sm" variant="outline" className="w-full">
                      <a
                        href={saved.item.permalink}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Abrir post
                      </a>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="files" className="mt-4 h-full min-h-0">
          <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <Card className="h-full min-h-0 overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Documentos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button variant="outline" className="w-full" onClick={() => void handleCreateNotesDocument()}>
                  <FileText className="mr-2 h-4 w-4" />
                  Nova nota
                </Button>

                <div className="space-y-2">
                  <Label>Gerar analise posicional</Label>
                  <Select value={focus} onValueChange={(value) => setFocus(value as InstagramInsightsFocus)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INSIGHTS_FOCUS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button className="w-full" onClick={() => void handleGenerateInsights()} disabled={insightsLoading}>
                    {insightsLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="mr-2 h-4 w-4" />
                    )}
                    Gerar analise
                  </Button>
                </div>

                <ScrollArea className="h-[calc(100vh-520px)]">
                  <div className="space-y-2 pr-2">
                    {detail.documents.map((doc) => (
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => setActiveDocId(doc.id)}
                        className={`w-full rounded-lg border px-3 py-2 text-left ${
                          doc.id === activeDocId ? "border-primary bg-primary/5" : "hover:bg-muted/20"
                        }`}
                      >
                        <p className="truncate text-sm font-medium">{doc.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {doc.doc_type} • {new Date(doc.updated_at).toLocaleDateString("pt-BR")}
                        </p>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <div className="grid h-full min-h-0 gap-4">
              <Card className="h-full min-h-0 overflow-hidden">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Editor de documentos</CardTitle>
                </CardHeader>
                <CardContent className="flex h-full min-h-0 flex-col gap-3">
                  <Input
                    placeholder="Titulo do documento"
                    value={docTitle}
                    onChange={(event) => setDocTitle(event.target.value)}
                    disabled={!activeDocId}
                  />
                  <Textarea
                    className="h-full min-h-[320px] resize-none"
                    placeholder="Conteudo markdown do documento"
                    value={docContent}
                    onChange={(event) => setDocContent(event.target.value)}
                    disabled={!activeDocId}
                  />
                  <div className="flex justify-end">
                    <Button onClick={() => void handleSaveDocument()} disabled={!activeDocId || savingDoc}>
                      {savingDoc ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Salvar documento
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Melhorar roteiro com IA</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Textarea
                    placeholder="Cole aqui o roteiro original"
                    value={originalScript}
                    onChange={(event) => setOriginalScript(event.target.value)}
                    rows={4}
                  />
                  <Input
                    placeholder="O que deseja melhorar no roteiro?"
                    value={improvementGoal}
                    onChange={(event) => setImprovementGoal(event.target.value)}
                  />
                  <Button onClick={() => void handleImproveScript()} disabled={scriptLoading || !originalScript.trim()}>
                    {scriptLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    Melhorar roteiro
                  </Button>
                  {scriptResult ? (
                    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                      <p className="text-xs font-medium">Resultado</p>
                      <pre className="whitespace-pre-wrap text-xs">{scriptResult.improvedScript}</pre>
                      <p className="text-xs text-muted-foreground">{scriptResult.rationale}</p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Chat de IA (placeholder)</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    Placeholder pronto. O chat atual sera transportado para este modulo em fase posterior.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(selectedSavedItem)} onOpenChange={(open) => !open && setSelectedSavedItem(null)}>
        <DialogContent className="max-h-[90vh] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {selectedSavedItem?.item.type === "reel" ? "Detalhes do reel salvo" : "Detalhes do post salvo"}
            </DialogTitle>
          </DialogHeader>

          <ScrollArea className="max-h-[75vh] pr-2">
            {selectedSavedItem ? (
              <div className="space-y-4">
                <div className="overflow-hidden rounded-lg border">
                  {selectedSavedItem.item.type === "reel" && selectedSavedItem.item.video_url ? (
                    <video src={selectedSavedItem.item.video_url} controls className="h-full w-full" />
                  ) : selectedSavedItem.item.thumbnail_url || selectedSavedItem.item.display_url ? (
                    <AspectRatio ratio={4 / 5}>
                      <img
                        src={selectedSavedItem.item.thumbnail_url || selectedSavedItem.item.display_url || ""}
                        alt={selectedSavedItem.item.caption?.slice(0, 40) || selectedSavedItem.item.permalink}
                        className="h-full w-full object-cover"
                      />
                    </AspectRatio>
                  ) : (
                    <div className="flex h-64 items-center justify-center bg-muted text-sm text-muted-foreground">
                      Sem preview disponivel
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded bg-muted/30 px-2 py-1">Likes: {selectedSavedItem.item.likes_count || 0}</div>
                  <div className="rounded bg-muted/30 px-2 py-1">Comentarios: {selectedSavedItem.item.comments_count || 0}</div>
                  <div className="rounded bg-muted/30 px-2 py-1">Views: {selectedSavedItem.item.views_count || 0}</div>
                </div>

                <div className="space-y-2 rounded-lg border p-3">
                  <p className="text-xs font-medium text-muted-foreground">Legenda</p>
                  <p className="whitespace-pre-wrap text-sm">{selectedSavedItem.item.caption || "Sem legenda coletada."}</p>
                </div>

                <Button asChild size="sm" variant="outline">
                  <a href={selectedSavedItem.item.permalink} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Abrir no Instagram
                  </a>
                </Button>

                {selectedSavedItem.item.type === "reel" ? (
                  <div className="space-y-3 rounded-lg border bg-muted/10 p-4">
                    <div className="flex items-center gap-2">
                      <PlayCircle className="h-4 w-4" />
                      <p className="text-sm font-medium">Gerar roteiro para este reel</p>
                    </div>
                    <Textarea
                      placeholder="Base do roteiro (pode editar a legenda ou colar texto base)"
                      value={modalScriptBase}
                      onChange={(event) => setModalScriptBase(event.target.value)}
                      rows={4}
                    />
                    <Input
                      placeholder="O que deseja melhorar neste roteiro?"
                      value={modalScriptGoal}
                      onChange={(event) => setModalScriptGoal(event.target.value)}
                    />
                    <Button
                      onClick={() => void handleImproveScriptFromModal()}
                      disabled={scriptLoading || !modalScriptBase.trim()}
                    >
                      {scriptLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                      Gerar roteiro
                    </Button>
                    {modalScriptResult ? (
                      <div className="space-y-2 rounded-lg border bg-background p-3">
                        <p className="text-xs font-medium">Roteiro gerado</p>
                        <pre className="whitespace-pre-wrap text-xs">{modalScriptResult.improvedScript}</pre>
                        <p className="text-xs text-muted-foreground">{modalScriptResult.rationale}</p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
