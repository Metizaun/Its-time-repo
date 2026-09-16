import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";

import { RbCollectionAdapter } from "../collections/adapters/rb-adapter.js";
import { WebhookCollectionAdapter } from "../collections/adapters/webhook-adapter.js";
import {
  canonicalPayloadHash,
  CollectionValidationError,
  validateCanonicalEnvelope,
} from "../collections/domain.js";
import {
  CollectionWebhookAuthError,
  signCollectionWebhook,
  verifyCollectionWebhook,
} from "../collections/webhook-security.js";
import { parseCollectionSpreadsheet } from "../collections/spreadsheet-service.js";

const connectionId = "10000000-0000-4000-8000-000000000001";

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    source: { connectionId, sourceUpdatedAt: "2026-09-04T12:00:00-03:00" },
    customer: { externalId: "customer-1", name: "Cliente", phone: "(41) 99999-0001" },
    creditor: { externalId: "creditor-1", name: "Loja" },
    receivable: {
      externalId: "title-1", remainingAmount: "120.50", currency: "BRL",
      dueDate: "2026-09-01", status: "open",
    },
    ...overrides,
  };
}

function envelope(records: unknown[] = [record()]) {
  return {
    schemaVersion: "1.0",
    connectionId,
    ingestionId: "event-1",
    mode: "incremental",
    occurredAt: "2026-09-04T12:00:00-03:00",
    records,
  };
}

test("contrato canonico normaliza telefone e preserva decimal textual", () => {
  const parsed = validateCanonicalEnvelope(envelope(), { expectedConnectionId: connectionId });
  assert.equal(parsed.records[0]?.customer.phone, "41999990001");
  assert.equal(parsed.records[0]?.receivable.remainingAmount, "120.50");
});

test("contrato aceita snapshot autoritativo vazio para registrar ausencia", () => {
  const parsed = validateCanonicalEnvelope({ ...envelope([]), mode: "snapshot" }, {
    expectedConnectionId: connectionId,
  });
  assert.equal(parsed.records.length, 0);
});

test("contrato rejeita tenant e estado de comunicacao no payload externo", () => {
  assert.throws(
    () => validateCanonicalEnvelope(envelope([{ ...record(), aces_id: 999 }]), { expectedConnectionId: connectionId }),
    (error: unknown) => error instanceof CollectionValidationError && error.code === "forbidden_external_field",
  );
  assert.throws(
    () => validateCanonicalEnvelope(envelope([{ ...record(), communication_status: "eligible" }]), { expectedConnectionId: connectionId }),
    (error: unknown) => error instanceof CollectionValidationError && error.code === "forbidden_external_field",
  );
});

test("metadata aplica profundidade, quantidade e limite total", () => {
  assert.throws(
    () => validateCanonicalEnvelope(envelope([{ ...record(), metadata: { a: { b: { c: { d: "x" } } } } }]), { expectedConnectionId: connectionId }),
    (error: unknown) => error instanceof CollectionValidationError && error.code === "metadata_too_deep",
  );
  assert.throws(
    () => validateCanonicalEnvelope(envelope([{ ...record(), metadata: Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`key${index}`, "x".repeat(1_000)]),
    ) }]), { expectedConnectionId: connectionId }),
    (error: unknown) => error instanceof CollectionValidationError && error.code === "metadata_too_large",
  );
});

test("hash canonico independe da ordem das chaves", () => {
  assert.equal(canonicalPayloadHash({ a: 1, b: { c: 2 } }), canonicalPayloadHash({ b: { c: 2 }, a: 1 }));
});

test("HMAC valida corpo bruto, segredo atual e anterior", () => {
  const timestamp = "1788534000";
  const rawBody = Buffer.from('{"records":[]}');
  const signature = signCollectionWebhook("previous-secret", timestamp, rawBody);
  assert.equal(verifyCollectionWebhook({
    rawBody, timestamp, signature, secrets: ["current-secret", "previous-secret"],
    nowMs: Number(timestamp) * 1000,
  }), true);
});

