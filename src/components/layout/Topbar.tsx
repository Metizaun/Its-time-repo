import { Search, Bell, LogOut, Menu } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AnimatedThemeToggle } from "@/components/ThemeToggle";
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

interface TopbarProps {
  onOpenMobileSidebar?: () => void;
  isMobile?: boolean;
}

export function Topbar({ onOpenMobileSidebar, isMobile }: TopbarProps) {
  const { setSearchQuery, ui } = useApp();
  const { user, signOut } = useAuth();

  const userInitial = user?.email?.charAt(0).toUpperCase() || "U";

  useEffect(() => {
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
  }, []);

  return (
    <header className="h-14 md:h-16 border-b border-border bg-card/50 backdrop-blur-sm flex items-center px-3 md:px-6 sticky top-0 z-10 gap-2">
      {/* Hamburger — mobile only */}
      {isMobile && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Abrir menu"
          className="shrink-0 md:hidden"
          onClick={onOpenMobileSidebar}
        >
          <Menu className="w-5 h-5" />
        </Button>
      )}

      {/* Search bar */}
      <div className="flex-1 min-w-0 max-w-[200px] sm:max-w-xs md:max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            id="global-search"
            type="text"
            placeholder={isMobile ? "Buscar..." : "Buscar leads... (Ctrl+K)"}
            className="pl-10 bg-background"
            value={ui.searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-1 sm:gap-3 ml-auto shrink-0">
        <AnimatedThemeToggle />

        <Button variant="ghost" size="icon" className="hidden sm:inline-flex">
          <Bell className="w-5 h-5" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <Avatar className="w-8 h-8">
                <AvatarFallback className="bg-primary/10 text-primary">
                  {userInitial}
                </AvatarFallback>
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
