import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import type { SupabaseClient } from "@supabase/supabase-js";
import { parse } from "csv-parse";
import readXlsxFile from "read-excel-file/node";

import {
  type CanonicalIngestionEnvelope,
  type CanonicalReceivable,
  CollectionValidationError,
  validateCanonicalReceivable,
} from "./domain.js";
import { CollectionIngestionService } from "./ingestion-service.js";
import { FileCollectionAdapter } from "./adapters/file-adapter.js";

const BUCKET = "collection-imports";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 50_000;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ALLOWED_MIME_TYPES = new Set(["text/csv", "application/csv", "text/plain", XLSX_MIME]);

export type SpreadsheetMapping = {
  customerExternalId: string;
  customerName: string;
  customerPhone: string;
  customerDocument?: string;
  customerEmail?: string;
  creditorExternalId?: string;
  creditorName?: string;
  creditorDocument?: string;
  receivableExternalId: string;
  receivableDescription?: string;
  originalAmount?: string;
  remainingAmount: string;
  currency?: string;
  dueDate: string;
  financialStatus: string;
  paymentMethod?: string;
  pixKey?: string;
  paymentUrl?: string;
};

export type SpreadsheetDefaults = {
  creditorExternalId?: string;
  creditorName?: string;
  creditorDocument?: string;
  currency?: string;
  paymentMethod?: string;
};

type ParseOptions = {
  fileKind: "csv" | "xlsx";
  sheetName?: string | null;
  headerRow?: number;
  dateFormat?: "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY";
  decimalFormat?: "pt-BR" | "en-US";
};

type ImportRow = Record<string, unknown>;

function normalizeHeader(value: unknown) {
  return String(value ?? "").trim();
}

function assertFileSignature(buffer: Buffer, fileKind: "csv" | "xlsx") {
  if (fileKind === "xlsx") {
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      throw new CollectionValidationError("Arquivo XLSX invalido", "invalid_file_signature");
    }
    return;
  }
  if (buffer.includes(0)) {
    throw new CollectionValidationError("CSV contem dados binarios", "invalid_file_signature");
  }
}

async function parseCsv(buffer: Buffer, headerRow: number) {
  const allRows: unknown[][] = [];
  const parser = Readable.from(buffer).pipe(parse({
    bom: true,
    delimiter: [",", ";", "\t"],
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  }));
  for await (const row of parser) {
    allRows.push(row as unknown[]);
    if (allRows.length > MAX_ROWS + headerRow) {
      throw new CollectionValidationError(`Arquivo excede ${MAX_ROWS} linhas`, "row_limit");
    }
  }
  return allRows;
}

async function parseXlsx(buffer: Buffer, sheetName: string | null | undefined) {
  const workbook = await readXlsxFile(buffer);
  const sheets = workbook.map((entry) => entry.sheet);
  if (sheets.length === 0) throw new CollectionValidationError("Planilha sem abas", "empty_workbook");
  const selectedSheet = sheetName || sheets[0];
  const selected = workbook.find((entry) => entry.sheet === selectedSheet);
  if (!selected) {
    throw new CollectionValidationError("Aba selecionada nao existe", "sheet_not_found", "sheetName");
  }
  const rows = selected.data;
  if (rows.length > MAX_ROWS + 10) {
    throw new CollectionValidationError(`Arquivo excede ${MAX_ROWS} linhas`, "row_limit");
  }
  return { rows: rows as unknown[][], sheets, selectedSheet };
}

