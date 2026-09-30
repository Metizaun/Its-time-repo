import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgendaAvailabilityAttempts,
  buildRescheduleAppointmentStep,
  buildCompanyLookupAttempts,
  createAgendaContext,
  isGenericAgendaServiceQuery,
  mergeAgendaSlotsByProfessionalLocation,
  mergeAgendaRequest,
  parseAgendaRequest,
  readAgendaContext,
  setAgendaSelectedStore,
  setPresentedAgendaOptions,
  validateRescheduleRequest,
} from "../agenda-subworkflow.js";

test("company lookup recovery uses five increasingly broad attempts", () => {
  const attempts = buildCompanyLookupAttempts(
    "Curitiba - Portão",
    "exame de vista",
    "Optometrista Campo Largo",
  );

  assert.equal(attempts.length, 5);
  assert.deepEqual(attempts[0], {
    strategy: "strict",
    query: "Curitiba - Portão",
    serviceQuery: "exame de vista",
    professionalQuery: "Optometrista Campo Largo",
  });
  assert.equal(attempts[3].strategy, "unit_fragment");
  assert.equal(attempts[3].query, "Portão");
  assert.equal(attempts[4].query, "curitiba portao");
  assert.equal(attempts[4].serviceQuery, null);
  assert.equal(attempts[4].professionalQuery, null);
});

test("availability recovery expands five windows without changing the selected unit", () => {
  const attempts = buildAgendaAvailabilityAttempts({
    today: "2026-08-21",
    dateFrom: "2026-08-25",
    dateTo: "2026-08-25",
    period: "afternoon",
    horizonDays: 90,
  });

  assert.equal(attempts.length, 5);
  assert.deepEqual(attempts[0], {
    dateFrom: "2026-08-25",
    dateUntil: "2026-08-25",
    period: "afternoon",
  });
  assert.ok(attempts.every((attempt) => attempt.dateFrom === "2026-08-25"));
  assert.ok(attempts.slice(1).every((attempt) => attempt.period === null));
  assert.deepEqual(attempts.map((attempt) => attempt.dateUntil), [
    "2026-08-25",
    "2026-08-25",
    "2026-09-01",
    "2026-09-08",
    "2026-09-24",
  ]);
});

test("availability keeps identical times separate across different appointment poles", () => {
  const slots = mergeAgendaSlotsByProfessionalLocation([
    {
      professionalLocationId: "calendar-pole-a",
      locationLabel: "Loja 01 - Muquiçaba",
      slots: [{ professional_id: "professional-1", service_id: "service-1", slot_start: "2026-10-01T13:00:00Z" }],
    },
    {
      professionalLocationId: "calendar-pole-b",
      locationLabel: "Loja 09 - Aeroporto",
      slots: [{ professional_id: "professional-1", service_id: "service-1", slot_start: "2026-10-01T13:00:00Z" }],
    },
  ]);

  assert.equal(slots.length, 2);
  assert.deepEqual(slots.map((slot) => slot.professional_location_id), ["calendar-pole-a", "calendar-pole-b"]);
  assert.deepEqual(slots.map((slot) => slot.location_label), ["Loja 01 - Muquiçaba", "Loja 09 - Aeroporto"]);
});

