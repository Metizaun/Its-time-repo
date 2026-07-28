type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function partsFor(date: Date, timezone: string): ZonedParts {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

export function zonedDateTimeToUtc(date: string, time: string, timezone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second = 0] = time.split(":").map(Number);
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) {
    return new Date(Number.NaN);
  }
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = targetAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = partsFor(new Date(guess), timezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const correction = targetAsUtc - actualAsUtc;
    guess += correction;
    if (correction === 0) break;
  }
  return new Date(guess);
}

export function utcToWallDate(value: Date | string, timezone: string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = partsFor(date, timezone);
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
}

export function wallDateToUtc(value: Date, timezone: string) {
  const date = [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
  const time = [
    String(value.getHours()).padStart(2, "0"),
    String(value.getMinutes()).padStart(2, "0"),
    String(value.getSeconds()).padStart(2, "0"),
  ].join(":");
  return zonedDateTimeToUtc(date, time, timezone);
}

export function toZonedDateInput(value: Date | string, timezone: string) {
  const parts = partsFor(typeof value === "string" ? new Date(value) : value, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function toZonedTimeInput(value: Date | string, timezone: string) {
  const parts = partsFor(typeof value === "string" ? new Date(value) : value, timezone);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function formatInCalendarTimezone(
  value: Date | string,
  timezone: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat("pt-BR", { ...options, timeZone: timezone }).format(
    typeof value === "string" ? new Date(value) : value,
  );
}

