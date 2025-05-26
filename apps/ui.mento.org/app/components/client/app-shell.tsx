"use client";

import { SidebarProvider, SidebarTrigger } from "@repo/ui";
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
        <SidebarTrigger />
        {children}
      </SidebarProvider>
    </ThemeProvider>
  );
}