test("changing the selected store clears stale agenda choices but keeps date and service query", () => {
  const now = new Date("2026-09-30T15:00:00.000Z");
  const option = {
    reference: "1",
    kind: "slot" as const,
    id: "pole-a:professional-1:service-1:2026-10-01T13:00:00Z",
    label: "01/10/2026 10:00 — Loja 01",
    companyId: null,
    professionalId: "professional-1",
    professionalLocationId: "pole-a",
    serviceId: "service-1",
    startTime: "2026-10-01T13:00:00Z",
  };
  const previous = {
    ...createAgendaContext(now),
    selectedStoreId: "store-a",
    companyId: "company-a",
    professionalId: "professional-1",
    professionalLocationId: "pole-a",
    serviceId: "service-1",
    serviceQuery: "exame completo",
    dateFrom: "2026-10-01",
    presentedOptions: [option],
    optionsPresentedAt: now.toISOString(),
    selectedOption: option,
    confirmation: "yes" as const,
  };

  const changed = setAgendaSelectedStore(previous, "store-b");

  assert.equal(changed.selectedStoreId, "store-b");
  assert.equal(changed.companyId, null);
  assert.equal(changed.professionalId, null);
  assert.equal(changed.professionalLocationId, null);
  assert.equal(changed.serviceId, null);
  assert.equal(changed.selectedOption, null);
  assert.deepEqual(changed.presentedOptions, []);
  assert.equal(changed.confirmation, "unknown");
  assert.equal(changed.dateFrom, "2026-10-01");
  assert.equal(changed.serviceQuery, "exame completo");
});

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

test("reschedule selection accepts only the option explicitly present in the customer message", () => {
  const now = new Date("2026-09-25T12:00:00.000Z");
  const context = setPresentedAgendaOptions(createAgendaContext(now), [
    { reference: "1", kind: "appointment", id: "event-1", label: "quinta-feira, 01 de out., 15:00" },
    { reference: "2", kind: "appointment", id: "event-2", label: "sexta-feira, 02 de out., 09:30" },
  ], now);

  const explicitChoice = validateRescheduleRequest(context, {
    intent: "reschedule",
    optionReference: "2",
    confirmation: "unknown",
  }, "Quero o agendamento 2", new Date("2026-09-25T12:05:00.000Z"));
  assert.equal(explicitChoice.optionReference, "2");

  const explicitTime = validateRescheduleRequest(setPresentedAgendaOptions(createAgendaContext(now), [
    { reference: "1", kind: "slot", id: "slot-1", label: "quinta-feira, 01 de out., 09:15" },
    { reference: "2", kind: "slot", id: "slot-2", label: "quinta-feira, 01 de out., 15:00" },
  ], now), {
    intent: "reschedule",
    optionReference: "2",
    confirmation: "unknown",
  }, "Quero o horário das 15h", new Date("2026-09-25T12:05:00.000Z"));
  assert.equal(explicitTime.optionReference, "2");

  const ambiguousReply = validateRescheduleRequest(context, {
    intent: "reschedule",
    optionReference: "1",
    confirmation: "unknown",
  }, "Nao entendi", new Date("2026-09-25T12:05:00.000Z"));
  assert.equal(ambiguousReply.optionReference, undefined);
});

test("reschedule confirmation requires a fresh pending choice and matching yes or no", () => {
  const now = new Date("2026-09-25T12:00:00.000Z");
  const presented = setPresentedAgendaOptions(createAgendaContext(now), [
    { reference: "1", kind: "slot", id: "slot-1", label: "quinta-feira, 01 de out., 09:15" },
  ], now);
  const pending = { ...presented, selectedOption: presented.presentedOptions[0] };

  const yesWithoutSelection = validateRescheduleRequest(presented, {
    intent: "reschedule",
    confirmation: "yes",
  }, "Sim", new Date("2026-09-25T12:05:00.000Z"));
  assert.equal(yesWithoutSelection.confirmation, "unknown");

  const confirmed = validateRescheduleRequest(pending, {
    intent: "reschedule",
    confirmation: "yes",
  }, "Sim", new Date("2026-09-25T12:05:00.000Z"));
  assert.equal(confirmed.confirmation, "yes");

  const rejected = validateRescheduleRequest(pending, {
    intent: "reschedule",
    confirmation: "no",
  }, "Não", new Date("2026-09-25T12:05:00.000Z"));
  assert.equal(rejected.confirmation, "no");

  const clarification = validateRescheduleRequest(pending, {
    intent: "reschedule",
    confirmation: "no",
  }, "Nao entendi", new Date("2026-09-25T12:05:00.000Z"));
  assert.equal(clarification.confirmation, "unknown");

  const expiredConfirmation = validateRescheduleRequest(pending, {
    intent: "reschedule",
    confirmation: "yes",
  }, "Sim", new Date("2026-09-25T12:31:00.000Z"));
  assert.equal(expiredConfirmation.confirmation, "unknown");

  const expiredOption = validateRescheduleRequest(presented, {
    intent: "reschedule",
    optionReference: "1",
  }, "opção 1", new Date("2026-09-25T12:31:00.000Z"));
  assert.equal(expiredOption.optionReference, undefined);
});

