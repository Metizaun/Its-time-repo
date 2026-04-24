import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Kanban,
  Users,
  MessageSquare,
  Settings,
  Search,
  Workflow,
  Bot,
  X,
} from "lucide-react";
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

// Breakpoints
const TABLET_BP = 768;   // md
const DESKTOP_BP = 1280; // xl

function getInitialCollapsed(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return JSON.parse(stored);
  } catch {}
  // Auto-collapse on tablet-sized screens
  return window.innerWidth < DESKTOP_BP;
}

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const { user, userRole, profileName } = useAuth();
  const location = useLocation();
  const isAdmin = userRole === "ADMIN";

  const [isMobile, setIsMobile] = useState<boolean>(
    () => window.innerWidth < TABLET_BP
  );
  const [collapsed, setCollapsed] = useState<boolean>(getInitialCollapsed);

  // Sync with localStorage when collapsed changes (desktop only)
  useEffect(() => {
    if (!isMobile) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
      } catch {}
    }
  }, [collapsed, isMobile]);

  // Respond to window resize
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      const nowMobile = width < TABLET_BP;
      setIsMobile(nowMobile);

      if (!nowMobile) {
        // If transitioning from mobile to desktop, read stored value
        try {
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored !== null) {
            setCollapsed(JSON.parse(stored));
          } else {
            setCollapsed(width < DESKTOP_BP);
          }
        } catch {
          setCollapsed(width < DESKTOP_BP);
        }
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Close mobile sidebar on route change
  useEffect(() => {
    if (isMobile && mobileOpen) {
      onMobileClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (isMobile && mobileOpen) {
      document.body.classList.add("sidebar-mobile-open");
    } else {
      document.body.classList.remove("sidebar-mobile-open");
    }
    return () => {
      document.body.classList.remove("sidebar-mobile-open");
    };
  }, [isMobile, mobileOpen]);

  function handleKeyToggle(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setCollapsed((s) => !s);
    }
  }

  const userName =
    profileName || user?.user_metadata?.name || user?.email || "Usuário";
  const userEmail = user?.email || "";
  const userInitial = userName.charAt(0).toUpperCase();

  const EXPANDED_W = 280;
  const COLLAPSED_W = 64;

  // ── Shared nav link renderer ──────────────────────────────────────────────
  function NavItem({
    path,
    icon: Icon,
    name,
    end,
  }: {
    path: string;
    icon: React.ElementType;
    name: string;
    end?: boolean;
  }) {
    return (
      <li>
        <NavLink
          to={path}
          end={end}
          title={collapsed && !isMobile ? name : ""}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-200 focus-ring",
              isActive
                ? "bg-primary text-primary-foreground font-medium"
                : "text-foreground hover:bg-muted",
              collapsed && !isMobile ? "justify-center" : "justify-start"
            )
          }
        >
          <Icon
            className={cn(
              "w-5 h-5 shrink-0 transition-transform duration-200"
            )}
          />
          <span
            className={cn(
              "transition-opacity duration-200 whitespace-nowrap",
              collapsed && !isMobile
                ? "opacity-0 pointer-events-none absolute"
                : "opacity-100 relative"
            )}
          >
            {name}
          </span>
        </NavLink>
      </li>
    );
  }

  // ── Mobile overlay ────────────────────────────────────────────────────────
  const overlay = isMobile && (
    <div
      aria-hidden
      className={cn(
        "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300",
        mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      )}
      onClick={onMobileClose}
    />
  );

  // ── Sidebar panel ─────────────────────────────────────────────────────────
  const panelClasses = isMobile
    ? cn(
        "fixed left-0 top-0 z-50 h-screen w-[280px] bg-card border-r border-border flex flex-col transition-transform duration-300 ease-out overflow-hidden",
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      )
    : cn(
        "h-screen bg-card border-r border-border flex flex-col fixed left-0 top-0 z-40 transition-[width] duration-300 ease-out overflow-hidden",
        collapsed ? "w-16" : "w-[280px]"
      );

  return (
    <>
      {overlay}

      <aside aria-label="Sidebar" className={panelClasses} role="navigation">
        {/* Header / Logo */}
        <div
          className={cn(
            "relative px-6 py-6 transition-all duration-300 flex items-start justify-between",
            !isMobile && collapsed ? "h-0 p-0 pointer-events-none" : "h-auto"
          )}
        >
          <div
            className={cn(
              "transition-opacity duration-300",
              !isMobile && collapsed ? "opacity-0" : "opacity-100"
            )}
          >
            <h1 className="text-xl font-bold text-primary">Crm Its time</h1>
            <p className="text-sm text-muted-foreground mt-1">Gestão de Leads</p>
          </div>

          {/* Close button (mobile only) */}
          {isMobile && (
            <button
              onClick={onMobileClose}
              aria-label="Fechar menu"
              className="ml-auto -mr-1 flex h-8 w-8 items-center justify-center rounded-lg hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav
          className={cn(
            "flex-1 py-3",
            !isMobile && collapsed ? "px-1 mt-2" : "px-4 mt-0"
          )}
        >
          <ul className="space-y-1">
            {navigation.map((item) => (
              <NavItem
                key={item.path}
                path={item.path}
                icon={item.icon}
                name={item.name}
                end={item.path === "/"}
              />
            ))}

            {isAdmin && (
              <NavItem path="/automacao" icon={Workflow} name="Automação" />
            )}
            {isAdmin && (
              <NavItem path="/agentes" icon={Bot} name="Agentes" />
            )}
            {isAdmin && (
              <NavItem path="/admin" icon={Settings} name="Admin" />
            )}
          </ul>
        </nav>

        {/* User info footer */}
        <div className="p-4 border-t border-border">
          <div
            className={cn(
              "flex items-center gap-3",
              !isMobile && collapsed ? "justify-center" : ""
            )}
          >
            <div className="w-10 h-10 shrink-0 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold">
              {userInitial}
            </div>

            <div
              className={cn(
                "flex-1 min-w-0 transition-opacity duration-300",
                !isMobile && collapsed
                  ? "opacity-0 pointer-events-none absolute"
                  : "opacity-100"
              )}
            >
              <p className="text-sm font-medium truncate">{userName}</p>
              <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Desktop collapse toggle button */}
      {!isMobile && (
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
      )}
    </>
  );
}

export default Sidebar;
