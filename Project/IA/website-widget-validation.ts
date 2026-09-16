import { normalizePhoneDigits, normalizePhoneForStorage } from "./phone-normalization.js";

const BRAZIL_AREA_CODES = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 120;

export type WidgetValidationError = {
  field: "name" | "phone";
  code: string;
  message: string;
};

export type WidgetValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: WidgetValidationError };

export function validateVisitorName(value: unknown): WidgetValidationResult<string> {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();

  if (!name) {
    return {
      ok: false,
      error: { field: "name", code: "NAME_REQUIRED", message: "Informe seu nome." },
    };
  }

  if (name.length < NAME_MIN_LENGTH || name.length > NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: { field: "name", code: "NAME_LENGTH", message: "Informe seu nome completo." },
    };
  }

  if (!/\p{L}/u.test(name)) {
    return {
      ok: false,
      error: { field: "name", code: "NAME_INVALID", message: "Informe seu nome." },
    };
  }

  return { ok: true, value: name };
}

/**
 * Accepts Brazilian numbers only, returning the national form the CRM stores.
 * Ten-digit mobiles are upgraded with the ninth digit so the same person is not
 * captured twice when they later message on WhatsApp.
 */
export function validateBrazilianPhone(value: unknown): WidgetValidationResult<string> {
  const raw = String(value ?? "").trim();
  const invalid: WidgetValidationResult<string> = {
    ok: false,
    error: {
      field: "phone",
      code: "PHONE_INVALID",
      message: "Informe um telefone brasileiro com DDD.",
    },
  };

  if (!raw) {
    return {
      ok: false,
      error: { field: "phone", code: "PHONE_REQUIRED", message: "Informe seu telefone." },
    };
  }

  const allDigits = normalizePhoneDigits(raw);
  if ((raw.startsWith("+") || raw.startsWith("00")) && !allDigits.startsWith("55")) {
    return invalid;
  }

  const national = normalizePhoneForStorage(raw);
  if (national.length !== 10 && national.length !== 11) {
    return invalid;
  }

  if (!BRAZIL_AREA_CODES.has(Number(national.slice(0, 2)))) {
    return invalid;
  }

  const subscriber = national.slice(2);

  if (subscriber.length === 9) {
    return subscriber.startsWith("9") ? { ok: true, value: national } : invalid;
  }

  if (/^[2-5]/.test(subscriber)) {
    return { ok: true, value: national };
  }

  if (/^[6-9]/.test(subscriber)) {
    return { ok: true, value: `${national.slice(0, 2)}9${subscriber}` };
  }

  return invalid;
}

export function normalizeDomain(value: unknown): string | null {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");

  if (!raw || !/^[a-z0-9.-]+$/.test(raw)) {
    return null;
  }

  // "localhost" has no dot but is what a developer's browser sends while the
  // site is being built, so it has to be authorizable like any other origin.
  if (!raw.includes(".") && raw !== "localhost") {
    return null;
  }

  return raw;
}

/**
 * The widget key travels in the host page's HTML, so the allowlist is what stops
 * a copied key from driving this agent on someone else's site.
 */
export function isOriginAllowed(origin: unknown, allowedDomains: readonly string[]): boolean {
  const hostname = normalizeDomain(origin);
  if (!hostname) return false;

  return allowedDomains.some((entry) => {
    const domain = normalizeDomain(entry);
    if (!domain) return false;
    return hostname === domain || hostname.endsWith(`.${domain}`);
  });
}
