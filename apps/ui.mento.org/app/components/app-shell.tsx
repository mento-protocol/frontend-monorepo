"use client";

import { SidebarProvider, SidebarTrigger, SidebarInset } from "@repo/ui";
import { CustomAppSidebar } from "./app-sidebar";
import { ThemeProvider } from "next-themes";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <SidebarProvider>
        <CustomAppSidebar />
        <SidebarInset>
          <header className="h-16 gap-2 px-4 flex shrink-0 items-center border-b">
            <SidebarTrigger className="-ml-1" />
          </header>
          <main className="flex-1 overflow-auto">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </ThemeProvider>
  );
}
