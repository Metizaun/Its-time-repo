import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";
import { useLeadCsvImport } from "@/hooks/useLeadCsvImport";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { useCrmUsers } from "@/hooks/useCrmUsers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface LeadCsvImportModalProps {
  open: boolean;
  onClose: () => void;
}

function getStatusBadgeVariant(status: "valid" | "invalid" | "duplicate") {
  switch (status) {
    case "valid":
      return "default";
    case "duplicate":
      return "secondary";
    default:
      return "destructive";
  }
}

function getStatusLabel(status: "valid" | "invalid" | "duplicate") {
  switch (status) {
    case "valid":
      return "Valida";
    case "duplicate":
      return "Duplicada";
    default:
      return "Invalida";
  }
}

export function LeadCsvImportModal({ open, onClose }: LeadCsvImportModalProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [stageId, setStageId] = useState("");
  const [source, setSource] = useState("CSV Importado");
  const [ownerId, setOwnerId] = useState("");
  const { stages, loading: loadingStages } = usePipelineStages();
  const { users, loading: loadingUsers } = useCrmUsers();
  const {
    selectedFile,
    summary,
    previewRows,
    issueRows,
    parsing,
    importing,
    readyToImport,
    loadFile,
    importLeads,
    reset,
  } = useLeadCsvImport();

  const confirmedUsers = useMemo(() => users.filter((user) => !!user.id), [users]);
  const hasImportDependencies = stageId.length > 0 && ownerId.length > 0 && source.trim().length > 0;

  useEffect(() => {
    if (!open) {
      setIsDragging(false);
      setStageId("");
      setOwnerId("");
      setSource("CSV Importado");
      reset();
      return;
    }

    if (!stageId && stages.length > 0) {
      setStageId(stages[0].id);
    }

    if (!ownerId && confirmedUsers.length > 0) {
      setOwnerId(confirmedUsers[0].id);
    }
  }, [confirmedUsers, open, ownerId, reset, stageId, stages]);

  const handleSelectFile = async (file: File | null) => {
    if (!file) return;
    await loadFile(file);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);

    const file = event.dataTransfer.files?.[0] ?? null;
    await handleSelectFile(file);
  };

  const handleImport = async () => {
    const result = await importLeads({
      stageId,
      source: source.trim(),
      ownerId,
    });

    if (result.success) {
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] max-w-6xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>Importar leads por CSV</DialogTitle>
          <DialogDescription>
            Use o modelo oficial com as colunas <span className="font-medium text-foreground">nome, telefone, email, cidade, observacoes</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid flex-1 gap-6 overflow-hidden px-6 py-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="csv-stage">Etapa do funil</Label>
              <Select value={stageId} onValueChange={setStageId} disabled={loadingStages || importing}>
                <SelectTrigger id="csv-stage">
                  <SelectValue placeholder={loadingStages ? "Carregando etapas..." : "Selecione a etapa"} />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      {stage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="csv-source">Origem do lote</Label>
              <Input
                id="csv-source"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                disabled={importing}
                placeholder="CSV Importado"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="csv-owner">Responsavel</Label>
              <Select value={ownerId} onValueChange={setOwnerId} disabled={loadingUsers || importing}>
                <SelectTrigger id="csv-owner">
                  <SelectValue placeholder={loadingUsers ? "Carregando usuarios..." : "Selecione o responsavel"} />
                </SelectTrigger>
                <SelectContent>
                  {confirmedUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name || user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Arquivo CSV</Label>
              <div
                className={[
                  "rounded-lg border border-dashed p-5 transition-colors",
                  isDragging ? "border-primary bg-primary/5" : "border-border bg-muted/30",
                ].join(" ")}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                  setIsDragging(false);
                }}
                onDrop={handleDrop}
              >
                <button
                  type="button"
                  className="flex w-full flex-col items-center justify-center gap-3 text-center"
                  onClick={() => inputRef.current?.click()}
                  disabled={parsing || importing}
                >
                  {parsing ? (
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  ) : (
                    <Upload className="h-8 w-8 text-primary" />
                  )}
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {selectedFile ? selectedFile.name : "Arraste o CSV aqui ou clique para selecionar"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Apenas arquivos <span className="font-medium text-foreground">.csv</span> usando o modelo oficial.
                    </p>
                  </div>
                </button>

                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(event) => {
                    void handleSelectFile(event.target.files?.[0] ?? null);
                    event.currentTarget.value = "";
                  }}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Linhas recebidas</p>
                  <p className="mt-2 text-2xl font-semibold">{summary?.received ?? 0}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Validas</p>
                  <p className="mt-2 text-2xl font-semibold text-primary">{summary?.valid ?? 0}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Invalidas</p>
                  <p className="mt-2 text-2xl font-semibold text-destructive">{summary?.invalid ?? 0}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Duplicadas no arquivo</p>
                  <p className="mt-2 text-2xl font-semibold">{summary?.duplicatesInFile ?? 0}</p>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
            <Card className="min-h-0 flex-1">
              <CardContent className="flex h-full flex-col gap-4 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Preview da importacao</p>
                    <p className="text-xs text-muted-foreground">
                      Mostrando as primeiras linhas relevantes do arquivo carregado.
                    </p>
                  </div>

                  {summary ? (
                    <Badge variant="outline" className="gap-2 px-3 py-1">
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                      {summary.fileName}
                    </Badge>
                  ) : null}
                </div>

                <div className="min-h-0 rounded-md border">
                  <ScrollArea className="h-[320px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Linha</TableHead>
                          <TableHead>Nome</TableHead>
                          <TableHead>Telefone</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Cidade</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                              Carregue um arquivo para visualizar o preview.
                            </TableCell>
                          </TableRow>
                        ) : (
                          previewRows.map((row) => (
                            <TableRow key={`${row.rowNumber}-${row.telefone}`}>
                              <TableCell className="text-muted-foreground">{row.rowNumber}</TableCell>
                              <TableCell className="font-medium">{row.nome || "-"}</TableCell>
                              <TableCell>{row.telefone || "-"}</TableCell>
                              <TableCell>{row.email || "-"}</TableCell>
                              <TableCell>{row.cidade || "-"}</TableCell>
                              <TableCell>
                                <div className="flex flex-col gap-1">
                                  <Badge variant={getStatusBadgeVariant(row.status)} className="w-fit px-3 py-1">
                                    {getStatusLabel(row.status)}
                                  </Badge>
                                  {row.reason ? (
                                    <span className="text-xs text-muted-foreground">{row.reason}</span>
                                  ) : null}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  {issueRows.length > 0 ? (
                    <AlertCircle className="h-4 w-4 text-destructive" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                  )}
                  <p className="text-sm font-medium">Primeiros alertas</p>
                </div>

                {issueRows.length > 0 ? (
                  <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                    {issueRows.map((issue) => (
                      <li key={`${issue.rowNumber}-${issue.reason}`}>
                        Linha <span className="font-medium text-foreground">{issue.rowNumber}</span>: {issue.reason}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Nenhum problema encontrado no arquivo carregado ate agora.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={importing}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void handleImport()}
            disabled={!readyToImport || !hasImportDependencies || loadingStages || loadingUsers}
          >
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Importar CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
