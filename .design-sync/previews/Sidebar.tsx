import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
} from "@mento-protocol/ui";

export const AppSidebar = () => (
  <SidebarProvider style={{ minHeight: 480 }}>
    <Sidebar collapsible="none">
      <SidebarHeader>
        <div style={{ padding: "8px 12px", fontWeight: 600 }}>Mento</div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive>Swap</SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton>Reserve</SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton>Governance</SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div
          style={{
            padding: "8px 12px",
            fontSize: 12,
            color: "var(--muted-foreground)",
          }}
        >
          Connected: mento.eth
        </div>
      </SidebarFooter>
    </Sidebar>
  </SidebarProvider>
);
