import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";

export function getDayKey(value: Date): string {
  return format(value, "yyyy-MM-dd");
}

export function formatChatDateLabel(value: Date): string {
  if (isToday(value)) {
    return "Hoje";
  }

  if (isYesterday(value)) {
    return "Ontem";
  }

  return format(value, "dd/MM/yyyy", { locale: ptBR });
}
