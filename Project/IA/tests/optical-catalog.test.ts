import assert from "node:assert/strict";
import test from "node:test";

import {
  searchOpticalCatalog,
  type OpticalCatalogProduct,
} from "../sdr-agent-gemini.js";

const products: OpticalCatalogProduct[] = [
  { id: "simple", lensCategory: "single_vision", displayName: "Visão simples essencial", brand: null, treatments: ["Antirreflexo"], description: null, priceCents: 29900, currency: "BRL", isActive: true },
  { id: "multi-blue", lensCategory: "multifocal", displayName: "Multifocal filtro azul", brand: "Marca", treatments: ["Antirreflexo", "Filtro azul"], description: null, priceCents: 89900, currency: "BRL", isActive: true },
  { id: "multi-basic", lensCategory: "multifocal", displayName: "Multifocal essencial", brand: null, treatments: ["Antirreflexo"], description: null, priceCents: 69900, currency: "BRL", isActive: true },
];

test("catalog uses the prescription family but never prescription degrees", () => {
  const result = searchOpticalCatalog(products, { action: "search", lensCategory: null, treatment: "filtro azul", query: "valor" }, "multifocal");
  assert.equal(result.status, "exact");
  assert.deepEqual(result.products.map((product) => product.id), ["multi-blue"]);
});

test("missing requested treatment offers same-category alternatives", () => {
  const result = searchOpticalCatalog(products, { action: "search", lensCategory: "multifocal", treatment: "fotossensível", query: "quero transitions" });
  assert.equal(result.status, "alternatives");
  assert.deepEqual(result.products.map((product) => product.id), ["multi-basic", "multi-blue"]);
});

test("generic quote without a prescription includes available catalog products", () => {
  const result = searchOpticalCatalog(products, { action: "search", lensCategory: null, treatment: null, query: "quanto custa" });
  assert.equal(result.status, "alternatives");
  assert.equal(result.products.length, 3);
});

test("inactive products are never returned", () => {
  const result = searchOpticalCatalog([{ ...products[1], isActive: false }], { action: "search", lensCategory: "multifocal", treatment: "filtro azul", query: "preço" });
  assert.equal(result.status, "empty");
});
