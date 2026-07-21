import { Search, LogOut, Menu } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";

interface TopbarProps {
  onOpenMobileSidebar?: () => void;
  isMobile?: boolean;
  hideSearch?: boolean;
}

export function Topbar({ onOpenMobileSidebar, isMobile, hideSearch = false }: TopbarProps) {
  const { setSearchQuery, ui } = useApp();
  const { user, signOut } = useAuth();

  const userInitial = user?.email?.charAt(0).toUpperCase() || "U";

  useEffect(() => {
    if (hideSearch) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      }

      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hideSearch]);

  return (
    <header className="topbar">
      {isMobile && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Abrir menu"
          className="topbar-icon-button shrink-0 md:hidden"
          onClick={onOpenMobileSidebar}
        >
          <Menu className="w-5 h-5" />
        </Button>
      )}

      {!hideSearch && (
        <div className="topbar-search">
          <div className="topbar-search__inner">
            <Search className="topbar-search__icon" />
            <Input
              id="global-search"
              type="text"
              placeholder={isMobile ? "Buscar..." : "Buscar leads... (Ctrl+K)"}
              className="pl-10"
              value={ui.searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="topbar-actions">
        <NotificationCenter />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="topbar-icon-button rounded-full">
              <Avatar className="w-8 h-8">
                <AvatarFallback className="topbar-avatar">{userInitial}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut()}>
              <LogOut className="w-4 h-4 mr-2" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
