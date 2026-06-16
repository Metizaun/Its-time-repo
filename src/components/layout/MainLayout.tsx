import { ReactNode, useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { HelpDialog } from "@/components/HelpDialog";
import { useApp } from "@/context/AppContext";
import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "Crm_sidebar_collapsed_v1";

const TABLET_BP = 768;
const DESKTOP_BP = 1280;

export function MainLayout({ children }: { children: ReactNode }) {
  const { openModal } = useApp();
  const location = useLocation();
  const isChatPage = location.pathname === "/chat";
  const isCalendarPage = location.pathname === "/calendar";

  const [isMobile, setIsMobile] = useState<boolean>(() => window.innerWidth < TABLET_BP);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) return JSON.parse(stored);
    } catch {
      return window.innerWidth < DESKTOP_BP;
    }

    return window.innerWidth < DESKTOP_BP;
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const sync = () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored !== null) setSidebarCollapsed(JSON.parse(stored));
      } catch {
        setSidebarCollapsed(window.innerWidth < DESKTOP_BP);
      }
    };

    window.addEventListener("storage", sync);
    const interval = setInterval(sync, 150);
    return () => {
      window.removeEventListener("storage", sync);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      setIsMobile(width < TABLET_BP);
      if (width >= TABLET_BP) {
        setMobileOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "n" &&
        !e.ctrlKey &&
        !e.metaKey &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        openModal("createLead");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openModal]);

  return (
    <div className="app-shell">
      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />

      <div
        className={cn(
          "app-content",
          isMobile && "app-content--mobile",
          !isMobile && sidebarCollapsed && "app-content--collapsed"
        )}
      >
        <Topbar onOpenMobileSidebar={() => setMobileOpen(true)} isMobile={isMobile} />

        <main className={cn("app-main", isChatPage && "app-main--chat", isCalendarPage && "app-main--calendar")}>
          {children}
        </main>
      </div>

      <HelpDialog />
    </div>
  );
}
