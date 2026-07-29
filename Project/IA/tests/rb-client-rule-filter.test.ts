import assert from "node:assert/strict";
import test from "node:test";

import {
  RbClient,
  type RbBillingRecord,
  rbRecordMatchesRule,
  resolveRbApiDays,
} from "../rb-client.js";

function record(dueDate: string, daysDue: number): RbBillingRecord {
  return {
    sourceBucket: "test",
    ACES_ID: 5,
    CLIE_ID: 1,
    CLIE_NOMEPRINC: "Cliente",
    CLIE_NOMESEC: null,
    CLIE_CPFCNPJ: null,
    CLIE_FONE: "62999999999",
    FIN_VLLIQUIDO: 10,
    DtVencimento: dueDate,
    DiasVenc: daysDue,
    FORMA_ID: 6,
    EMP_ID: 1,
    EMP_CPFCNPJ: null,
    Titulo: "1",
  };
}

test("lembrete futuro consulta o RB com dias negativos", () => {
  assert.equal(resolveRbApiDays("reminder", 2), -2);
  assert.equal(resolveRbApiDays("reminder", 0), 0);
  assert.equal(resolveRbApiDays("charge", 2), 2);
});

test("filtro rejeita titulo vencido devolvido como lembrete futuro", () => {
  assert.equal(rbRecordMatchesRule(record("26/07/2026", 2), "reminder", 2, "2026-07-28"), false);
  assert.equal(rbRecordMatchesRule(record("30/07/2026", -2), "reminder", 2, "2026-07-28"), true);
  assert.equal(rbRecordMatchesRule(record("29/07/2026", -2), "reminder", 2, "2026-07-28"), false);
});

test("modo live envia -2 e filtra resposta inconsistente do RB", async () => {
  const client = new RbClient({
    mode: "live",
    baseUrl: "https://rb.invalid",
    tokenApi: "token",
    empresaIds: ["1"],
  });
  const privateClient = client as unknown as {
    http: {
      get: () => Promise<{ status: number; data: { token: string } }>;
      request: (config: { data?: string }) => Promise<{
        status: number;
        data: { RESULT: Array<{ data: RbBillingRecord[] }> };
      }>;
    };
  };

  privateClient.http.get = async () => ({ status: 200, data: { token: "jwt" } });
  privateClient.http.request = async (config) => {
    assert.match(config.data ?? "", /(?:^|&)qtdeDias=-2(?:&|$)/);
    return {
      status: 200,
      data: {
        RESULT: [{ data: [record("26/07/2026", 2), record("30/07/2026", -2)] }],
      },
    };
  };

  const rows = await client.fetchTitlesForRule("reminder", 2, "2026-07-28");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.DtVencimento, "30/07/2026");
});
