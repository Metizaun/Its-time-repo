import assert from "node:assert/strict";
import test from "node:test";

import { requireRbBillingAdmin } from "../rb-billing-authorization.js";
import { HttpError } from "../sdr-agent-gemini.js";

test("permite execucao manual da cobranca para administrador", () => {
  const context = { role: "ADMIN", acesId: 10 };

  assert.equal(requireRbBillingAdmin(context), context);
});

test("nega execucao manual da cobranca para usuarios sem papel administrativo", () => {
  for (const role of ["VENDEDOR", "NENHUM", ""]) {
    assert.throws(
      () => requireRbBillingAdmin({ role, acesId: 10 }),
      (error: unknown) => error instanceof HttpError && error.statusCode === 403,
    );
  }
});
