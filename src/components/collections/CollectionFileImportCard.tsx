import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Play, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  createCollectionUpload,
  previewCollectionImport,
  publishCollectionImport,
  type CollectionImport,
  type CollectionSource,
} from "@/services/collectionsService";

const defaultMapping = {
  customerExternalId: "Identificador do cliente",
  customerName: "Nome do cliente",
  customerPhone: "Telefone",
  customerDocument: "Documento do cliente",
  creditorExternalId: "Identificador do credor",
  creditorName: "Nome do credor",
  receivableExternalId: "Identificador do título",
  receivableDescription: "Descrição do título",
  remainingAmount: "Saldo em aberto",
  originalAmount: "Valor original",
  currency: "Moeda",
  dueDate: "Data de vencimento",
  financialStatus: "Status financeiro",
  paymentMethod: "Forma de pagamento",
  pixKey: "Chave Pix",
  paymentUrl: "Link de pagamento",
};

type PreviewSummary = Record<string, unknown> & {
  totalRows?: number;
  validRows?: number;
  invalidRows?: number;
  errors?: Array<{ rowNumber?: number; message?: string }>;
};

type CollectionFileImportCardProps = {
  source: CollectionSource;
  imports: CollectionImport[];
  busy: string | null;
  autoFocus?: boolean;
  execute: (key: string, operation: () => Promise<unknown>, success: string) => Promise<boolean>;
  onClose: () => void;
};

