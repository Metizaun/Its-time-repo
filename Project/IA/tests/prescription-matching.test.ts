import assert from "node:assert/strict";
import test from "node:test";

import { getPrescriptionValidationErrors, matchLensPriceRule, type LensPriceRule } from "../sdr-agent-gemini.js";

const baseRule: LensPriceRule = {
  id: "basic", displayName: "Basica", lensCategory: "single_vision",
  minSphere: -4, maxSphere: 4, maxAbsCylinder: 2,
  minAddition: null, maxAddition: null, priceCents: 29900, currency: "BRL", priority: 100, isActive: true,
};

test("prescription requires axis when cylinder is non-zero", () => {
  assert.deepEqual(getPrescriptionValidationErrors({
    odSphere: -1, odCylinder: -0.5, odAxis: null,
    oeSphere: -1, oeCylinder: 0, oeAxis: null, addition: null,
  }), ["od_axis_missing"]);
});

test("lens matcher includes exact boundaries", () => {
  const match = matchLensPriceRule({
    odSphere: -4, odCylinder: -2, odAxis: 90,
    oeSphere: 4, oeCylinder: 2, oeAxis: 180, addition: null,
  }, [baseRule]);
  assert.equal(match?.id, "basic");
});

test("overlapping ranges are resolved by lowest priority", () => {
  const preferred = { ...baseRule, id: "preferred", displayName: "Preferida", priority: 10, priceCents: 39900 };
  const match = matchLensPriceRule({
    odSphere: 0, odCylinder: 0, odAxis: null,
    oeSphere: 0, oeCylinder: 0, oeAxis: null, addition: null,
  }, [baseRule, preferred]);
  assert.equal(match?.id, "preferred");
});

test("multifocal requires a matching addition range", () => {
  const multifocal: LensPriceRule = { ...baseRule, id: "multi", lensCategory: "multifocal", minAddition: 1, maxAddition: 3 };
  const match = matchLensPriceRule({
    odSphere: 1, odCylinder: 0, odAxis: null,
    oeSphere: 1, oeCylinder: 0, oeAxis: null, addition: 3.25,
  }, [multifocal]);
  assert.equal(match, null);
});