test("HMAC rejeita replay e alteracao de um byte", () => {
  const timestamp = "1788534000";
  const signature = signCollectionWebhook("secret", timestamp, "body");
  assert.throws(
    () => verifyCollectionWebhook({ rawBody: Buffer.from("body"), timestamp, signature,
      secrets: ["secret"], nowMs: Number(timestamp) * 1000 + 301_000 }),
    (error: unknown) => error instanceof CollectionWebhookAuthError && error.code === "replay_window_exceeded",
  );
  assert.throws(
    () => verifyCollectionWebhook({ rawBody: Buffer.from("Body"), timestamp, signature,
      secrets: ["secret"], nowMs: Number(timestamp) * 1000 }),
    (error: unknown) => error instanceof CollectionWebhookAuthError && error.code === "invalid_signature",
  );
});

test("adaptador webhook deriva a conexao autenticada e ignora IDs do JSON", async () => {
  const adapter = new WebhookCollectionAdapter();
  const payload = envelope([{ ...record(), source: {
    connectionId: "tenant-adulterado", sourceUpdatedAt: "2026-09-04T12:00:00-03:00",
  } }]);
  payload.connectionId = "tenant-adulterado";
  const mapped = await adapter.map(payload, {
    connectionId, timezone: "America/Sao_Paulo",
  });
  assert.equal(mapped.connectionId, connectionId);
  assert.equal(mapped.records[0]?.source.connectionId, connectionId);
});

test("adaptador RB traduz bucket parcial somente como incremental", async () => {
  const adapter = new RbCollectionAdapter();
  const mapped = await adapter.map({
    sourcePartition: "after_due:4",
    paymentMethodById: { "7": "pix" },
    pixByCreditor: { "10": "pix-confiavel" },
    records: [{
      sourceBucket: "charge_4", ACES_ID: 9, CLIE_ID: 20, CLIE_NOMEPRINC: "Cliente RB",
      CLIE_NOMESEC: null, CLIE_CPFCNPJ: "12345678901", CLIE_FONE: "41999990001",
      FIN_VLLIQUIDO: "1.234,56", DtVencimento: "31/08/2026", DiasVenc: 4,
      PGTO_IDORIGEM: 7, FORMA_ID: 7, EMP_ID: 10, EMP_CPFCNPJ: "12345678000190", Titulo: "RB-1",
    }],
  }, { connectionId, timezone: "America/Sao_Paulo", occurredAt: "2026-09-04T12:00:00-03:00" });
  assert.equal(mapped.mode, "incremental");
  assert.equal(mapped.scope?.sourcePartition, "after_due:4");
  assert.equal(mapped.records[0]?.receivable.remainingAmount, "1234.56");
  assert.equal(mapped.records[0]?.payment?.pixKey, "pix-confiavel");
});

test("CSV detecta ponto e virgula e respeita a linha de cabecalho", async () => {
  const parsed = await parseCollectionSpreadsheet(
    Buffer.from("ignorar\ncliente_id;nome\n123;Maria\n", "utf8"),
    { fileKind: "csv", headerRow: 2 },
  );
  assert.deepEqual(parsed.headers, ["cliente_id", "nome"]);
  assert.deepEqual(parsed.rows, [{ cliente_id: "123", nome: "Maria" }]);
});

test("XLSX lista abas e le valores sem executar formulas", async () => {
  const xml = (value: string) => strToU8(value);
  const xlsx = zipSync({
    "[Content_Types].xml": xml('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    "_rels/.rels": xml('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/workbook.xml": xml('<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Cobranca" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": xml('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": xml('<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>titulo_id</t></is></c><c r="B1" t="inlineStr"><is><t>saldo</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>T-1</t></is></c><c r="B2"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>'),
  });
  const parsed = await parseCollectionSpreadsheet(Buffer.from(xlsx), {
    fileKind: "xlsx", sheetName: "Cobranca", headerRow: 1,
  });
  assert.deepEqual(parsed.sheets, ["Cobranca"]);
  assert.deepEqual(parsed.rows, [{ titulo_id: "T-1", saldo: 2 }]);
});

test("parser rejeita XLSX com assinatura binaria falsa", async () => {
  await assert.rejects(
    () => parseCollectionSpreadsheet(Buffer.from("nao-e-zip"), { fileKind: "xlsx" }),
    (error: unknown) => error instanceof CollectionValidationError && error.code === "invalid_file_signature",
  );
});
