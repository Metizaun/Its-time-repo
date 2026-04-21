import { useCallback, useMemo, useState } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { notifyLeadsUpdated } from "@/hooks/useLeads";

const REQUIRED_HEADERS = ["nome", "telefone"] as const;
const PREVIEW_LIMIT = 8;
const ISSUE_LIMIT = 8;

export interface LeadCsvImportRow {
  nome: string;
  telefone: string;
  email?: string;
  cidade?: string;
  observacoes?: string;
}

export interface LeadCsvPreviewRow extends LeadCsvImportRow {
  rowNumber: number;
  normalizedPhone: string | null;
  status: "valid" | "invalid" | "duplicate";
  reason: string | null;
}

export interface LeadCsvImportSummary {
  fileName: string;
  received: number;
  valid: number;
  invalid: number;
  duplicatesInFile: number;
}

export interface LeadCsvImportIssue {
  rowNumber: number;
  reason: string;
}

interface ImportLeadsCsvResponse {
  totals?: {
    received: number;
    valid: number;
    inserted: number;
    duplicatesInDatabase: number;
    invalid: number;
  };
  invalidRows?: Array<{ rowNumber: number; reason: string }>;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado";
}

function normalizeHeader(value: string) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_-]+/g, "")
    .trim()
    .toLowerCase();
}

function normalizeTextCell(value: unknown) {
  return String(value ?? "").trim();
}

function normalizePhone(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const normalized = raw.replace(/[^\d+]/g, "");
  return normalized.length > 0 ? normalized : null;
}

function isCsvFile(file: File) {
  return file.name.toLowerCase().endsWith(".csv");
}

function parseCsvFile(file: File) {
  return new Promise<Papa.ParseResult<Record<string, string>>>((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: false,
      transformHeader: (header) => normalizeHeader(header),
      complete: (results) => resolve(results),
      error: (error) => reject(error),
    });
  });
}

async function callImportLeadsCsvFunction(
  body: {
    rows: LeadCsvImportRow[];
    importOptions: { stageId: string; source: string; ownerId: string };
  }
) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new Error(sessionError.message || "Nao foi possivel validar a sessao");
  }

  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    throw new Error("Sessao expirada. Faca login novamente.");
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Configuracao do Supabase ausente no frontend");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/import-leads-csv`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const backendMessage =
      typeof data?.error === "string"
        ? data.error
        : typeof data?.message === "string"
          ? data.message
          : null;

    throw new Error(backendMessage ?? `Erro ao importar CSV (${response.status})`);
  }

  return (data ?? {}) as ImportLeadsCsvResponse;
}

