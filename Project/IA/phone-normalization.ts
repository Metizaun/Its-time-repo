export function normalizePhoneDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function brazilNationalNumber(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  let digits = normalizePhoneDigits(value);
  if ((raw.startsWith("+") || raw.startsWith("00")) && !digits.startsWith("55")) {
    return null;
  }
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2);
  }

  return digits.length === 10 || digits.length === 11 ? digits : null;
}

/**
 * Stable contact identity for Brazilian WhatsApp numbers.
 *
 * WhatsApp providers may report the same mobile with or without the ninth digit
 * after the DDD. Delivery keeps the original number, while matching removes
 * that optional digit so both provider representations resolve to one lead.
 */
export function normalizePhoneIdentity(value: unknown): string | null {
  const national = brazilNationalNumber(value);
  if (national) {
    const subscriberIdentity =
      national.length === 11 && national[2] === "9"
        ? `${national.slice(0, 2)}${national.slice(3)}`
        : national;
    return `br:${subscriberIdentity}`;
  }

  const digits = normalizePhoneDigits(value);
  return digits.length >= 8 && digits.length <= 15 ? `intl:${digits}` : null;
}

export function normalizePhoneForStorage(value: unknown): string {
  const digits = normalizePhoneDigits(value);
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return digits.slice(2);
  }
  return digits;
}

export function phoneVariants(value: unknown): string[] {
  const digits = normalizePhoneDigits(value);
  const national = brazilNationalNumber(value);
  const variants = new Set<string>();

  if (digits) variants.add(digits);
  if (!national) return Array.from(variants);

  variants.add(national);
  variants.add(`55${national}`);

  if (national.length === 11 && national[2] === "9") {
    const withoutNinthDigit = `${national.slice(0, 2)}${national.slice(3)}`;
    variants.add(withoutNinthDigit);
    variants.add(`55${withoutNinthDigit}`);
  } else if (national.length === 10 && /^[6-9]/.test(national.slice(2, 3))) {
    const withNinthDigit = `${national.slice(0, 2)}9${national.slice(2)}`;
    variants.add(withNinthDigit);
    variants.add(`55${withNinthDigit}`);
  }

  return Array.from(variants);
}
