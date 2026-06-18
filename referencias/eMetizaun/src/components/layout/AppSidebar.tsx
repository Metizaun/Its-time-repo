import { useState } from "react";
import { Home, Users, Building2, Target, CheckSquare, BarChart3, Settings, ChevronDown, ChevronRight, UserPlus, Bell, StickyNote, Sparkles, Handshake, Search, Keyboard, Database, List, PenTool, CalendarDays, Inbox, Instagram } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, useSidebar, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import CRMLogo from "../CRMLogo";
import { CommandPalette } from "../CommandPalette";
import { useCommandPalette } from "@/hooks/useCommandPalette";
import { useNotifications } from "@/hooks/useNotifications";
const mainNavigationItems = [{
  title: "Dashboard",
  icon: Home,
  url: "/dashboard"
}];
const quickActionItems = [{
  title: "Inbox",
  icon: Inbox,
  url: "/inbox"
}, {
  title: "Notifications",
  icon: Bell,
  url: "/notifications"
}, {
  title: "Tasks",
  icon: CheckSquare,
  url: "/tasks"
}, {
  title: "Calendar",
  icon: CalendarDays,
  url: "/calendar"
}, {
  title: "Create",
  icon: PenTool,
  url: "/create"
}, {
  title: "Instagram Analyzer",
  icon: Instagram,
  url: "/instagram-analyzer"
}, {
  title: "Notes",
  icon: StickyNote,
  url: "/notes"
}, {
  title: "AI Assistant",
  icon: Sparkles,
  url: "/ai-assistant"
}, {
  title: "Reports",
  icon: BarChart3,
  url: "/reports"
}];
const recordItems = [{
  title: "Companies",
  icon: Building2,
  url: "/companies",
  color: "bg-blue-500"
}, {
  title: "People",
  icon: Users,
  url: "/contacts",
  color: "bg-sky-500"
}, {
  title: "Leads",
  icon: UserPlus,
  url: "/leads",
  color: "bg-green-500"
}, {
  title: "Lists",
  icon: List,
  url: "/lists",
  color: "bg-violet-500"
}, {
  title: "Deals",
  icon: Target,
  url: "/deals",
  color: "bg-orange-500"
}, {
  title: "Partners",
  icon: Handshake,
  url: "/partners",
  color: "bg-purple-500"
}];
export function AppSidebar() {
  const {
    state
  } = useSidebar();
  const location = useLocation();
  const currentPath = location.pathname;
  const isActive = (path: string) => currentPath === path;
  const {
    isOpen,
    setIsOpen,
    open
  } = useCommandPalette();
  const [recordsOpen, setRecordsOpen] = useState(true);
  const { unreadCount } = useNotifications();
  return <Sidebar collapsible="icon">
      <SidebarHeader className={state === "collapsed" ? "py-3 px-2 border-b" : "p-4 border-b"}>
        <div className={state === "collapsed" ? "flex items-center justify-center h-full" : "flex items-center justify-between"}>
          <CRMLogo className="h-8" showText={state !== "collapsed"} size="md" />
        </div>
      </SidebarHeader>
      
      <SidebarContent>
        {/* Main Navigation */}
        <SidebarGroup className="group-data-[collapsible=icon]:px-2 px-3 pt-6">
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavigationItems.map(item => <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                   <NavLink to={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Quick Actions */}
        <SidebarGroup className="group-data-[collapsible=icon]:px-2 px-3">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={open} tooltip="Quick actions (⌘K)">
                  <Keyboard className="h-4 w-4" />
                  <span>Quick actions</span>
                  {state !== "collapsed" && (
                    <>
                      <div className="ml-auto flex items-center gap-1 text-xs bg-muted px-1.5 py-0.5 rounded">
                        ⌘K
                      </div>
                      <Search className="h-3 w-3" />
                    </>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Individual Actions */}
        <SidebarGroup className="group-data-[collapsible=icon]:px-2 px-3">
          <SidebarGroupContent>
            <SidebarMenu>
              {quickActionItems.map(item => <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                     <NavLink to={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                      {item.title === "Notifications" && unreadCount > 0 && (
                        <Badge 
                          variant="destructive" 
                          className="ml-auto h-5 min-w-5 text-xs px-1.5 flex items-center justify-center"
                        >
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </Badge>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>


        {/* Records */}
        <SidebarGroup className="group-data-[collapsible=icon]:px-2 px-3">
          <SidebarGroupContent>
            <SidebarMenu>
              <Collapsible open={recordsOpen} onOpenChange={setRecordsOpen}>
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip="Data Records">
                      <Database className="h-4 w-4" />
                      <span>Data Records</span>
                      {state !== "collapsed" && (
                        <ChevronRight className={`h-3 w-3 ml-auto transition-transform ${recordsOpen ? 'rotate-90' : ''}`} />
                      )}
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  {state !== "collapsed" && (
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {recordItems.map(item => (
                          <SidebarMenuSubItem key={item.title}>
                            <SidebarMenuSubButton asChild isActive={isActive(item.url)}>
                              <NavLink to={item.url}>
                                <div className={`h-3 w-3 rounded-sm ${item.color}`} />
                                <span>{item.title}</span>
                              </NavLink>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  )}
                </SidebarMenuItem>
              </Collapsible>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>


        {/* Settings at bottom */}
        <SidebarGroup className="mt-auto group-data-[collapsible=icon]:px-2 px-3">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/settings")} tooltip="Settings">
                  <NavLink to="/settings">
                    <Settings className="h-4 w-4" />
                    <span>Settings</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      
      <CommandPalette open={isOpen} onOpenChange={setIsOpen} />
    </Sidebar>;
}
