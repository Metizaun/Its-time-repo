import { getCrmBackend, postCrmBackend } from "@/services/crmBackend";

export type NotificationCategory = "internal" | "notice";

export type ProductNotification = {
  key: string;
  title: string;
  description: string;
  publishedAt: string;
  read: boolean;
  action: { kind: "openConversation"; target: string } | null;
};

export async function listNotifications(category: NotificationCategory, before?: string) {
  const params = new URLSearchParams({ category, limit: "20" });
  if (before) params.set("before", before);
  const response = await getCrmBackend<{ notifications?: ProductNotification[] }>(`/api/notifications?${params}`);
  return response.notifications ?? [];
}

export async function readNotification(key: string) {
  return postCrmBackend<{ success: boolean }>(`/api/notifications/${encodeURIComponent(key)}/read`, {});
}

export async function getNotificationUnreadCounts() {
  return getCrmBackend<{ internal: number; notice: number }>("/api/notifications/unread-counts");
}

export async function readAllNotifications(category: NotificationCategory) {
  return postCrmBackend<{ success: boolean }>("/api/notifications/read-all", { category });
}
