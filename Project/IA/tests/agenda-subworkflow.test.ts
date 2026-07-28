import assert from "node:assert/strict";
import test from "node:test";

import {
  createAgendaContext,
  mergeAgendaRequest,
  parseAgendaRequest,
  readAgendaContext,
  setPresentedAgendaOptions,
} from "../agenda-subworkflow.js";

test("parseAgendaRequest sanitizes structured model output", () => {
  assert.deepEqual(parseAgendaRequest({
    intent: "availability",
    companyQuery: "  Batatinha   Centro ",
    dateFrom: "2026-08-03",
    period: "afternoon",
    confirmation: "yes",
    ignored: "value",
  }), {
    intent: "availability",
    companyQuery: "Batatinha Centro",
    professionalQuery: undefined,
    serviceQuery: undefined,
    dateFrom: "2026-08-03",
    dateTo: undefined,
    period: "afternoon",
    optionReference: undefined,
    confirmation: "yes",
  });
});

test("numbered choices are valid for thirty minutes", () => {
  const now = new Date("2026-07-27T12:00:00.000Z");
  const context = setPresentedAgendaOptions(createAgendaContext(now), [
    { reference: "1", kind: "slot", id: "slot-1", label: "08:00" },
    { reference: "2", kind: "slot", id: "slot-2", label: "09:00" },
  ], now);
  const selected = mergeAgendaRequest(context, {
    intent: "book",
    optionReference: "o segundo",
    confirmation: "unknown",
  }, new Date("2026-07-27T12:29:59.000Z"));
  assert.equal(selected.selectedOption?.id, "slot-2");

  const expired = mergeAgendaRequest(context, {
    intent: "book",
    optionReference: "2",
    confirmation: "unknown",
  }, new Date("2026-07-27T12:30:01.000Z"));
  assert.equal(expired.selectedOption, null);
});

test("changing company clears dependent professional and service choices", () => {
  const current = {
    ...createAgendaContext(new Date("2026-07-27T12:00:00.000Z")),
    companyId: "company-a",
    companyQuery: "Empresa A",
    professionalId: "professional-a",
    professionalLocationId: "location-a",
    professionalQuery: "Dra. Ana",
    serviceId: "service-a",
    serviceQuery: "Consulta",
  };
  const next = mergeAgendaRequest(current, {
    intent: "availability",
    companyQuery: "Empresa B",
    confirmation: "unknown",
  }, new Date("2026-07-27T12:05:00.000Z"));
  assert.equal(next.companyId, null);
  assert.equal(next.professionalId, null);
  assert.equal(next.professionalQuery, null);
  assert.equal(next.serviceId, null);
  assert.equal(next.serviceQuery, null);
});

test("agenda context expires after twenty-four hours", () => {
  const created = createAgendaContext(new Date("2026-07-27T12:00:00.000Z"));
  created.companyId = "company-a";
  const fresh = readAgendaContext(created, new Date("2026-07-28T11:59:59.000Z"));
  assert.equal(fresh.companyId, "company-a");
  const expired = readAgendaContext(created, new Date("2026-07-28T12:00:01.000Z"));
  assert.equal(expired.companyId, null);
});

