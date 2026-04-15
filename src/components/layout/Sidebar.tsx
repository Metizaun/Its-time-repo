import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, Kanban, Users, MessageSquare, Settings, Search, Workflow, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

const navigation = [
  { name: "Dashboard", path: "/", icon: LayoutDashboard },
  { name: "Pipeline", path: "/pipeline", icon: Kanban },
  { name: "Leads", path: "/leads", icon: Users },
  { name: "Buscar", path: "/buscar", icon: Search },
  { name: "Chat", path: "/chat", icon: MessageSquare },
];

const STORAGE_KEY = "Crm_sidebar_collapsed_v1";

export function Sidebar() {
  const { user, userRole, profileName } = useAuth();
  const isAdmin = userRole === "ADMIN";
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "false");
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
    } catch {}
  }, [collapsed]);

  const EXPANDED_W = 280;
  const COLLAPSED_W = 64;

  function handleKeyToggle(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setCollapsed((s) => !s);
    }
  }

  const userName = profileName || user?.user_metadata?.name || user?.email || "Usuário";
  const userEmail = user?.email || "";
  const userInitial = userName.charAt(0).toUpperCase();

  return (
    <>
      <aside
        aria-label="Sidebar"
        className={cn(
          "h-screen bg-card border-r border-border flex flex-col fixed left-0 top-0 z-40 transition-width duration-300 ease-out overflow-hidden",
          collapsed ? "w-16" : "w-[280px]"
        )}
        role="navigation"
      >
        <div
          className={cn(
            "relative px-6 py-6 transition-all duration-300",
            collapsed ? "h-0 p-0 pointer-events-none" : "h-auto"
          )}
        >
          <div
            className={cn(
              "transition-opacity duration-300",
              collapsed ? "opacity-0" : "opacity-100"
            )}
          >
            <h1 className="text-xl font-bold text-primary">Crm Its time</h1>
            <p className="text-sm text-muted-foreground mt-1">Gestão de Leads</p>
          </div>
        </div>

        <nav className={cn("flex-1 py-3", collapsed ? "px-1 mt-2" : "px-4 mt-0")}>
          <ul className="space-y-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    end={item.path === "/"}
                    title={collapsed ? item.name : ""}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-200 focus-ring",
                        isActive ? "bg-primary text-primary-foreground font-medium" : "text-foreground hover:bg-muted",
                        collapsed ? "justify-center" : "justify-start"
                      )
                    }
                  >
                    <Icon
                      className={cn(
                        "w-5 h-5 transition-transform duration-200",
                        collapsed ? "mx-0" : "mr-2"
                      )}
                    />

                    <span
                      className={cn(
                        "transition-opacity duration-200 whitespace-nowrap",
                        collapsed ? "opacity-0 pointer-events-none absolute" : "opacity-100 relative"
                      )}
                    >
                      {item.name}
                    </span>
                  </NavLink>
                </li>
              );
            })}

            {isAdmin && (
              <li>
                <NavLink
                  to="/automacao"
                  title={collapsed ? "Automação" : ""}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-200 focus-ring",
                      isActive ? "bg-primary text-primary-foreground font-medium" : "text-foreground hover:bg-muted",
                      collapsed ? "justify-center" : "justify-start"
                    )
                  }
                >
                  <Workflow className={cn("w-5 h-5 transition-transform duration-200", collapsed ? "mx-0" : "mr-2")} />
                  <span
                    className={cn(
                      "transition-opacity duration-200",
                      collapsed ? "opacity-0 pointer-events-none absolute" : "opacity-100 relative"
                    )}
                  >
                    Automação
                  </span>
                </NavLink>
              </li>
            )}

            {isAdmin && (
              <li>
                <NavLink
                  to="/agentes"
                  title={collapsed ? "Agentes" : ""}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-200 focus-ring",
                      isActive ? "bg-primary text-primary-foreground font-medium" : "text-foreground hover:bg-muted",
                      collapsed ? "justify-center" : "justify-start"
                    )
                  }
                >
                  <Bot className={cn("w-5 h-5 transition-transform duration-200", collapsed ? "mx-0" : "mr-2")} />
                  <span
                    className={cn(
                      "transition-opacity duration-200",
                      collapsed ? "opacity-0 pointer-events-none absolute" : "opacity-100 relative"
                    )}
                  >
                    Agentes
                  </span>
                </NavLink>
              </li>
            )}

            {isAdmin && (
              <li>
                <NavLink
                  to="/admin"
                  title={collapsed ? "Admin" : ""}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-200 focus-ring",
                      isActive ? "bg-primary text-primary-foreground font-medium" : "text-foreground hover:bg-muted",
                      collapsed ? "justify-center" : "justify-start"
                    )
                  }
                >
                  <Settings className={cn("w-5 h-5 transition-transform duration-200", collapsed ? "mx-0" : "mr-2")} />
                  <span
                    className={cn(
                      "transition-opacity duration-200",
                      collapsed ? "opacity-0 pointer-events-none absolute" : "opacity-100 relative"
                    )}
                  >
                    Admin
                  </span>
                </NavLink>
              </li>
            )}
          </ul>
        </nav>

        <div className="p-4 border-t border-border">
          <div className={cn("flex items-center gap-3", collapsed ? "justify-center" : "")}>
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold">
              {userInitial}
            </div>

            <div
              className={cn(
                "flex-1 min-w-0 transition-opacity duration-300",
                collapsed ? "opacity-0 pointer-events-none absolute" : "opacity-100"
              )}
            >
              <p className="text-sm font-medium truncate">{userName}</p>
              <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
            </div>
          </div>
        </div>
      </aside>

      <button
        onClick={() => setCollapsed((s) => !s)}
        onKeyDown={handleKeyToggle}
        aria-label={collapsed ? "Abrir painel lateral" : "Fechar painel lateral"}
        aria-expanded={!collapsed}
        style={{
          left: collapsed ? `${COLLAPSED_W}px` : `${EXPANDED_W}px`,
          top: "50vh",
          transform: "translate(-50%, -50%)",
        }}
        className="hidden md:flex items-center justify-center fixed z-50 w-[30px] h-[30px] rounded-full bg-card border border-border shadow hover:bg-muted active:scale-95 transition-all duration-200"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          style={{
            width: 16,
            height: 16,
            transition: "transform 260ms cubic-bezier(0.22,1,0.36,1)",
            transform: collapsed ? "rotate(180deg)" : "rotate(0deg)",
            transformOrigin: "50% 50%",
            willChange: "transform",
            display: "block",
          }}
          aria-hidden
        >
          <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
    </>
  );
}

export default Sidebar;
