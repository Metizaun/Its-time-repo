import assert from "node:assert/strict";
import test from "node:test";

import {
  AgendaContractError,
  agendaPayloadHash,
  parseAgendaInboundEnvelope,
  validateAgendaOutboundEnvelope,
} from "../agenda-sync/contract.js";

const ids = {
  event: "10000000-0000-4000-8000-000000000001",
  unit: "10000000-0000-4000-8000-000000000002",
  professional: "10000000-0000-4000-8000-000000000003",
  assignment: "10000000-0000-4000-8000-000000000004",
  patient: "10000000-0000-4000-8000-000000000005",
  appointment: "10000000-0000-4000-8000-000000000006",
  service: "10000000-0000-4000-8000-000000000007",
};

function base(eventType: string, resource: unknown, resourceVersion: number | null = 1) {
  return {
    schemaVersion: "1.0",
    eventId: ids.event,
    eventType,
    occurredAt: "2026-09-11T14:30:00-03:00",
    ...(resourceVersion === null ? {} : { resourceVersion }),
    resource,
  };
}

function appointment() {
  return {
    id: ids.appointment,
    status: "scheduled",
    startTime: "2026-09-18T14:00:00-03:00",
    endTime: "2026-09-18T14:30:00-03:00",
    timezone: "America/Sao_Paulo",
    durationMinutes: 30,
    unitId: ids.unit,
    locationName: null,
    professionalId: ids.professional,
    assignmentId: ids.assignment,
    patientId: ids.patient,
    service: {
      id: ids.service,
      name: "Consulta",
      durationMinutes: 30,
      price: "150.00",
      currency: "BRL",
    },
    origin: "ai",
    notes: null,
    cancelReason: null,
    metadata: {},
    updatedAt: "2026-09-11T14:30:00-03:00",
  };
}

test("valida evento de teste sem resourceVersion", () => {
  const parsed = validateAgendaOutboundEnvelope(base(
    "integration.test",
    { message: "Its Time Agenda Universal connection test" },
    null,
  ));
  assert.equal(parsed.eventType, "integration.test");
  assert.equal(parsed.resourceVersion, undefined);
});

test("valida os recursos de saida canonicos", () => {
  const payloads = [
    base("unit.upserted", {
      id: ids.unit,
      cnpj: "12345678000190",
      name: "Clinica Centro",
      address: "Rua X, 100",
      city: "Sao Paulo",
      state: "SP",
      isActive: true,
      closures: [],
      metadata: {},
      updatedAt: "2026-09-11T14:30:00-03:00",
    }),
    base("professional.upserted", {
      id: ids.professional,
      name: "Dra. Fulana",
      specialty: "Oftalmologia",
      isActive: true,
      assignments: [{ assignmentId: ids.assignment, unitId: ids.unit, locationName: null, isActive: true }],
      metadata: {},
      updatedAt: "2026-09-11T14:30:00-03:00",
    }),
    base("availability.upserted", {
      assignmentId: ids.assignment,
      professionalId: ids.professional,
      unitId: ids.unit,
      timezone: "America/Sao_Paulo",
      weeklyGrid: [{ weekday: 1, startTime: "08:00", endTime: "12:00", validFrom: null, validUntil: null }],
      exceptions: [],
      updatedAt: "2026-09-11T14:30:00-03:00",
    }),
    base("patient.upserted", {
      id: ids.patient,
      name: "Maria Silva",
      phoneE164: "+5511999999999",
      document: null,
      homeUnitId: ids.unit,
      metadata: {},
      updatedAt: "2026-09-11T14:30:00-03:00",
    }),
    base("appointment.created", appointment()),
    base("appointment.rescheduled", appointment()),
    base("appointment.cancelled", { ...appointment(), status: "cancelled", cancelReason: "Solicitado" }),
    base("appointment.status_changed", { ...appointment(), status: "confirmed" }),
  ];
  for (const payload of payloads) {
    assert.equal(validateAgendaOutboundEnvelope(payload).eventType, payload.eventType);
  }
});

test("aceita status_reported e preserva campos desconhecidos do envelope", () => {
  const parsed = parseAgendaInboundEnvelope({
    ...base("appointment.status_reported", {
      appointmentId: ids.appointment,
      status: "no_show",
      reason: "Paciente nao compareceu",
      reportedAt: "2026-09-18T14:20:00-03:00",
      baseResourceVersion: 7,
      metadata: {},
      futureField: "ignored",
    }, null),
    futureEnvelopeField: true,
  });
  assert.equal(parsed.kind, "known");
  if (parsed.kind === "known") {
    assert.equal(parsed.envelope.resource.status, "no_show");
    assert.equal(parsed.envelope.resource.baseResourceVersion, 7);
  }
});

test("classifica evento de entrada desconhecido para resposta 200", () => {
  const parsed = parseAgendaInboundEnvelope(base("appointment.future_event", { any: "value" }, null));
  assert.equal(parsed.kind, "unknown");
});

test("rejeita identificadores de tenant vindos do parceiro", () => {
  assert.throws(
    () => parseAgendaInboundEnvelope(base("appointment.status_reported", {
      appointmentId: ids.appointment,
      status: "done",
      reason: null,
      reportedAt: "2026-09-18T14:20:00-03:00",
      baseResourceVersion: 7,
      metadata: { tenantId: 999 },
    }, null)),
    (error: unknown) => error instanceof AgendaContractError && error.code === "forbidden_external_field",
  );
});

test("aplica limites de metadata", () => {
  assert.throws(
    () => parseAgendaInboundEnvelope(base("appointment.status_reported", {
      appointmentId: ids.appointment,
      status: "done",
      reason: null,
      reportedAt: "2026-09-18T14:20:00-03:00",
      baseResourceVersion: 7,
      metadata: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`key${index}`, index])),
    }, null)),
    (error: unknown) => error instanceof AgendaContractError && error.code === "metadata_too_large",
  );
});

test("exige locationName em atendimento independente", () => {
  assert.throws(
    () => validateAgendaOutboundEnvelope(base("appointment.created", {
      ...appointment(), unitId: null, locationName: null,
    })),
    (error: unknown) => error instanceof AgendaContractError && error.code === "location_required",
  );
});

test("hash canonico independe da ordem das chaves", () => {
  assert.equal(
    agendaPayloadHash({ event: { id: 1, status: "done" }, version: 7 }),
    agendaPayloadHash({ version: 7, event: { status: "done", id: 1 } }),
  );
});
