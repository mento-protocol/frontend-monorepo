"use client";

import {
  Blocks,
  ChevronDown,
  FormInput,
  Layout,
  MousePointer,
  Navigation,
  Search,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Logo,
  ModeToggle,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@repo/ui";

// Component categories with their pages and individual components
const componentCategories = [
  {
    title: "Basic Components",
    icon: Blocks,
    url: "/basic-components",
    components: [
      { name: "Button", description: "Various button styles and states" },
      { name: "Badge", description: "Status indicators and labels" },
      { name: "Icons", description: "Common UI icons" },
    ],
  },
  {
    title: "Form Components",
    icon: FormInput,
    url: "/form-components",
    components: [
      { name: "Input", description: "Text input fields" },
      { name: "Textarea", description: "Multi-line text input" },
      { name: "Checkbox", description: "Checkbox controls" },
      { name: "Radio Group", description: "Radio button groups" },
      { name: "Select", description: "Dropdown select menus" },
      { name: "Slider", description: "Range slider controls" },
      { name: "Label", description: "Form field labels" },
    ],
  },
  {
    title: "Layout Components",
    icon: Layout,
    url: "/layout-components",
    components: [
      { name: "Tabs", description: "Tabbed content organization" },
      { name: "Accordion", description: "Collapsible content sections" },
      { name: "Collapsible", description: "Simple collapsible content" },
      { name: "Separator", description: "Visual content dividers" },
    ],
  },
  {
    title: "Specialized Components",
    icon: Sparkles,
    url: "/specialized-components",
    components: [
      { name: "Coin Card", description: "Cryptocurrency display cards" },
      {
        name: "Proposal Status",
        description: "Governance proposal status indicators",
      },
      { name: "Calendar", description: "Date picker and calendar" },
    ],
  },
  {
    title: "Interactive Components",
    icon: MousePointer,
    url: "/interactive-components",
    components: [
      { name: "Dialog", description: "Modal dialogs and overlays" },
      { name: "Popover", description: "Contextual content overlays" },
      { name: "Tooltip", description: "Hover information displays" },
    ],
  },
  {
    title: "Navigation Components",
    icon: Navigation,
    url: "/navigation-components",
    components: [
      { name: "Breadcrumb", description: "Navigation breadcrumb trails" },
      { name: "Pagination", description: "Page navigation controls" },
    ],
  },
];

export function CustomAppSidebar() {
  const [searchQuery, setSearchQuery] = useState("");

  // Filter categories and components based on search query
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return componentCategories;

    const query = searchQuery.toLowerCase();

    return componentCategories
      .map((category) => {
        // Check if category title matches
        const categoryMatches = category.title.toLowerCase().includes(query);

        // Filter components that match the search
        const matchingComponents = category.components.filter(
          (component) =>
            component.name.toLowerCase().includes(query) ||
            component.description.toLowerCase().includes(query),
        );

        // Include category if either the category matches or has matching components
        if (categoryMatches || matchingComponents.length > 0) {
          return {
            ...category,
            components: categoryMatches
              ? category.components
              : matchingComponents,
            categoryMatches,
          };
        }

        return null;
      })
      .filter(Boolean) as typeof componentCategories;
  }, [searchQuery]);

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarGroupLabel className="flex h-16 items-center gap-2">
          <Logo className="!h-12 !w-12" />
          <span className="text-foreground text-lg">UI Components</span>
        </SidebarGroupLabel>
        <div className="relative px-2">
          <Search className="text-muted-foreground absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" />
          <SidebarInput
            placeholder="Search components..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredCategories.map((category) => (
                <SidebarMenuItem key={category.title}>
                  <Collapsible
                    open={!!searchQuery || undefined}
                    className="group/collapsible"
                  >
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton className="w-full">
                        <category.icon className="h-4 w-4" />
                        <span>{category.title}</span>
                        <ChevronDown className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild>
                            <a href={category.url}>
                              <span>View All</span>
                            </a>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        {category.components.map((component) => (
                          <SidebarMenuSubItem key={component.name}>
                            <SidebarMenuSubButton asChild>
                              <a
                                href={category.url}
                                title={component.description}
                              >
                                <span>{component.name}</span>
                              </a>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </Collapsible>
                </SidebarMenuItem>
              ))}

              {filteredCategories.length === 0 && searchQuery && (
                <SidebarMenuItem>
                  <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                    No components found matching "{searchQuery}"
                  </div>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="flex p-4">
        <ModeToggle />
      </SidebarFooter>
    </Sidebar>
  );
}