export async function parseCollectionSpreadsheet(buffer: Buffer, options: ParseOptions) {
  assertFileSignature(buffer, options.fileKind);
  const headerRow = Math.max(1, options.headerRow ?? 1);
  const parsed = options.fileKind === "csv"
    ? { rows: await parseCsv(buffer, headerRow), sheets: [] as string[], selectedSheet: null }
    : await parseXlsx(buffer, options.sheetName);
  if (parsed.rows.length < headerRow) {
    throw new CollectionValidationError("Arquivo nao possui a linha de cabecalho", "header_not_found");
  }
  const headers = parsed.rows[headerRow - 1].map(normalizeHeader);
  if (headers.some((header) => !header)) {
    throw new CollectionValidationError("Cabecalho possui coluna vazia", "empty_header");
  }
  if (new Set(headers.map((header) => header.toLowerCase())).size !== headers.length) {
    throw new CollectionValidationError("Cabecalho possui colunas duplicadas", "duplicate_header");
  }
  const rows = parsed.rows.slice(headerRow).map((row) => Object.fromEntries(
    headers.map((header, index) => [header, row[index] ?? null])
  ));
  return { headers, rows, sheets: parsed.sheets, selectedSheet: parsed.selectedSheet };
}

function cell(row: ImportRow, column: string | undefined, fallback?: unknown) {
  if (!column) return fallback;
  const value = row[column];
  return value === undefined || value === null || String(value).trim() === "" ? fallback : value;
}

function decimalValue(value: unknown, format: ParseOptions["decimalFormat"]) {
  if (typeof value === "number") return value.toFixed(2);
  let text = String(value ?? "").trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (format === "pt-BR") text = text.replace(/\./g, "").replace(",", ".");
  else text = text.replace(/,/g, "");
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) return text;
  return number.toFixed(2);
}

