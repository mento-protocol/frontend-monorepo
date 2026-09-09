import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar.js";
import { useIsMobile } from "@/hooks/use-mobile.js";

vi.mock("@/hooks/use-mobile.js", () => ({ useIsMobile: vi.fn() }));

const mockedUseIsMobile = vi.mocked(useIsMobile);

function SidebarState() {
  const { state, openMobile } = useSidebar();
  return <output>{`${state}:${openMobile}`}</output>;
}

function CompleteSidebar() {
  return (
    <SidebarProvider>
      <Sidebar side="right" variant="floating" collapsible="icon">
        <SidebarHeader>
          <SidebarInput aria-label="Search" />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Group</SidebarGroupLabel>
            <SidebarGroupLabel asChild>
              <h2>Child group</h2>
            </SidebarGroupLabel>
            <SidebarGroupAction aria-label="Group action" />
            <SidebarGroupAction asChild>
              <a href="#group">Child action</a>
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton>Plain item</SidebarMenuButton>
                  <SidebarMenuButton tooltip="Text tooltip">
                    Tooltip item
                  </SidebarMenuButton>
                  <SidebarMenuButton
                    asChild
                    size="lg"
                    variant="outline"
                    isActive
                    tooltip={{ children: "Object tooltip" }}
                  >
                    <a href="#item">Child item</a>
                  </SidebarMenuButton>
                  <SidebarMenuAction aria-label="Menu action" />
                  <SidebarMenuAction asChild showOnHover>
                    <a href="#menu-action">Child menu action</a>
                  </SidebarMenuAction>
                  <SidebarMenuBadge>4</SidebarMenuBadge>
                  <SidebarMenuSkeleton />
                  <SidebarMenuSkeleton showIcon />
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton href="#sub" size="sm" isActive>
                        Sub item
                      </SidebarMenuSubButton>
                      <SidebarMenuSubButton asChild>
                        <a href="#child-sub">Child sub item</a>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarSeparator />
        <SidebarFooter>Footer</SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>Content</SidebarInset>
      <SidebarState />
    </SidebarProvider>
  );
}

describe("Sidebar", () => {
  beforeEach(() => {
    mockedUseIsMobile.mockReturnValue(false);
    document.cookie = "sidebar_state=; max-age=0";
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("requires consumers to use the provider", () => {
    expect(() => render(<SidebarState />)).toThrow(
      "useSidebar must be used within a SidebarProvider.",
    );
  });

  it("renders the complete desktop composition", () => {
    render(<CompleteSidebar />);

    expect(screen.getByText("expanded:false")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Search" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Child group" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Child item" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Child sub item" })).toBeTruthy();
  });

  it("toggles uncontrolled desktop state from the trigger, rail, and shortcut", () => {
    render(
      <SidebarProvider defaultOpen={false}>
        <SidebarTrigger />
        <SidebarRail />
        <SidebarState />
      </SidebarProvider>,
    );

    expect(screen.getByText("collapsed:false")).toBeTruthy();
    const controls = screen.getAllByRole("button", { name: "Toggle Sidebar" });
    fireEvent.click(controls[0]!);
    expect(screen.getByText("expanded:false")).toBeTruthy();

    fireEvent.click(controls[1]!);
    expect(screen.getByText("collapsed:false")).toBeTruthy();

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.getByText("expanded:false")).toBeTruthy();
    fireEvent.keyDown(window, { key: "x", ctrlKey: true });
    expect(screen.getByText("expanded:false")).toBeTruthy();
  });

  it("reports controlled state changes and preserves the trigger handler", () => {
    const onOpenChange = vi.fn();
    const onClick = vi.fn();
    render(
      <SidebarProvider open={false} onOpenChange={onOpenChange}>
        <SidebarTrigger onClick={onClick} />
        <SidebarState />
      </SidebarProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(document.cookie).toContain("sidebar_state=true");
  });

  it("renders non-collapsible and alternate desktop variants", () => {
    const { rerender } = render(
      <SidebarProvider>
        <Sidebar collapsible="none">Fixed</Sidebar>
      </SidebarProvider>,
    );
    expect(
      screen.getByText("Fixed").closest("[data-slot=sidebar]"),
    ).toBeTruthy();

    rerender(
      <SidebarProvider defaultOpen={false}>
        <Sidebar side="left" variant="inset" collapsible="offcanvas">
          Inset
        </Sidebar>
      </SidebarProvider>,
    );
    expect(screen.getByText("Inset")).toBeTruthy();
  });

  it("toggles the mobile sheet state", () => {
    mockedUseIsMobile.mockReturnValue(true);
    render(
      <SidebarProvider>
        <Sidebar>Mobile content</Sidebar>
        <SidebarTrigger />
        <SidebarState />
      </SidebarProvider>,
    );

    expect(screen.getByText("expanded:false")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    expect(screen.getByText("expanded:true")).toBeTruthy();
    expect(screen.getByText("Mobile content")).toBeTruthy();
  });
});
