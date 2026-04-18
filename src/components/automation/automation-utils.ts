import { formatTimingSummary, type AutomationAnchorEvent, type AutomationStep } from "@/lib/automation";

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

export function formatDelayLabel(delayMinutes: number, anchorEvent: AutomationAnchorEvent = "stage_entered_at") {
  return formatTimingSummary(delayMinutes, anchorEvent);
}

export function getMessagePreview(text: string, maxLength = 110) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}
