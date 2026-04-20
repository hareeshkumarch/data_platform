import { ReactNode, useEffect } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";
import { useAppStore, AppStatus } from "@/store/useAppStore";
import { useThemeSync } from "@/hooks/useThemeSync";

interface AppShellProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  status?: AppStatus;
  rightPanel?: ReactNode;
}

export const AppShell = ({
  children,
  title,
  subtitle,
  status,
  rightPanel,
}: AppShellProps) => {
  useThemeSync();

  // Update document.title on page change (#45)
  useEffect(() => {
    document.title = title ? `${title} — Data Intelligence Platform` : "Data Intelligence Platform";
  }, [title]);

  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);

  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <div className="min-h-screen w-full flex bg-background text-foreground">
        <AppSidebar />

        <div className="flex-1 flex flex-col min-w-0">
          <TopBar title={title} subtitle={subtitle} status={status} />

          <div className="flex-1 flex min-h-0">
            <main className="flex-1 min-w-0 overflow-y-auto">
              <div key={title} className="animate-fade-in">
                {children}
              </div>
            </main>

            {rightPanel && (
              <aside className="hidden xl:block w-80 shrink-0 border-l border-border bg-surface/40 overflow-y-auto animate-slide-in-right">
                {rightPanel}
              </aside>
            )}
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
};
