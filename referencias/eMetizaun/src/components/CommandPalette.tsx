import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Star,
  Mail,
  Eye,
  Plus,
  CheckSquare,
  StickyNote,
  Calendar,
  Settings,
  Building2,
  Users,
  Target,
  UserPlus,
  BarChart3,
  ArrowUp,
  ArrowDown,
  CornerDownLeft,
} from "lucide-react";

interface CommandAction {
  id: string;
  title: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  section: string;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const actions: CommandAction[] = [
    // Quick Actions
    {
      id: "search-records",
      title: "Search records",
      icon: Search,
      shortcut: "/",
      section: "Quick Action",
      action: () => {
        navigate("/search");
        onOpenChange(false);
      },
    },
    {
      id: "create-task",
      title: "Create task",
      icon: CheckSquare,
      shortcut: "T",
      section: "Quick Action",
      action: () => {
        navigate("/tasks");
        onOpenChange(false);
      },
    },
    {
      id: "create-note",
      title: "Create note",
      icon: StickyNote,
      shortcut: "N",
      section: "Quick Action",
      action: () => {
        navigate("/notes");
        onOpenChange(false);
      },
    },
    {
      id: "open-settings",
      title: "Open account settings",
      icon: Settings,
      section: "Quick Action",
      action: () => {
        navigate("/settings");
        onOpenChange(false);
      },
    },
    // Navigation
    {
      id: "nav-dashboard",
      title: "Dashboard",
      icon: BarChart3,
      section: "Navigation",
      action: () => {
        navigate("/dashboard");
        onOpenChange(false);
      },
    },
    {
      id: "nav-companies",
      title: "Companies",
      icon: Building2,
      section: "Navigation",
      action: () => {
        navigate("/companies");
        onOpenChange(false);
      },
    },
    {
      id: "nav-contacts",
      title: "Contacts",
      icon: Users,
      section: "Navigation",
      action: () => {
        navigate("/contacts");
        onOpenChange(false);
      },
    },
    {
      id: "nav-leads",
      title: "Leads",
      icon: UserPlus,
      section: "Navigation",
      action: () => {
        navigate("/leads");
        onOpenChange(false);
      },
    },
    {
      id: "nav-deals",
      title: "Deals",
      icon: Target,
      section: "Navigation",
      action: () => {
        navigate("/deals");
        onOpenChange(false);
      },
    },
    {
      id: "nav-tasks",
      title: "Tasks",
      icon: CheckSquare,
      section: "Navigation",
      action: () => {
        navigate("/tasks");
        onOpenChange(false);
      },
    },
    {
      id: "nav-notes",
      title: "Notes",
      icon: StickyNote,
      section: "Navigation",
      action: () => {
        navigate("/notes");
        onOpenChange(false);
      },
    },
    {
      id: "nav-reports",
      title: "Reports",
      icon: BarChart3,
      section: "Navigation",
      action: () => {
        navigate("/reports");
        onOpenChange(false);
      },
    },
    // Create Actions
    {
      id: "add-company",
      title: "Add company",
      icon: Building2,
      shortcut: "C",
      section: "Create",
      action: () => {
        navigate("/companies");
        onOpenChange(false);
        // This would typically open the add dialog
      },
    },
    {
      id: "add-contact",
      title: "Add contact",
      icon: Users,
      section: "Create",
      action: () => {
        navigate("/contacts");
        onOpenChange(false);
      },
    },
    {
      id: "add-lead",
      title: "Add lead",
      icon: UserPlus,
      section: "Create",
      action: () => {
        navigate("/leads");
        onOpenChange(false);
      },
    },
    {
      id: "add-deal",
      title: "Add deal",
      icon: Target,
      section: "Create",
      action: () => {
        navigate("/deals");
        onOpenChange(false);
      },
    },
  ];

  const filteredActions = actions.filter((action) => {
    if (!search) return true;
    return (
      action.title.toLowerCase().includes(search.toLowerCase()) ||
      action.section.toLowerCase().includes(search.toLowerCase()) ||
      (action.description && action.description.toLowerCase().includes(search.toLowerCase()))
    );
  });

  // Group actions by section
  const groupedActions = filteredActions.reduce((acc, action) => {
    if (!acc[action.section]) {
      acc[action.section] = [];
    }
    acc[action.section].push(action);
    return acc;
  }, {} as Record<string, CommandAction[]>);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, filteredActions.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filteredActions[selectedIndex]) {
            filteredActions[selectedIndex].action();
          }
          break;
        case "Escape":
          onOpenChange(false);
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, filteredActions, selectedIndex, onOpenChange]);

  // Handle individual shortcut keys
  useEffect(() => {
    const handleShortcuts = (e: KeyboardEvent) => {
      if (!open) return;
      
      // Don't trigger if user is typing in input
      if (document.activeElement === inputRef.current) return;

      const action = actions.find(a => a.shortcut?.toLowerCase() === e.key.toLowerCase());
      if (action) {
        e.preventDefault();
        action.action();
      }
    };

    document.addEventListener("keydown", handleShortcuts);
    return () => document.removeEventListener("keydown", handleShortcuts);
  }, [open, actions]);

  // Reset selection when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  // Focus input when dialog opens
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  let currentIndex = 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <div className="border-b">
          <div className="flex items-center px-4">
            <Search className="h-4 w-4 text-muted-foreground mr-3" />
            <Input
              ref={inputRef}
              placeholder="Search quick actions and records..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-0 bg-transparent text-lg h-14 focus:ring-0 focus:outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="max-h-96 overflow-y-auto p-2">
          {Object.entries(groupedActions).map(([section, sectionActions]) => {
            const sectionStart = currentIndex;
            const sectionItems = sectionActions.map((action, index) => {
              const globalIndex = currentIndex++;
              const isSelected = globalIndex === selectedIndex;

              return (
                <div
                  key={action.id}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                    isSelected ? "bg-muted" : "hover:bg-muted/50"
                  }`}
                  onClick={() => action.action()}
                >
                  <div className="flex items-center space-x-3">
                    <action.icon className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="font-medium">{action.title}</div>
                      {action.description && (
                        <div className="text-sm text-muted-foreground">
                          {action.description}
                        </div>
                      )}
                    </div>
                  </div>
                  {action.shortcut && (
                    <Badge variant="secondary" className="text-xs px-2 py-1">
                      {action.shortcut}
                    </Badge>
                  )}
                </div>
              );
            });

            return (
              <div key={section} className="mb-4">
                <div className="px-3 py-1 text-sm font-medium text-muted-foreground">
                  {section}
                </div>
                <div className="space-y-1">{sectionItems}</div>
              </div>
            );
          })}

          {filteredActions.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No results found</p>
              <p className="text-sm">Try a different search term</p>
            </div>
          )}
        </div>

        <div className="border-t px-4 py-3">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-1">
                <ArrowUp className="h-3 w-3" />
                <ArrowDown className="h-3 w-3" />
                <span>Navigate</span>
              </div>
              <div className="flex items-center space-x-1">
                <CornerDownLeft className="h-3 w-3" />
                <span>Select</span>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Badge variant="outline" className="text-xs">
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Badge>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}