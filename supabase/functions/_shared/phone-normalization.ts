export function normalizePhoneDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function normalizePhoneIdentity(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  let digits = normalizePhoneDigits(value);
  const explicitlyForeign = (raw.startsWith("+") || raw.startsWith("00")) && !digits.startsWith("55");
  if (explicitlyForeign) {
    return digits.length >= 8 && digits.length <= 15 ? `intl:${digits}` : null;
  }
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2);
  }

  if (digits.length === 10 || digits.length === 11) {
    if (digits.length === 11 && digits[2] === "9") {
      digits = `${digits.slice(0, 2)}${digits.slice(3)}`;
    }
    return `br:${digits}`;
  }

  return digits.length >= 8 && digits.length <= 15 ? `intl:${digits}` : null;
}
