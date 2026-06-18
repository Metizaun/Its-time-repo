import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { TopHeader } from "./TopHeader";
import { cn } from "@/lib/utils";

interface MainLayoutProps {
  children: React.ReactNode;
  fluid?: boolean;
  noPadding?: boolean;
}

export function MainLayout({ children, fluid = false, noPadding = false }: MainLayoutProps) {
  return (
    <SidebarProvider>
      <div className="flex h-svh w-full overflow-hidden">
        <AppSidebar />
        <SidebarInset className={cn("min-h-0", fluid && "overflow-hidden")}>
          <TopHeader />
          <main className={cn("flex-1 min-h-0 bg-background", fluid ? "overflow-hidden" : "overflow-y-auto")}>
            <div
              className={cn(
                !noPadding && "px-6 py-4",
                fluid
                  ? "h-full min-h-0 w-full overflow-hidden"
                  : "container mx-auto min-h-full"
              )}
            >
              {children}
            </div>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
