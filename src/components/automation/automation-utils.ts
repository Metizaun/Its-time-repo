import { type AutomationStep } from "@/lib/automation";

export function sortStepsForDisplay(steps: AutomationStep[]) {
  return [...steps].sort((left, right) => {
    if (left.delay_minutes !== right.delay_minutes) {
      return left.delay_minutes - right.delay_minutes;
    }

    if (left.position !== right.position) {
      return left.position - right.position;
    }

    return left.created_at.localeCompare(right.created_at);
  });
}

export function formatDelayLabel(delayMinutes: number) {
  if (delayMinutes === 0) {
    return "Na ancora da jornada";
  }

  if (delayMinutes % 1440 === 0) {
    const days = delayMinutes / 1440;
    return `Após ${days} ${days === 1 ? "dia" : "dias"}`;
  }

  if (delayMinutes % 60 === 0) {
    const hours = delayMinutes / 60;
    return `Após ${hours} ${hours === 1 ? "hora" : "horas"}`;
  }

  return `Após ${delayMinutes} min`;
}

export function getMessagePreview(text: string, maxLength = 110) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
