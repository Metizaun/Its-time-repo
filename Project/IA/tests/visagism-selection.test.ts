import assert from "node:assert/strict";
import test from "node:test";
import { pickVisagismCatalogItem } from "../sdr-agent-gemini.js";

test("visagism prioriza o primeiro item disponivel em ordem", () => {
  const item = pickVisagismCatalogItem({
    catalog: [
      { id: "b", displayOrder: 20, productCode: "B20" },
      { id: "a", displayOrder: 10, productCode: "A10" },
    ],
  });

  assert.equal(item?.id, "a");
});

test("visagism evita repetir o item anterior quando ha alternativa", () => {
  const item = pickVisagismCatalogItem({
    catalog: [
      { id: "a", displayOrder: 10, productCode: "A10" },
      { id: "b", displayOrder: 20, productCode: "B20" },
    ],
    priorSelectedItemId: "a",
  });

  assert.equal(item?.id, "b");
});

test("visagism aceita repetir o unico item disponivel", () => {
  const item = pickVisagismCatalogItem({
    catalog: [{ id: "a", displayOrder: 10, productCode: "A10" }],
    priorSelectedItemId: "a",
  });

  assert.equal(item?.id, "a");
});