export function CollectionFileImportCard({
  source,
  imports,
  busy,
  autoFocus = false,
  execute,
  onClose,
}: CollectionFileImportCardProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropzoneRef = useRef<HTMLButtonElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewSummary | null>(null);
  const [mode, setMode] = useState<"incremental" | "snapshot">("incremental");
  const [confirmValid, setConfirmValid] = useState(false);

  useEffect(() => {
    if (autoFocus) dropzoneRef.current?.focus();
  }, [autoFocus]);

  const isBusy = busy !== null;
  const canImport = source.status !== "paused" && source.status !== "disabled";
  const previewKey = `preview-import-${source.id}`;
  const publishKey = `publish-import-${source.id}`;
  const latestImport = imports.find((item) => item.source_connection_id === source.id);
  const invalidRows = Number(preview?.invalidRows ?? 0);

  const selectFile = (nextFile: File | null) => {
    if (!nextFile || !canImport) return;
    const fileName = nextFile.name.toLowerCase();
    if (!fileName.endsWith(".csv") && !fileName.endsWith(".xlsx")) {
      setFile(null);
      setImportId(null);
      setPreview(null);
      setConfirmValid(false);
      setFileError("Selecione um arquivo CSV ou XLSX usando o modelo oficial.");
      return;
    }
    if (nextFile.size > 20 * 1024 * 1024) {
      setFile(null);
      setImportId(null);
      setPreview(null);
      setConfirmValid(false);
      setFileError("O arquivo excede o limite de 20 MiB.");
      return;
    }
    setFile(nextFile);
    setFileError(null);
    setImportId(null);
    setPreview(null);
    setConfirmValid(false);
  };

  const handlePreview = async () => {
    if (!file || !canImport) return;
    await execute(previewKey, async () => {
      const intent = importId ? { importId } : await createCollectionUpload(file, source.id);
      setImportId(intent.importId);
      const result = await previewCollectionImport(intent.importId, {
        mapping: defaultMapping,
        defaults: { currency: "BRL" },
        headerRow: 1,
        dateFormat: "DD/MM/YYYY",
        decimalFormat: "pt-BR",
      });
      setPreview(result.preview as PreviewSummary);
    }, "Arquivo validado");
  };

  const handlePublish = async () => {
    if (!importId || !canImport) return;
    const succeeded = await execute(publishKey, () => publishCollectionImport(importId, {
      mode,
      confirmValidRowsOnly: confirmValid,
    }), "Importação enfileirada");
    if (!succeeded) return;
    setFile(null);
    setImportId(null);
    setPreview(null);
    setConfirmValid(false);
    onClose();
  };

  return (
    <div className="border-t border-[var(--border-default)] bg-[var(--color-surface-2)] px-5 pb-5 pt-4 sm:px-6" aria-live="polite">
      <div className="space-y-3">
        <div
          className={`rounded-[var(--radius-lg)] border border-dashed p-2 transition-colors sm:p-3 ${
            isDragging
              ? "border-[var(--color-primary-300)] bg-[var(--color-primary-50)]"
              : "border-[var(--border-default)] bg-[var(--color-surface-1)]"
          }`}
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
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            selectFile(event.dataTransfer.files?.[0] ?? null);
          }}
        >
          <button
            ref={dropzoneRef}
            type="button"
            className="flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-primary-50)] focus-visible:outline-none focus-visible:shadow-focus"
            onClick={() => inputRef.current?.click()}
            disabled={isBusy || !canImport}
          >
            {busy === previewKey ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[var(--color-primary-500)]" /> : <Upload className="h-5 w-5 shrink-0 text-[var(--color-primary-500)]" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-[var(--color-gray-700)]">
                {file ? file.name : "Selecionar arquivo CSV ou XLSX"}
              </span>
              <span className="mt-0.5 block truncate text-xs text-[var(--color-gray-500)]">
                Arraste aqui ou clique para selecionar · modelo oficial
              </span>
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            aria-label="Selecionar arquivo CSV ou XLSX"
            onChange={(event) => {
              selectFile(event.target.files?.[0] ?? null);
              event.currentTarget.value = "";
            }}
          />
        </div>

        {fileError ? <p role="alert" className="text-sm text-[var(--color-error-600)]">{fileError}</p> : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-[var(--color-gray-500)]">Limite de 20 MiB</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" onClick={() => void handlePreview()} disabled={!file || isBusy || !canImport} className="shadow-primary">
              {busy === previewKey ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}Validar arquivo
            </Button>
          </div>
        </div>
      </div>

      {!canImport ? <p className="mt-4 text-sm text-[var(--color-warning-600)]">Retome a fonte para iniciar uma nova importação.</p> : null}

      {latestImport && !preview ? (
        <p className="mt-4 text-xs text-[var(--color-gray-500)]">
          Última importação: <span className="font-medium text-[var(--color-gray-700)]">{latestImport.original_file_name}</span> · {latestImport.status}
        </p>
      ) : null}

      {preview ? (
        <div className="mt-5 rounded-[var(--radius-xl)] bg-[var(--color-surface-1)] p-5 shadow-inset">
          <div className="grid gap-3 sm:grid-cols-3">
            <div><p className="font-mono text-xs uppercase text-[var(--color-gray-500)]">Linhas</p><p className="mt-1 text-xl font-bold text-[var(--color-gray-900)]">{String(preview.totalRows ?? 0)}</p></div>
            <div><p className="font-mono text-xs uppercase text-[var(--color-gray-500)]">Válidas</p><p className="mt-1 text-xl font-bold text-[var(--color-success-600)]">{String(preview.validRows ?? 0)}</p></div>
            <div><p className="font-mono text-xs uppercase text-[var(--color-gray-500)]">Inválidas</p><p className="mt-1 text-xl font-bold text-[var(--color-error-600)]">{String(preview.invalidRows ?? 0)}</p></div>
          </div>

          {invalidRows > 0 ? (
            <div role="alert" className="mt-4 rounded-[var(--radius-lg)] border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-3 text-sm text-[var(--color-error-600)]">
              O arquivo possui linhas fora do modelo oficial. Revise o arquivo antes de publicar.
              {preview.errors?.[0]?.message ? <span className="mt-1 block text-xs">{preview.errors[0].message}</span> : null}
            </div>
          ) : null}

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-44 space-y-2">
              <Label htmlFor={`collection-publish-mode-${source.id}`}>Publicação</Label>
              <Select value={mode} onValueChange={(value) => setMode(value as typeof mode)} disabled={isBusy}>
                <SelectTrigger id={`collection-publish-mode-${source.id}`}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="incremental">Incremental</SelectItem><SelectItem value="snapshot">Snapshot integral</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-3 sm:items-end">
              {mode === "incremental" && invalidRows > 0 ? <label className="flex items-center gap-2 text-sm text-[var(--color-gray-700)]"><Checkbox checked={confirmValid} onCheckedChange={(value) => setConfirmValid(value === true)} disabled={isBusy} />Confirmo publicar apenas linhas válidas</label> : null}
              <Button type="button" onClick={() => void handlePublish()} disabled={!importId || !canImport || isBusy || (mode === "snapshot" && invalidRows > 0) || (mode === "incremental" && invalidRows > 0 && !confirmValid)} className="shadow-primary">
                {busy === publishKey ? <Loader2 className="animate-spin" /> : <Play />}Publicar
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
