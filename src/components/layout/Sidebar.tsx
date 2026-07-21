import type { CSSProperties, ElementType, KeyboardEvent } from "react";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Kanban,
  Users,
  MessageSquare,
  CalendarDays,
  Settings,
  Search,
  Workflow,
  Bot,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useChatUnread } from "@/contexts/ChatUnreadContext";

const navigation = [
  { name: "Dashboard", path: "/", icon: LayoutDashboard },
  { name: "Pipeline", path: "/pipeline", icon: Kanban },
  { name: "Leads", path: "/leads", icon: Users },
  { name: "Buscar", path: "/buscar", icon: Search },
  { name: "Chat", path: "/chat", icon: MessageSquare },
  { name: "Calendario", path: "/calendar", icon: CalendarDays },
];

const STORAGE_KEY = "Crm_sidebar_collapsed_v1";
const TABLET_BP = 768;
const DESKTOP_BP = 1280;

function getInitialCollapsed(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return JSON.parse(stored);
  } catch {
    return window.innerWidth < DESKTOP_BP;
  }

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
  const { total: chatUnreadTotal } = useChatUnread();

  const [isMobile, setIsMobile] = useState<boolean>(() => window.innerWidth < TABLET_BP);
  const [collapsed, setCollapsed] = useState<boolean>(getInitialCollapsed);

  useEffect(() => {
    if (!isMobile) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
      } catch {
        return;
      }
    }
  }, [collapsed, isMobile]);

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      const nowMobile = width < TABLET_BP;
      setIsMobile(nowMobile);

      if (!nowMobile) {
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

  useEffect(() => {
    if (isMobile && mobileOpen) {
      onMobileClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

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

  function handleKeyToggle(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setCollapsed((value) => !value);
    }
  }

  const userName = profileName || user?.user_metadata?.name || user?.email || "Usuario";
  const userEmail = user?.email || "";
  const userInitial = userName.charAt(0).toUpperCase();

  function NavItem({
    path,
    icon: Icon,
    name,
    end,
    badge,
  }: {
    path: string;
    icon: ElementType;
    name: string;
    end?: boolean;
    badge?: number;
  }) {
    return (
      <li>
        <NavLink
          to={path}
          end={end}
          title={collapsed && !isMobile ? name : ""}
          aria-label={badge ? `${name}, ${badge > 99 ? "99 ou mais" : badge} mensagens não lidas` : name}
          className={({ isActive }) =>
            cn("nav-item focus-ring", isActive && "nav-item--active")
          }
        >
          <Icon className="nav-item__icon" />
          <span className="nav-item__label">{name}</span>
          {badge ? <span aria-hidden="true" className="nav-item__badge">{badge > 99 ? "99+" : badge}</span> : null}
        </NavLink>
      </li>
    );
  }

  const sidebarToggleStyle = {
    "--sidebar-toggle-left": collapsed ? "var(--layout-sidebar-collapsed)" : "var(--layout-sidebar-width)",
  } as CSSProperties;

  return (
    <>
      {isMobile && (
        <div
          aria-hidden
          className={cn("sidebar-overlay", mobileOpen && "sidebar-overlay--open")}
          onClick={onMobileClose}
        />
      )}

      <aside
        aria-label="Sidebar"
        role="navigation"
        className={cn(
          "sidebar-panel",
          !isMobile && collapsed && "sidebar-panel--collapsed",
          isMobile && "sidebar-panel--mobile",
          isMobile && (mobileOpen ? "sidebar-panel--mobile-open" : "sidebar-panel--mobile-closed")
        )}
      >
        <div className="sidebar-header">
          <div>
            <h1 className="sidebar-brand">Crm Its time</h1>
            <p className="sidebar-subtitle">Gestao de Leads</p>
          </div>

          {isMobile && (
            <button onClick={onMobileClose} aria-label="Fechar menu" className="sidebar-close-button">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <nav className="sidebar-nav">
          <ul className="sidebar-list">
            {navigation.map((item) => (
              <NavItem key={item.path} path={item.path} icon={item.icon} name={item.name} end={item.path === "/"} badge={item.path === "/chat" ? chatUnreadTotal : undefined} />
            ))}

            {isAdmin && <NavItem path="/automacao" icon={Workflow} name="Automacao" />}
            {isAdmin && <NavItem path="/agentes" icon={Bot} name="Agentes" />}
            {isAdmin && <NavItem path="/admin" icon={Settings} name="Admin" />}
          </ul>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-avatar">{userInitial}</div>

            <div className="sidebar-user-meta">
              <p className="sidebar-user-name">{userName}</p>
              <p className="sidebar-user-email">{userEmail}</p>
            </div>
          </div>
        </div>
      </aside>

      {!isMobile && (
        <button
          onClick={() => setCollapsed((value) => !value)}
          onKeyDown={handleKeyToggle}
          aria-label={collapsed ? "Abrir painel lateral" : "Fechar painel lateral"}
          aria-expanded={!collapsed}
          style={sidebarToggleStyle}
          className="sidebar-toggle"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            className={cn("sidebar-toggle__icon", collapsed && "sidebar-toggle__icon--collapsed")}
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