export function useLeadCsvImport() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<LeadCsvImportSummary | null>(null);
  const [previewRows, setPreviewRows] = useState<LeadCsvPreviewRow[]>([]);
  const [issueRows, setIssueRows] = useState<LeadCsvImportIssue[]>([]);
  const [validRows, setValidRows] = useState<LeadCsvImportRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);

  const reset = useCallback(() => {
    setSelectedFile(null);
    setSummary(null);
    setPreviewRows([]);
    setIssueRows([]);
    setValidRows([]);
    setParsing(false);
    setImporting(false);
  }, []);

  const loadFile = useCallback(async (file: File) => {
    if (!isCsvFile(file)) {
      toast.error("Arquivo invalido", {
        description: "Envie um arquivo .csv usando o modelo oficial.",
      });
      reset();
      return { success: false };
    }

    setParsing(true);

    try {
      const results = await parseCsvFile(file);
      const headers = (results.meta.fields ?? []).map((field) => normalizeHeader(field));
      const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header));

      if (missingHeaders.length > 0) {
        throw new Error(
          `Cabecalhos obrigatorios ausentes: ${missingHeaders.join(", ")}. Use o modelo oficial.`
        );
      }

      const nextPreviewRows: LeadCsvPreviewRow[] = [];
      const nextIssueRows: LeadCsvImportIssue[] = [];
      const nextValidRows: LeadCsvImportRow[] = [];
      const seenPhones = new Set<string>();
      let receivedCount = 0;
      let invalidCount = 0;
      let duplicatesInFile = 0;

      results.data.forEach((row, index) => {
        const nome = normalizeTextCell(row.nome);
        const telefoneOriginal = normalizeTextCell(row.telefone);
        const email = normalizeTextCell(row.email);
        const cidade = normalizeTextCell(row.cidade);
        const observacoes = normalizeTextCell(row.observacoes);
        const rowNumber = index + 2;

        const isEmptyRow = !nome && !telefoneOriginal && !email && !cidade && !observacoes;
        if (isEmptyRow) {
          return;
        }

        receivedCount += 1;
        const normalizedPhone = normalizePhone(telefoneOriginal);

        let status: LeadCsvPreviewRow["status"] = "valid";
        let reason: string | null = null;

        if (!nome && !normalizedPhone) {
          status = "invalid";
          reason = "Linha sem nome e telefone.";
        } else if (!nome) {
          status = "invalid";
          reason = "Nome obrigatorio.";
        } else if (!normalizedPhone) {
          status = "invalid";
          reason = "Telefone obrigatorio ou invalido.";
        } else if (seenPhones.has(normalizedPhone)) {
          status = "duplicate";
          reason = "Telefone duplicado dentro do arquivo.";
        }

        const previewRow: LeadCsvPreviewRow = {
          rowNumber,
          nome,
          telefone: telefoneOriginal,
          email: email || undefined,
          cidade: cidade || undefined,
          observacoes: observacoes || undefined,
          normalizedPhone,
          status,
          reason,
        };

        if (nextPreviewRows.length < PREVIEW_LIMIT) {
          nextPreviewRows.push(previewRow);
        }

        if (status === "invalid") {
          invalidCount += 1;
          if (nextIssueRows.length < ISSUE_LIMIT && reason) {
            nextIssueRows.push({ rowNumber, reason });
          }
          return;
        }

        if (status === "duplicate") {
          duplicatesInFile += 1;
          if (nextIssueRows.length < ISSUE_LIMIT && reason) {
            nextIssueRows.push({ rowNumber, reason });
          }
          return;
        }

        seenPhones.add(normalizedPhone);
        nextValidRows.push({
          nome,
          telefone: normalizedPhone,
          email: email || undefined,
          cidade: cidade || undefined,
          observacoes: observacoes || undefined,
        });
      });

      setSelectedFile(file);
      setSummary({
        fileName: file.name,
        received: receivedCount,
        valid: nextValidRows.length,
        invalid: invalidCount,
        duplicatesInFile,
      });
      setPreviewRows(nextPreviewRows);
      setIssueRows(nextIssueRows);
      setValidRows(nextValidRows);

      if (receivedCount === 0 || nextValidRows.length === 0) {
        toast.error("CSV vazio", {
          description: "Nenhuma linha valida foi encontrada no arquivo enviado.",
        });
      } else {
        toast.success("CSV carregado", {
          description: `${nextValidRows.length} linha(s) pronta(s) para importar.`,
        });
      }

      return { success: true };
    } catch (error: unknown) {
      console.error("Erro ao processar CSV:", error);
      toast.error("Erro ao processar CSV", {
        description: getErrorMessage(error) || "Nao foi possivel ler o arquivo informado.",
      });
      reset();
      return { success: false, error };
    } finally {
      setParsing(false);
    }
  }, [reset]);

  const importLeads = useCallback(async (options: { stageId: string; source: string; ownerId: string }) => {
    if (!summary || validRows.length === 0) {
      toast.error("Nenhum lead pronto para importar", {
        description: "Carregue um CSV valido antes de continuar.",
      });
      return { success: false };
    }

    setImporting(true);

    try {
      const data = await callImportLeadsCsvFunction({
        rows: validRows,
        importOptions: options,
      });

      notifyLeadsUpdated();

      const inserted = data.totals?.inserted ?? 0;
      const duplicates = data.totals?.duplicatesInDatabase ?? 0;
      toast.success("Importacao concluida", {
        description: `${inserted} lead(s) inserido(s), ${duplicates} duplicata(s) ignorada(s) na base.`,
      });

      return { success: true, data };
    } catch (error: unknown) {
      console.error("Erro ao importar leads:", error);
      toast.error("Erro ao importar leads", {
        description: getErrorMessage(error) || "Nao foi possivel concluir a importacao.",
      });
      return { success: false, error };
    } finally {
      setImporting(false);
    }
  }, [summary, validRows]);

  const readyToImport = useMemo(() => validRows.length > 0 && !parsing && !importing, [importing, parsing, validRows.length]);

  return {
    selectedFile,
    summary,
    previewRows,
    issueRows,
    validRows,
    parsing,
    importing,
    readyToImport,
    loadFile,
    importLeads,
    reset,
  };
}
