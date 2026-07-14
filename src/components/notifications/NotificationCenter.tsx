import { useCallback, useEffect, useState } from "react";
import { Bell, Loader2, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  listNotifications,
  getNotificationUnreadCounts,
  readAllNotifications,
  readNotification,
  type NotificationCategory,
  type ProductNotification,
} from "@/services/notificationService";

const LABELS: Record<NotificationCategory, string> = { internal: "Interno", notice: "Avisos" };

export function NotificationCenter() {
  const navigate = useNavigate();
  const [active, setActive] = useState<NotificationCategory>("internal");
  const [items, setItems] = useState<Record<NotificationCategory, ProductNotification[]>>({ internal: [], notice: [] });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [unreadByCategory, setUnreadByCategory] = useState<Record<NotificationCategory, number>>({ internal: 0, notice: 0 });

  const refresh = useCallback(async () => {
    setError(false);
    try {
      const [internal, notice, counts] = await Promise.all([listNotifications("internal"), listNotifications("notice"), getNotificationUnreadCounts()]);
      setItems({ internal, notice });
      setUnreadByCategory({ internal: counts.internal, notice: counts.notice });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const channel = supabase
      .channel("product-notifications")
      .on("postgres_changes", { event: "INSERT", schema: "crm", table: "notifications" }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "crm", table: "notification_reads" }, () => void refresh())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refresh();
      });
    const onResume = () => document.visibilityState === "visible" && void refresh();
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  const unread = unreadByCategory.internal + unreadByCategory.notice;
  const activeItems = items[active];

  async function openNotification(item: ProductNotification) {
    if (!item.read) {
      setItems((current) => ({ ...current, [active]: current[active].map((entry) => entry.key === item.key ? { ...entry, read: true } : entry) }));
      setUnreadByCategory((current) => ({ ...current, [active]: Math.max(0, current[active] - 1) }));
      await readNotification(item.key).catch(() => void refresh());
    }
    if (item.action?.kind === "openConversation") {
      navigate("/chat", { state: { conversationTarget: item.action.target } });
    }
  }

  async function markAllRead() {
    setItems((current) => ({ ...current, [active]: current[active].map((item) => ({ ...item, read: true })) }));
    setUnreadByCategory((current) => ({ ...current, [active]: 0 }));
    try {
      await readAllNotifications(active);
    } catch {
      toast.error("Nao foi possivel atualizar as notificacoes");
      void refresh();
    }
  }

  async function loadMore() {
    const last = activeItems.at(-1);
    if (!last) return;
    setLoadingMore(true);
    try {
      const next = await listNotifications(active, last.publishedAt);
      setItems((current) => ({ ...current, [active]: [...current[active], ...next] }));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="topbar-icon-button relative" aria-label={unread ? `${unread} notificacoes nao lidas` : "Notificacoes"}>
          <Bell className="h-5 w-5" />
          {unread > 0 ? <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--color-primary-50)] px-1 font-mono text-[10px] font-semibold text-[var(--color-primary-700)]">{unread > 99 ? "99+" : unread}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,24rem)] overflow-hidden rounded-[var(--radius-xl)] border-[var(--border-default)] bg-[var(--color-surface-1)] p-0 shadow-lg">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] p-4">
          <div><p className="font-semibold text-[var(--color-gray-900)]">Notificacoes</p><p className="text-xs text-[var(--color-gray-500)]">Novidades e movimentos importantes</p></div>
          <Button variant="ghost" size="sm" disabled={!activeItems.some((item) => !item.read)} onClick={() => void markAllRead()}>Marcar todas como lidas</Button>
        </div>
        <Tabs value={active} onValueChange={(value) => setActive(value as NotificationCategory)}>
          <TabsList className="mx-4 mt-3 grid w-auto grid-cols-2 rounded-[var(--radius-lg)]">
            {(Object.keys(LABELS) as NotificationCategory[]).map((category) => <TabsTrigger key={category} value={category}>{LABELS[category]}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <ScrollArea className="h-[min(60vh,25rem)]">
          {loading ? <div className="flex h-40 items-center justify-center text-sm text-[var(--color-gray-500)]"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando</div> : error ? <div className="flex h-40 flex-col items-center justify-center gap-3 px-6 text-center"><p className="text-sm text-[var(--color-gray-600)]">Nao foi possivel carregar as notificacoes.</p><Button variant="outline" size="sm" onClick={() => void refresh()}><RefreshCw className="mr-2 h-4 w-4" />Tentar novamente</Button></div> : activeItems.length === 0 ? <div className="flex h-40 items-center justify-center px-6 text-center text-sm text-[var(--color-gray-500)]">Nada novo por aqui.</div> : <div className="p-2">
            {activeItems.map((item) => <button key={item.key} type="button" onClick={() => void openNotification(item)} className={cn("mb-1 w-full rounded-[var(--radius-lg)] border p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm focus-ring", item.read ? "border-transparent bg-transparent" : "border-[var(--color-primary-100)] bg-[var(--color-primary-50)]")}><div className="flex gap-2"><span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", item.read ? "bg-[var(--color-bg-muted)]" : "bg-[var(--color-primary-500)]")} /><div className="min-w-0"><p className="text-sm font-semibold text-[var(--color-gray-900)]">{item.title}</p><p className="mt-1 text-xs leading-relaxed text-[var(--color-gray-600)]">{item.description}</p><time className="mt-2 block font-mono text-[10px] text-[var(--color-gray-500)]">{formatDistanceToNow(new Date(item.publishedAt), { addSuffix: true, locale: ptBR })}</time></div></div></button>)}
            {activeItems.length >= 20 ? <Button variant="ghost" className="w-full" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Carregando..." : "Ver mais"}</Button> : null}
          </div>}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
