import { ReactNode, useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { HelpDialog } from "@/components/HelpDialog";
import { useApp } from "@/context/AppContext";
import { useLocation } from "react-router-dom"; // 1. Importar useLocation

const STORAGE_KEY = "Crm_sidebar_collapsed_v1";

export function MainLayout({ children }: { children: ReactNode }) {
  const { openModal } = useApp();
  const location = useLocation(); // 2. Obter a rota atual
  
  // 3. Verificar se é a página de chat
  const isChatPage = location.pathname === "/chat";

  // Sincronizar com o estado da sidebar via localStorage
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "false");
    } catch {
      return false;
    }
  });

  // Escutar mudanças no localStorage (quando sidebar é toggleada)
  useEffect(() => {
    const handleStorageChange = () => {
      try {
        setSidebarCollapsed(JSON.parse(localStorage.getItem(STORAGE_KEY) || "false"));
      } catch {}
    };

    // Escutar evento de storage (funciona entre abas)
    window.addEventListener("storage", handleStorageChange);
    
    // Polling para mesma aba (localStorage não dispara evento na mesma aba)
    const interval = setInterval(handleStorageChange, 100);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Novo Lead: N
      if (e.key === "n" && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        openModal("createLead");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openModal]);

  return (
    <div className="min-h-screen flex w-full bg-background">
      <Sidebar />
      <div 
        className="flex-1 transition-all duration-300"
        style={{ marginLeft: sidebarCollapsed ? "64px" : "280px" }}
      >
        <Topbar />
        {/* 4. Aplicação condicional das classes */}
        <main className={isChatPage ? "w-full" : "p-8 max-w-[1920px] mx-auto"}>
          {children}
        </main>
      </div>
      <HelpDialog />
    </div>
  );
}