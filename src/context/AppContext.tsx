import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { AppState, Lead, Toast, KanbanColumn } from "@/types";
import { mockLeads, mockUsers, defaultKanbanColumns } from "@/lib/mockData";
import { toast as showToast } from "sonner";

interface AppContextType {
  ui: AppState["ui"];
  setTheme: (theme: "dark" | "light") => void;
  toggleTheme: () => void;
  setSearchQuery: (query: string) => void;
  setPeriodFilter: (filter: AppState["ui"]["periodFilter"]) => void;
  setCustomRange: (range: { from: Date | null; to: Date | null }) => void;
  openModal: (type: string, payload?: any) => void;
  closeModal: () => void;
  openDrawer: (leadId: string) => void;
  closeDrawer: () => void;
  updateKanbanColumn: (columnId: string, color: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [ui, setUi] = useState<AppState["ui"]>(() => {
    const stored = localStorage.getItem("Crm-ui-state");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        return {
          ...parsed,
          customRange: {
            from: parsed.customRange?.from ? new Date(parsed.customRange.from) : null,
            to: parsed.customRange?.to ? new Date(parsed.customRange.to) : null,
          },
          modal: null,
          drawerLeadId: null,
        };
      } catch (e) {
        console.error("Error parsing UI state", e);
      }
    }
    
    return {
      theme: "dark",
      periodFilter: "30d",
      customRange: { from: null, to: null },
      searchQuery: "",
      toastQueue: [],
      modal: null,
      drawerLeadId: null,
      kanbanColumns: defaultKanbanColumns,
    };
  });

  useEffect(() => {
    const toSave = {
      ...ui,
      toastQueue: [],
      modal: null,
      drawerLeadId: null,
    };
    localStorage.setItem("Crm-ui-state", JSON.stringify(toSave));
  }, [ui]);

  const setTheme = (theme: "dark" | "light") => {
    setUi((prev) => ({ ...prev, theme }));
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  };

  const toggleTheme = () => {
    setTheme(ui.theme === "dark" ? "light" : "dark");
  };

  const setSearchQuery = (query: string) => {
    setUi((prev) => ({ ...prev, searchQuery: query }));
  };

  const setPeriodFilter = (filter: AppState["ui"]["periodFilter"]) => {
    setUi((prev) => ({ ...prev, periodFilter: filter }));
  };

  const setCustomRange = (range: { from: Date | null; to: Date | null }) => {
    setUi((prev) => ({ ...prev, customRange: range }));
  };

  const openModal = (type: string, payload?: any) => {
    setUi((prev) => ({ ...prev, modal: { type, payload } }));
  };

  const closeModal = () => {
    setUi((prev) => ({ ...prev, modal: null }));
  };

  const openDrawer = (leadId: string) => {
    setUi((prev) => ({ ...prev, drawerLeadId: leadId }));
  };

  const closeDrawer = () => {
    setUi((prev) => ({ ...prev, drawerLeadId: null }));
  };

  const updateKanbanColumn = (columnId: string, color: string) => {
    setUi((prev) => ({
      ...prev,
      kanbanColumns: prev.kanbanColumns.map((col) =>
        col.id === columnId ? { ...col, color } : col
      ),
    }));
    showToast.success("Cor da coluna atualizada!");
  };

  return (
    <AppContext.Provider
      value={{
        ui,
        setTheme,
        toggleTheme,
        setSearchQuery,
        setPeriodFilter,
        setCustomRange,
        openModal,
        closeModal,
        openDrawer,
        closeDrawer,
        updateKanbanColumn,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within AppProvider");
  }
  return context;
};
