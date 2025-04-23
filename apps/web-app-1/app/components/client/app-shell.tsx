"use client";

import { SidebarProvider, SidebarTrigger } from "@repo/ui";
import { CustomAppSidebar } from "./app-sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <CustomAppSidebar />
      <SidebarTrigger />
      {children}
    </SidebarProvider>
  );
}
