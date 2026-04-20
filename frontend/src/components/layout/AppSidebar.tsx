import { NavLink, useLocation } from "react-router-dom";
import {
  Database,
  Sparkles,
  MessageSquare,
  LayoutDashboard,
  FileText,
  Settings,
  Activity,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const workspaceItems = [
  { title: "Insights",     url: "/",           icon: Sparkles,        end: true },
  { title: "Data Sources", url: "/data",       icon: Database },
  { title: "Query",        url: "/query",      icon: MessageSquare },
  { title: "Dashboards",   url: "/dashboards", icon: LayoutDashboard },
  { title: "Reports",      url: "/reports",    icon: FileText },
];

export const AppSidebar = () => {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();

  const isActive = (url: string, end?: boolean) =>
    end ? pathname === url : pathname === url || pathname.startsWith(url + "/");

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="h-14 border-b border-sidebar-border px-2">
        <div
          className={cn(
            "flex items-center h-full min-w-0",
            collapsed ? "justify-center" : "gap-2.5 px-2"
          )}
        >
          <div className="relative h-8 w-8 rounded-lg bg-gradient-accent flex items-center justify-center shadow-glow shrink-0">
            <Activity className="h-5 w-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-none min-w-0 animate-fade-in">
              <span className="text-[15px] font-bold tracking-tight text-foreground truncate">
                Intelligence
              </span>
              <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground mt-0.5 truncate">
                Data Platform
              </span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className={cn("py-3", collapsed ? "px-1.5" : "px-2")}>
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
              Workspace
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className={collapsed ? "gap-1" : ""}>
              {workspaceItems.map((item) => {
                const active = isActive(item.url, item.end);
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      isActive={active}
                      className={cn(
                        "h-9 rounded-md transition-colors",
                        collapsed && "justify-center"
                      )}
                    >
                      <NavLink to={item.url} end={item.end}>
                        <item.icon
                          className={cn(
                            "h-4 w-4 shrink-0 transition-colors",
                            active ? "text-accent" : "text-muted-foreground"
                          )}
                        />
                        {!collapsed && (
                          <span className="font-medium text-sm">{item.title}</span>
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter
        className={cn(
          "border-t border-sidebar-border",
          collapsed ? "p-1.5" : "p-2"
        )}
      >
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="Settings"
              isActive={isActive("/settings")}
              className={cn("h-9 rounded-md", collapsed && "justify-center")}
            >
              <NavLink to="/settings" className="group">
                <Settings
                  className={cn(
                    "h-4 w-4 shrink-0 transition-transform duration-500 group-hover:rotate-45",
                    isActive("/settings") ? "text-accent" : "text-muted-foreground"
                  )}
                />
                {!collapsed && (
                  <span className="font-medium text-sm">Settings</span>
                )}
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
};
