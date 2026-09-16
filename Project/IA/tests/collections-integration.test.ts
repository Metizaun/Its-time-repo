import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";

import { RbCollectionAdapter } from "../collections/adapters/rb-adapter.js";
import { WebhookCollectionAdapter } from "../collections/adapters/webhook-adapter.js";
import {
  type CanonicalIngestionEnvelope,
  type CanonicalReceivable,
} from "../collections/domain.js";
import { CollectionIngestionService } from "../collections/ingestion-service.js";
import { parseCollectionSpreadsheet } from "../collections/spreadsheet-service.js";

const connectionId = "30000000-0000-4000-8000-000000000001";

type RpcCall = { name: string; args: Record<string, unknown> };

class IngestionPortFake {
  readonly calls: RpcCall[] = [];
  private readonly idempotency = new Map<string, string>();
  private sequence = 0;

  async rpc(name: string, args: Record<string, unknown>) {
    this.calls.push({ name, args });
    if (name === "ingest_envelope") {
      const key = String(args.p_external_idempotency_key ?? "");
      const hash = String(args.p_payload_hash ?? "");
      const previousHash = this.idempotency.get(key);
      if (previousHash && previousHash !== hash) {
        return { data: null, error: new Error("COLLECTION_IDEMPOTENCY_CONFLICT") };
      }
      if (previousHash) {
        return { data: { accepted: true, duplicate: true, ingestionId: `duplicate-${key}` }, error: null };
      }
      this.idempotency.set(key, hash);
      this.sequence += 1;
      const records = Array.isArray(args.p_records) ? args.p_records : [];
      return {
        data: {
          accepted: true,
          duplicate: false,
          ingestionId: `ingestion-${this.sequence}`,
          createdCount: records.length,
          updatedCount: 0,
          unchangedCount: 0,
        },
        error: null,
      };
    }
    return { data: { accepted: true }, error: null };
  }
}

class ProviderFake {
  readonly sent: CanonicalReceivable[] = [];

  send(receivable: CanonicalReceivable) {
    if (["open"].includes(receivable.receivable.status)) this.sent.push(receivable);
  }
}

function baseRecord(externalId: string, sourceUpdatedAt = "2026-09-04T12:00:00-03:00") {
  return {
    schemaVersion: "1.0" as const,
    source: { connectionId, sourceUpdatedAt },
    customer: { externalId: `customer-${externalId}`, name: "Cliente", phone: "41999990001" },
    creditor: { externalId: "creditor-1", name: "Loja" },
    receivable: {
      externalId: `title-${externalId}`,
      remainingAmount: "120.50",
      currency: "BRL" as const,
      dueDate: "2026-09-01",
      status: "open" as const,
    },
  };
}

function xlsxFixture() {
  const xml = (value: string) => strToU8(value);
  return Buffer.from(zipSync({
    "[Content_Types].xml": xml(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    ),
    "_rels/.rels": xml(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    "xl/workbook.xml": xml(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Cobranca" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": xml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": xml(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>titulo_id</t></is></c><c r="B1" t="inlineStr"><is><t>saldo</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>XLSX-1</t></is></c><c r="B2"><v>99.90</v></c></row></sheetData></worksheet>',
    ),
  }));
}

function envelope(records: CanonicalReceivable[], ingestionId: string): CanonicalIngestionEnvelope {
  return {
    schemaVersion: "1.0",
    connectionId,
    ingestionId,
    mode: "incremental",
    occurredAt: "2026-09-04T12:00:00-03:00",
    records,
  };
}

test("RB, webhook, CSV e XLSX usam o mesmo port canonico e provider fake", async () => {
  const port = new IngestionPortFake();
  const ingestion = new CollectionIngestionService(port as never);
  const provider = new ProviderFake();

  const rb = await new RbCollectionAdapter().map({
    sourcePartition: "after_due:4",
    records: [{
      sourceBucket: "charge_4", ACES_ID: 9, CLIE_ID: 20, CLIE_NOMEPRINC: "Cliente RB",
      CLIE_NOMESEC: null, CLIE_CPFCNPJ: null, CLIE_FONE: "41999990001",
      FIN_VLLIQUIDO: "120,50", DtVencimento: "01/09/2026", DiasVenc: 3,
      PGTO_IDORIGEM: null, FORMA_ID: null, EMP_ID: 10, EMP_CPFCNPJ: null, Titulo: "RB-1",
    }],
  }, { connectionId, timezone: "America/Sao_Paulo", occurredAt: "2026-09-04T12:00:00-03:00" });

  const webhook = await new WebhookCollectionAdapter().map({
    schemaVersion: "1.0", connectionId: "external-id", ingestionId: "webhook-1",
    mode: "incremental", occurredAt: "2026-09-04T12:00:00-03:00", records: [baseRecord("webhook")],
  }, { connectionId, timezone: "America/Sao_Paulo" });

  const csv = await parseCollectionSpreadsheet(
    Buffer.from("titulo_id;saldo\nCSV-1;88.80\n", "utf8"),
    { fileKind: "csv", headerRow: 1 },
  );
  const csvRecord = baseRecord(String(csv.rows[0]?.titulo_id ?? "csv"));
  csvRecord.receivable.remainingAmount = String(csv.rows[0]?.saldo ?? "0");

  const xlsx = await parseCollectionSpreadsheet(xlsxFixture(), {
    fileKind: "xlsx", sheetName: "Cobranca", headerRow: 1,
  });
  const xlsxRecord = baseRecord(String(xlsx.rows[0]?.titulo_id ?? "xlsx"));
  xlsxRecord.receivable.remainingAmount = String(xlsx.rows[0]?.saldo ?? "0");

  const envelopes = [
    { id: "rb", value: rb },
    { id: "webhook", value: webhook },
    { id: "csv", value: envelope([csvRecord], "csv-1") },
    { id: "xlsx", value: envelope([xlsxRecord], "xlsx-1") },
  ];

  for (const item of envelopes) {
    const receipt = await ingestion.ingest(item.value, { idempotencyKey: `integration-${item.id}` });
    assert.equal(receipt.accepted, true);
    const record = item.value.records[0];
    assert.equal(record?.source.connectionId, connectionId);
    assert.match(record?.receivable.remainingAmount ?? "", /^\d+(\.\d+)?$/);
    provider.send(record!);
  }

  assert.equal(port.calls.filter((call) => call.name === "ingest_envelope").length, 4);
  assert.equal(provider.sent.length, 4);
  assert.deepEqual(
    port.calls.filter((call) => call.name === "ingest_envelope")
      .map((call) => (call.args.p_records as Array<Record<string, unknown>>)[0]?.receivable && "receivable"),
    ["receivable", "receivable", "receivable", "receivable"],
  );
});

test("port canonico mantém idempotencia e não entrega status não comunicável ao provider", async () => {
  const port = new IngestionPortFake();
  const ingestion = new CollectionIngestionService(port as never);
  const provider = new ProviderFake();
  const settled = {
    ...baseRecord("settled"),
    receivable: { ...baseRecord("settled").receivable, status: "settled" as const, remainingAmount: "0.00" },
  };
  const input = envelope([settled], "same-event");

  const first = await ingestion.ingest(input, { idempotencyKey: "same-key" });
  const duplicate = await ingestion.ingest(input, { idempotencyKey: "same-key" });
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(port.calls.filter((call) => call.name === "ingest_envelope").length, 2);

  provider.send(settled);
  assert.equal(provider.sent.length, 0);
});
