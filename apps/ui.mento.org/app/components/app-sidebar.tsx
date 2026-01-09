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
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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
      { name: "Calendar", description: "Date picker and calendar" },
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
      { name: "Toast", description: "Notification messages and alerts" },
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
  const [isClient, setIsClient] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());
  const router = useRouter();
  const pathname = usePathname();

  // Initialize client-side state after hydration
  useEffect(() => {
    setIsClient(true);

    // Load search query from localStorage
    try {
      const savedQuery = localStorage.getItem("sidebarSearchQuery") || "";
      setSearchQuery(savedQuery);
    } catch (e) {
      console.error("Failed to load search query", e);
    }

    // Load open categories from localStorage
    try {
      const saved = localStorage.getItem("sidebarOpenCategories");
      setOpenCategories(saved ? new Set(JSON.parse(saved)) : new Set());
    } catch (e) {
      console.error("Failed to load sidebar state", e);
    }
  }, []);

  // Handle category click - navigate and expand
  const handleCategoryClick = (category: (typeof componentCategories)[0]) => {
    router.push(category.url);
    setOpenCategories((prev) => {
      const newSet = new Set(prev).add(category.title);

      // Save to localStorage (only on client)
      if (isClient) {
        try {
          localStorage.setItem(
            "sidebarOpenCategories",
            JSON.stringify([...newSet]),
          );
        } catch (e) {
          console.error("Failed to save sidebar state", e);
        }
      }

      return newSet;
    });
  };

  // Handle toggle for collapsible
  const handleToggle = (categoryTitle: string, isOpen: boolean) => {
    setOpenCategories((prev) => {
      const newSet = new Set(prev);
      if (isOpen) {
        newSet.add(categoryTitle);
      } else {
        newSet.delete(categoryTitle);
      }

      // Save to localStorage (only on client)
      if (isClient) {
        try {
          localStorage.setItem(
            "sidebarOpenCategories",
            JSON.stringify([...newSet]),
          );
        } catch (e) {
          console.error("Failed to save sidebar state", e);
        }
      }

      return newSet;
    });
  };

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
        <SidebarGroupLabel className="h-16 gap-2 flex items-center">
          <Logo className="!h-12 !w-12" />
          <span className="text-lg text-foreground">UI Components</span>
        </SidebarGroupLabel>
        <div className="px-2 relative">
          <Search className="left-4 h-4 w-4 absolute top-1/2 -translate-y-1/2 text-muted-foreground" />
          <SidebarInput
            placeholder="Search components..."
            value={searchQuery}
            onChange={(e) => {
              const newQuery = e.target.value;
              setSearchQuery(newQuery);
              // Save search query to localStorage (only on client)
              if (isClient) {
                try {
                  localStorage.setItem("sidebarSearchQuery", newQuery);
                } catch (e) {
                  console.error("Failed to save search query", e);
                }
              }
            }}
            className="pl-8"
          />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {!isClient ? (
                // Show loading state on server-side to prevent layout shift
                <SidebarMenuItem>
                  <div className="px-2 py-4 text-sm text-center text-muted-foreground">
                    Loading...
                  </div>
                </SidebarMenuItem>
              ) : (
                filteredCategories.map((category) => (
                  <SidebarMenuItem key={category.title}>
                    <Collapsible
                      open={
                        !!searchQuery ||
                        openCategories.has(category.title) ||
                        (pathname?.startsWith(category.url) ?? false)
                      }
                      onOpenChange={(isOpen) =>
                        handleToggle(category.title, isOpen)
                      }
                      className="group/collapsible"
                    >
                      <div className="flex w-full items-center">
                        <SidebarMenuButton
                          className="flex-1 cursor-pointer"
                          onClick={() => handleCategoryClick(category)}
                          isActive={pathname?.startsWith(category.url) ?? false}
                        >
                          <category.icon className="h-4 w-4" />
                          <span>{category.title}</span>
                        </SidebarMenuButton>
                        <CollapsibleTrigger asChild>
                          <button className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-accent">
                            <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                          </button>
                        </CollapsibleTrigger>
                      </div>
                      <CollapsibleContent>
                        <SidebarMenuSub>
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
                ))
              )}

              {isClient && filteredCategories.length === 0 && searchQuery && (
                <SidebarMenuItem>
                  <div className="px-2 py-4 text-sm text-center text-muted-foreground">
                    No components found matching &quot;{searchQuery}&quot;
                  </div>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 flex">
        <ModeToggle />
      </SidebarFooter>
    </Sidebar>
  );
}
