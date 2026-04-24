import { ReactNode, useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { HelpDialog } from "@/components/HelpDialog";
import { useApp } from "@/context/AppContext";
import { useLocation } from "react-router-dom";

const STORAGE_KEY = "Crm_sidebar_collapsed_v1";

const TABLET_BP = 768;
const DESKTOP_BP = 1280;

function getMarginLeft(isMobile: boolean, collapsed: boolean): number {
  if (isMobile) return 0;
  return collapsed ? 64 : 280;
}

export function MainLayout({ children }: { children: ReactNode }) {
  const { openModal } = useApp();
  const location = useLocation();

  const isChatPage = location.pathname === "/chat";

  const [isMobile, setIsMobile] = useState<boolean>(
    () => window.innerWidth < TABLET_BP
  );

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) return JSON.parse(stored);
    } catch {}
    return window.innerWidth < DESKTOP_BP;
  });

  // Mobile drawer state
  const [mobileOpen, setMobileOpen] = useState(false);

  // Sync collapsed from localStorage (polling — works within same tab)
  useEffect(() => {
    const sync = () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored !== null) setSidebarCollapsed(JSON.parse(stored));
      } catch {}
    };

    window.addEventListener("storage", sync);
    const interval = setInterval(sync, 150);
    return () => {
      window.removeEventListener("storage", sync);
      clearInterval(interval);
    };
  }, []);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      setIsMobile(width < TABLET_BP);
      if (width >= TABLET_BP) {
        // Close mobile drawer if screen grows
        setMobileOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Keyboard shortcut: N = novo lead
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

  const marginLeft = getMarginLeft(isMobile, sidebarCollapsed);

  return (
    <div className="min-h-screen flex w-full bg-background">
      <Sidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div
        className="flex-1 min-w-0 transition-[margin-left] duration-300"
        style={{ marginLeft }}
      >
        <Topbar onOpenMobileSidebar={() => setMobileOpen(true)} isMobile={isMobile} />

        <main
          className={
            isChatPage
              ? "w-full"
              : "p-4 sm:p-6 lg:p-8 max-w-[1920px] mx-auto"
          }
        >
          {children}
        </main>
      </div>

      <HelpDialog />
    </div>
  );
}