test("reschedule asks to confirm one appointment and to choose when there are several", () => {
  const one = buildRescheduleAppointmentStep([
    { reference: "1", kind: "appointment", id: "event-1", label: "quinta-feira, 01 de out., 15:00" },
  ]);
  assert.equal(one.status, "needs_confirmation");
  assert.equal(one.selectedOption?.id, "event-1");
  assert.match(one.message, /15:00/u);

  const multiple = buildRescheduleAppointmentStep([
    { reference: "1", kind: "appointment", id: "event-1", label: "quinta-feira, 01 de out., 15:00" },
    { reference: "2", kind: "appointment", id: "event-2", label: "sexta-feira, 02 de out., 09:30" },
  ]);
  assert.equal(multiple.status, "needs_input");
  assert.equal(multiple.selectedOption, null);
  assert.match(multiple.message, /1\..*2\./u);

  assert.equal(buildRescheduleAppointmentStep([]).status, "empty");
});

test("Filippe clarification does not select a slot and a later yes only confirms the appointment", () => {
  const now = new Date("2026-09-25T12:00:00.000Z");
  const presented = setPresentedAgendaOptions(createAgendaContext(now), [
    { reference: "1", kind: "appointment", id: "event-1", label: "quinta-feira, 01 de out., 15:00" },
  ], now);
  const pendingAppointment = {
    ...presented,
    selectedOption: presented.presentedOptions[0],
  };

  const clarification = validateRescheduleRequest(pendingAppointment, {
    intent: "reschedule",
    optionReference: "1",
    confirmation: "unknown",
  }, "Nao entendi", new Date("2026-09-25T12:01:00.000Z"));
  assert.equal(clarification.optionReference, undefined);
  const afterClarification = mergeAgendaRequest(pendingAppointment, clarification, new Date("2026-09-25T12:01:00.000Z"));
  assert.equal(afterClarification.appointmentEventId, null);

  const repeatedPrompt = {
    ...setPresentedAgendaOptions(afterClarification, pendingAppointment.presentedOptions, new Date("2026-09-25T12:02:00.000Z")),
    selectedOption: pendingAppointment.presentedOptions[0],
  };
  const confirmation = validateRescheduleRequest(repeatedPrompt, {
    intent: "reschedule",
    confirmation: "yes",
  }, "Sim", new Date("2026-09-25T12:03:00.000Z"));
  const afterConfirmation = mergeAgendaRequest(repeatedPrompt, confirmation, new Date("2026-09-25T12:03:00.000Z"));
  assert.equal(afterConfirmation.appointmentEventId, "event-1");
  assert.equal(afterConfirmation.selectedOption?.kind, "appointment");
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

test("company choice resolves by the unit name previously presented", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const context = setPresentedAgendaOptions(createAgendaContext(now), [
    {
      reference: "1",
      kind: "company",
      id: "portao-id",
      companyId: "portao-id",
      label: "Instituto dos Oculos - Portao — Curitiba — PR",
    },
    {
      reference: "2",
      kind: "company",
      id: "campo-largo-id",
      companyId: "campo-largo-id",
      label: "Instituto dos Oculos - Campo Largo — Campo Largo — PR",
    },
    {
      reference: "3",
      kind: "company",
      id: "joinville-id",
      companyId: "joinville-id",
      label: "Instituto dos Oculos - Joinville — Joinville — SC",
    },
  ], now);

  const byShortName = mergeAgendaRequest(context, {
    intent: "availability",
    companyQuery: "Portão",
    confirmation: "unknown",
  }, new Date("2026-08-21T12:05:00.000Z"));
  assert.equal(byShortName.companyId, "portao-id");

  const byCityAndUnit = mergeAgendaRequest(context, {
    intent: "availability",
    companyQuery: "Curitiba - Portão",
    confirmation: "unknown",
  }, new Date("2026-08-21T12:05:00.000Z"));
  assert.equal(byCityAndUnit.companyId, "portao-id");
});

test("ambiguous unit text does not choose an option silently", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const context = setPresentedAgendaOptions(createAgendaContext(now), [
    { reference: "1", kind: "company", id: "a", label: "Loja Centro — Curitiba" },
    { reference: "2", kind: "company", id: "b", label: "Loja Centro — Joinville" },
  ], now);
  const selected = mergeAgendaRequest(context, {
    intent: "availability",
    companyQuery: "Centro",
    confirmation: "unknown",
  }, new Date("2026-08-21T12:05:00.000Z"));
  assert.equal(selected.companyId, null);
});

