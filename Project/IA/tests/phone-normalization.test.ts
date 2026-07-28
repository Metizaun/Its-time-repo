import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizePhoneForStorage,
  normalizePhoneIdentity,
  phoneVariants,
} from "../phone-normalization.js";

describe("phone normalization", () => {
  it("matches Brazilian mobile aliases with country code and optional ninth digit", () => {
    const inputs = [
      "5562999330863",
      "+55 (62) 99933-0863",
      "62999330863",
      "6299330863",
      "55 62 9933-0863",
    ];

    assert.deepEqual(
      new Set(inputs.map(normalizePhoneIdentity)),
      new Set(["br:6299330863"]),
    );
  });

  it("does not remove a landline digit", () => {
    assert.equal(normalizePhoneIdentity("556232341234"), "br:6232341234");
    assert.equal(normalizePhoneIdentity("6232341234"), "br:6232341234");
  });

  it("keeps foreign identities country-aware and exact", () => {
    assert.equal(normalizePhoneIdentity("+1 415 555 0123"), "intl:14155550123");
  });

  it("keeps the provider number usable for storage and delivery", () => {
    assert.equal(normalizePhoneForStorage("+55 (62) 99933-0863"), "62999330863");
    assert.equal(normalizePhoneForStorage("6299330863"), "6299330863");
  });

  it("generates all Brazilian lookup aliases", () => {
    assert.deepEqual(
      new Set(phoneVariants("5562999330863")),
      new Set(["5562999330863", "62999330863", "6299330863", "556299330863"]),
    );
  });
});