function dateValue(value: unknown, format: ParseOptions["dateFormat"]) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parts = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!parts) return text;
  const month = format === "MM/DD/YYYY" ? parts[1] : parts[2];
  const day = format === "MM/DD/YYYY" ? parts[2] : parts[1];
  return `${parts[3]}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function financialStatus(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  const aliases: Record<string, string> = {
    aberto: "open", open: "open", pendente: "open",
    pago: "settled", quitado: "settled", settled: "settled",
    cancelado: "cancelled", cancelled: "cancelled", canceled: "cancelled",
    suspenso: "suspended", suspended: "suspended",
    desconhecido: "unknown", unknown: "unknown",
  };
  return aliases[normalized] ?? normalized;
}

function paymentMethod(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  const aliases: Record<string, string> = {
    pix: "pix", boleto: "boleto", cartao: "card", cartão: "card", card: "card",
    dinheiro: "cash", cash: "cash", transferencia: "bank_transfer",
    transferência: "bank_transfer", bank_transfer: "bank_transfer",
    crediario: "store_credit", crediário: "store_credit", store_credit: "store_credit",
  };
  return aliases[normalized] ?? (normalized ? "other" : "");
}

function mapRow(
  row: ImportRow,
  rowNumber: number,
  connectionId: string,
  mapping: SpreadsheetMapping,
  defaults: SpreadsheetDefaults,
  options: ParseOptions,
  sourceUpdatedAt: string
): CanonicalReceivable {
  const record = {
    schemaVersion: "1.0",
    source: {
      connectionId,
      externalEventId: `spreadsheet:${rowNumber}`,
      sourceUpdatedAt,
    },
    customer: {
      externalId: cell(row, mapping.customerExternalId),
      name: cell(row, mapping.customerName),
      phone: cell(row, mapping.customerPhone),
      document: cell(row, mapping.customerDocument),
      email: cell(row, mapping.customerEmail),
    },
    creditor: {
      externalId: cell(row, mapping.creditorExternalId, defaults.creditorExternalId),
      name: cell(row, mapping.creditorName, defaults.creditorName),
      document: cell(row, mapping.creditorDocument, defaults.creditorDocument),
    },
    receivable: {
      externalId: cell(row, mapping.receivableExternalId),
      description: cell(row, mapping.receivableDescription),
      originalAmount: mapping.originalAmount
        ? decimalValue(cell(row, mapping.originalAmount), options.decimalFormat) : undefined,
      remainingAmount: decimalValue(cell(row, mapping.remainingAmount), options.decimalFormat),
      currency: String(cell(row, mapping.currency, defaults.currency ?? "BRL")).toUpperCase(),
      dueDate: dateValue(cell(row, mapping.dueDate), options.dateFormat),
      status: financialStatus(cell(row, mapping.financialStatus)),
    },
    payment: {
      method: paymentMethod(cell(row, mapping.paymentMethod, defaults.paymentMethod)),
      pixKey: cell(row, mapping.pixKey),
      paymentUrl: cell(row, mapping.paymentUrl),
    },
    metadata: { importRowNumber: rowNumber },
  };
  return validateCanonicalReceivable(record, connectionId);
}

function validateMapping(mapping: SpreadsheetMapping, defaults: SpreadsheetDefaults) {
  const required: Array<keyof SpreadsheetMapping> = [
    "customerExternalId", "customerName", "customerPhone", "receivableExternalId",
    "remainingAmount", "dueDate", "financialStatus",
  ];
  for (const key of required) {
    if (!mapping[key]) throw new CollectionValidationError(`Mapeamento obrigatorio ausente: ${key}`, "mapping_required", key);
  }
  if (!mapping.creditorExternalId && !defaults.creditorExternalId) {
    throw new CollectionValidationError("Credor deve vir de uma coluna ou valor padrao", "creditor_required", "creditorExternalId");
  }
}

export class CollectionSpreadsheetService {
  private readonly adapter = new FileCollectionAdapter();

  constructor(
    private readonly rootClient: SupabaseClient,
    private readonly collectionsClient: SupabaseClient<any, "collections", any>,
    private readonly ingestion: CollectionIngestionService
  ) {}

  async createUploadIntent(input: {
    acesId: number; userId: string | null; sourceConnectionId: string;
    fileName: string; fileSize: number; mimeType: string;
  }) {
    const extension = input.fileName.toLowerCase().endsWith(".xlsx") ? "xlsx"
      : input.fileName.toLowerCase().endsWith(".csv") ? "csv" : null;
    if (!extension || !ALLOWED_MIME_TYPES.has(input.mimeType) || input.fileSize <= 0 || input.fileSize > MAX_FILE_BYTES) {
      throw new CollectionValidationError("Arquivo deve ser CSV/XLSX e ter no maximo 20 MiB", "invalid_upload");
    }
    const importId = randomUUID();
    const storagePath = `${input.acesId}/${input.sourceConnectionId}/${importId}/${extension === "xlsx" ? "source.xlsx" : "source.csv"}`;
    const { data: signed, error: signedError } = await this.rootClient.storage.from(BUCKET)
      .createSignedUploadUrl(storagePath);
    if (signedError) throw signedError;
    const { error } = await this.collectionsClient.from("spreadsheet_imports").insert({
      id: importId, aces_id: input.acesId, source_connection_id: input.sourceConnectionId,
      storage_path: storagePath, original_file_name: input.fileName,
      file_kind: extension, mime_type: input.mimeType, file_size: input.fileSize,
      created_by: input.userId,
    });
    if (error) throw error;
    return { importId, storagePath, token: signed.token, signedUrl: signed.signedUrl };
  }

  private async loadImport(acesId: number, importId: string) {
    const { data, error } = await this.collectionsClient.from("spreadsheet_imports")
      .select("*").eq("id", importId).eq("aces_id", acesId).maybeSingle();
    if (error) throw error;
    if (!data) throw new CollectionValidationError("Importacao nao encontrada", "import_not_found");
    return data as any;
  }

  private async download(importRow: any) {
    const { data, error } = await this.rootClient.storage.from(importRow.storage_bucket || BUCKET)
      .download(importRow.storage_path);
    if (error || !data) throw error ?? new Error("Arquivo da importacao nao encontrado");
    const buffer = Buffer.from(await data.arrayBuffer());
    if (buffer.length !== Number(importRow.file_size) || buffer.length > MAX_FILE_BYTES) {
      throw new CollectionValidationError("Tamanho do arquivo diverge da intencao de upload", "file_size_mismatch");
    }
    return buffer;
  }

  async preview(input: {
    acesId: number; importId: string; mapping: SpreadsheetMapping; defaults?: SpreadsheetDefaults;
    sheetName?: string | null; headerRow?: number; dateFormat?: ParseOptions["dateFormat"];
    decimalFormat?: ParseOptions["decimalFormat"];
  }) {
    const importRow = await this.loadImport(input.acesId, input.importId);
    const defaults = input.defaults ?? {};
    validateMapping(input.mapping, defaults);
    const options: ParseOptions = {
      fileKind: importRow.file_kind, sheetName: input.sheetName,
      headerRow: input.headerRow ?? 1, dateFormat: input.dateFormat ?? "YYYY-MM-DD",
      decimalFormat: input.decimalFormat ?? "pt-BR",
    };
    const parsed = await parseCollectionSpreadsheet(await this.download(importRow), options);
    const records: CanonicalReceivable[] = [];
    const errors: Array<{ rowNumber: number; code: string; message: string; field?: string }> = [];
    parsed.rows.forEach((row, index) => {
      try { records.push(mapRow(
        row,
        index + (options.headerRow ?? 1) + 1,
        importRow.source_connection_id,
        input.mapping,
        defaults,
        options,
        new Date(importRow.created_at).toISOString(),
      )); }
      catch (error) {
        const validation = error instanceof CollectionValidationError ? error : null;
        errors.push({ rowNumber: index + (options.headerRow ?? 1) + 1,
          code: validation?.code ?? "invalid_row", message: error instanceof Error ? error.message : "Linha invalida",
          field: validation?.field });
      }
    });
    const summary = {
      headers: parsed.headers, sheets: parsed.sheets, selectedSheet: parsed.selectedSheet,
      totalRows: parsed.rows.length, validRows: records.length, invalidRows: errors.length,
      sample: records.slice(0, 20), errors: errors.slice(0, 200), truncatedErrors: errors.length > 200,
    };
    const { error } = await this.collectionsClient.from("spreadsheet_imports").update({
      selected_sheet: parsed.selectedSheet, mapping: input.mapping, defaults,
      header_row: options.headerRow, date_format: options.dateFormat,
      decimal_format: options.decimalFormat,
      preview_summary: summary, status: "ready",
    }).eq("id", input.importId).eq("aces_id", input.acesId);
    if (error) throw error;
    return summary;
  }

  async publish(input: {
    acesId: number; importId: string; mode: "snapshot" | "incremental";
    scope?: Record<string, unknown>; confirmValidRowsOnly?: boolean;
  }) {
    const importRow = await this.loadImport(input.acesId, input.importId);
    if (importRow.status !== "ready") throw new CollectionValidationError("Importacao ainda nao esta pronta", "import_not_ready");
    if (input.mode === "snapshot") {
      const { data: source, error: sourceError } = await this.collectionsClient
        .from("source_connections").select("capabilities")
        .eq("id", importRow.source_connection_id).eq("aces_id", input.acesId).single();
      if (sourceError) throw sourceError;
      if (source?.capabilities?.supportsAuthoritativeSnapshot !== true) {
        throw new CollectionValidationError(
          "A fonte nao permite snapshot autoritativo",
          "snapshot_not_authorized",
        );
      }
    }
    const payload = {
      acesId: input.acesId,
      importId: input.importId,
      mode: input.mode,
      scope: input.scope ?? {},
      confirmValidRowsOnly: input.confirmValidRowsOnly === true,
    };
    const { error: statusError } = await this.collectionsClient.from("spreadsheet_imports").update({
      mode: input.mode, scope: input.scope ?? {}, status: "publishing",
      publish_requested_at: new Date().toISOString(), failure_summary: {},
      error_details_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }).eq("id", input.importId).eq("aces_id", input.acesId).eq("status", "ready");
    if (statusError) throw statusError;
    const { error: queueError } = await this.collectionsClient.from("outbox").insert({
      aces_id: input.acesId,
      topic: "spreadsheet.publish",
      aggregate_type: "spreadsheet_import",
      aggregate_id: input.importId,
      idempotency_key: `spreadsheet:${input.importId}:publish`,
      payload,
    });
    if (queueError) {
      await this.collectionsClient.from("spreadsheet_imports")
        .update({ status: "ready", publish_requested_at: null })
        .eq("id", input.importId).eq("aces_id", input.acesId);
      throw queueError;
    }
    return { accepted: true, status: "publishing", importId: input.importId };
  }

  async processQueuedPublish(input: {
    acesId: number; importId: string; mode: "snapshot" | "incremental";
    scope?: Record<string, unknown>; confirmValidRowsOnly?: boolean;
  }) {
    const importRow = await this.loadImport(input.acesId, input.importId);
    if (!["publishing", "failed"].includes(importRow.status)) {
      if (importRow.status === "succeeded") return { duplicate: true, ingestionId: importRow.ingestion_run_id };
      throw new CollectionValidationError("Importacao nao esta na fila de publicacao", "import_not_queued");
    }
    const options: ParseOptions = {
      fileKind: importRow.file_kind, sheetName: importRow.selected_sheet,
      headerRow: importRow.header_row, dateFormat: importRow.date_format,
      decimalFormat: importRow.decimal_format,
    };
    const parsed = await parseCollectionSpreadsheet(await this.download(importRow), options);
    const records: CanonicalReceivable[] = [];
    const errors: Array<{ rowNumber: number; code: string; message: string; field?: string }> = [];
    parsed.rows.forEach((row, index) => {
      const rowNumber = index + (options.headerRow ?? 1) + 1;
      try { records.push(mapRow(
        row, rowNumber, importRow.source_connection_id, importRow.mapping,
        importRow.defaults, options, new Date(importRow.created_at).toISOString(),
      )); }
      catch (error) {
        const validation = error instanceof CollectionValidationError ? error : null;
        errors.push({ rowNumber, code: validation?.code ?? "invalid_row",
          message: error instanceof Error ? error.message : "Linha invalida", field: validation?.field });
      }
    });
    if (errors.length > 0 && (input.mode === "snapshot" || !input.confirmValidRowsOnly)) {
      throw new CollectionValidationError(
        input.mode === "snapshot" ? "Snapshot invalido nao pode ser publicado" : "Confirme a publicacao apenas das linhas validas",
        "invalid_rows_block_publish"
      );
    }
    if (records.length === 0) throw new CollectionValidationError("Nenhuma linha valida para publicar", "empty_import");
    const envelope = await this.adapter.map({
      schemaVersion: "1.0", connectionId: importRow.source_connection_id,
      ingestionId: `file:${input.importId}`, mode: input.mode,
      occurredAt: new Date().toISOString(), scope: input.scope as CanonicalIngestionEnvelope["scope"], records,
    }, {
      connectionId: importRow.source_connection_id,
      timezone: String(importRow.timezone ?? "America/Sao_Paulo"),
    });
    const receipt = await this.ingestion.ingest(envelope, { idempotencyKey: envelope.ingestionId, maxRecords: MAX_ROWS });
    await this.collectionsClient.from("spreadsheet_imports").update({
      mode: input.mode, scope: input.scope ?? {}, status: "succeeded",
      ingestion_run_id: receipt.ingestionId, published_at: new Date().toISOString(), failure_summary: {},
    }).eq("id", input.importId).eq("aces_id", input.acesId);
    return receipt;
  }

  async markPublishFailed(acesId: number, importId: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await this.collectionsClient.from("spreadsheet_imports").update({
      status: "failed",
      failure_summary: { code: "spreadsheet_publish_failed", message: message.slice(0, 2000) },
      error_details_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }).eq("id", importId).eq("aces_id", acesId);
  }
}