test("a selected unit rejects slots belonging to another city", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const context = setPresentedAgendaOptions({
    ...createAgendaContext(now),
    companyId: "campo-largo-id",
    companyQuery: "Campo Largo",
  }, [
    {
      reference: "1",
      kind: "slot",
      id: "portao-slot",
      label: "25/08 às 14:00",
      companyId: "portao-id",
      professionalId: "portao-professional",
      professionalLocationId: "portao-location",
      serviceId: "service-id",
      startTime: "2026-08-25T17:00:00.000Z",
    },
  ], now);

  const selected = mergeAgendaRequest(context, {
    intent: "book",
    companyQuery: "Campo Largo",
    optionReference: "1",
    confirmation: "yes",
  }, new Date("2026-08-21T12:05:00.000Z"));

  assert.equal(selected.companyId, "campo-largo-id");
  assert.equal(selected.selectedOption, null);
  assert.equal(selected.professionalId, null);
});

test("a yes or no answer preserves the pending company hypothesis", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const context = setPresentedAgendaOptions(createAgendaContext(now), [
    {
      reference: "1",
      kind: "company",
      id: "campo-largo-id",
      companyId: "campo-largo-id",
      label: "Saúde Perfeita - Campo Largo",
    },
  ], now);
  context.selectedOption = context.presentedOptions[0];

  const confirmed = mergeAgendaRequest(context, {
    intent: "availability",
    confirmation: "yes",
  }, new Date("2026-08-21T12:05:00.000Z"));

  assert.equal(confirmed.selectedOption?.companyId, "campo-largo-id");
  assert.equal(confirmed.companyId, "campo-largo-id");
  assert.equal(confirmed.confirmation, "yes");

  const rejected = mergeAgendaRequest(context, {
    intent: "availability",
    confirmation: "no",
  }, new Date("2026-08-21T12:05:00.000Z"));
  assert.equal(rejected.selectedOption?.companyId, "campo-largo-id");
  assert.equal(rejected.companyId, null);
  assert.equal(rejected.confirmation, "no");
});

test("generic service words are not treated as a hard catalog filter", () => {
  assert.equal(isGenericAgendaServiceQuery("consulta"), true);
  assert.equal(isGenericAgendaServiceQuery("agendar atendimento"), true);
  assert.equal(isGenericAgendaServiceQuery("exame de vista"), false);
});

test("agenda context expires after twenty-four hours", () => {
  const created = createAgendaContext(new Date("2026-07-27T12:00:00.000Z"));
  created.companyId = "company-a";
  const fresh = readAgendaContext(created, new Date("2026-07-28T11:59:59.000Z"));
  assert.equal(fresh.companyId, "company-a");
  const expired = readAgendaContext(created, new Date("2026-07-28T12:00:01.000Z"));
  assert.equal(expired.companyId, null);
});
