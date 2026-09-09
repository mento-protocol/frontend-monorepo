import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion.js";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible.js";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.js";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { Label } from "@/components/ui/label.js";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuIndicator,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  NavigationMenuViewport,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu.js";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination.js";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.js";
import {
  RadioGroupButtons,
  RadioGroupButtonsItem,
} from "@/components/ui/radio-group-buttons.js";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group.js";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { Separator } from "@/components/ui/separator.js";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet.js";
import { Slider } from "@/components/ui/slider.js";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.js";
import { Textarea } from "@/components/ui/textarea.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.js";

afterEach(cleanup);

describe("UI primitives", () => {
  it("composes navigation and disclosure primitives", () => {
    render(
      <>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbSeparator>→</BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
            <BreadcrumbEllipsis />
          </BreadcrumbList>
        </Breadcrumb>

        <Accordion type="single" defaultValue="item">
          <AccordionItem value="item">
            <AccordionTrigger>Question</AccordionTrigger>
            <AccordionContent>Answer</AccordionContent>
          </AccordionItem>
        </Accordion>

        <Collapsible defaultOpen>
          <CollapsibleTrigger>Toggle details</CollapsibleTrigger>
          <CollapsibleContent>Details</CollapsibleContent>
        </Collapsible>

        <Tabs defaultValue="first">
          <TabsList>
            <TabsTrigger value="first">First</TabsTrigger>
            <TabsTrigger value="second">Second</TabsTrigger>
          </TabsList>
          <TabsContent value="first">First panel</TabsContent>
          <TabsContent value="second">Second panel</TabsContent>
        </Tabs>
      </>,
    );

    expect(screen.getByText("Current")).toBeTruthy();
    expect(screen.getByText("Answer")).toBeTruthy();
    expect(screen.getByText("Details")).toBeTruthy();
    expect(screen.getByText("First panel")).toBeTruthy();
  });

  it("composes dialog, sheet, drawer, popover, and tooltip primitives", () => {
    render(
      <>
        <Dialog defaultOpen>
          <DialogTrigger>Open dialog</DialogTrigger>
          <DialogPortal>
            <DialogOverlay />
          </DialogPortal>
          <DialogContent showCloseButton>
            <DialogHeader>
              <DialogTitle>Dialog title</DialogTitle>
              <DialogDescription>Dialog description</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose>Done</DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Sheet open>
          <SheetContent side="left">
            <SheetHeader>
              <SheetTitle>Sheet title</SheetTitle>
            </SheetHeader>
          </SheetContent>
        </Sheet>

        <Drawer open direction="bottom">
          <DrawerTrigger>Open drawer</DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Drawer title</DrawerTitle>
            </DrawerHeader>
          </DrawerContent>
        </Drawer>

        <Popover open>
          <PopoverAnchor>Anchor</PopoverAnchor>
          <PopoverTrigger>Open popover</PopoverTrigger>
          <PopoverContent>Popover content</PopoverContent>
        </Popover>

        <TooltipProvider>
          <Tooltip open>
            <TooltipTrigger>Hover target</TooltipTrigger>
            <TooltipContent>Tooltip content</TooltipContent>
          </Tooltip>
          <Tooltip open>
            <TooltipTrigger>Second target</TooltipTrigger>
            <TooltipContent hideArrow>Second tooltip</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </>,
    );

    expect(screen.getByText("Dialog title")).toBeTruthy();
    expect(screen.getByText("Sheet title")).toBeTruthy();
    expect(screen.getByText("Drawer title")).toBeTruthy();
    expect(screen.getByText("Popover content")).toBeTruthy();
    expect(screen.getAllByText("Tooltip content").length).toBeGreaterThan(0);
  });

  it("composes menu and selection primitives", () => {
    render(
      <>
        <Command>
          <CommandList>
            <CommandEmpty>Nothing found</CommandEmpty>
            <CommandGroup heading="Actions">
              <CommandItem>Command item</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>

        <DropdownMenu open>
          <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
          <DropdownMenuPortal />
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuLabel inset>Options</DropdownMenuLabel>
              <DropdownMenuItem inset variant="destructive">
                Delete
                <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem checked>
                Checked
              </DropdownMenuCheckboxItem>
              <DropdownMenuRadioGroup value="one">
                <DropdownMenuRadioItem value="one">One</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuSub open>
                <DropdownMenuSubTrigger inset>More</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>Sub content</DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Select open value="one">
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="item-aligned">
            <SelectScrollUpButton />
            <SelectGroup>
              <SelectLabel>Values</SelectLabel>
              <SelectItem value="one">One</SelectItem>
              <SelectSeparator />
            </SelectGroup>
            <SelectScrollDownButton />
          </SelectContent>
        </Select>

        <RadioGroup defaultValue="one">
          <RadioGroupItem value="one" aria-label="One" />
          <RadioGroupItem value="two" aria-label="Two" />
        </RadioGroup>
        <RadioGroupButtons defaultValue="one">
          <RadioGroupButtonsItem value="one">One button</RadioGroupButtonsItem>
        </RadioGroupButtons>
      </>,
    );

    expect(screen.getByText("Command item")).toBeTruthy();
    expect(screen.getByText("Delete")).toBeTruthy();
    expect(screen.getAllByText("One").length).toBeGreaterThan(0);
  });

  it("renders navigation, pagination, form controls, and scrolling", () => {
    render(
      <>
        <NavigationMenu viewport={false}>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuTrigger>Products</NavigationMenuTrigger>
              <NavigationMenuContent>
                <NavigationMenuLink href="/swap">Swap</NavigationMenuLink>
              </NavigationMenuContent>
            </NavigationMenuItem>
            <NavigationMenuIndicator />
          </NavigationMenuList>
          <NavigationMenuViewport />
        </NavigationMenu>

        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious href="/previous" />
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="/1" isActive>
                1
              </PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext href="/next" />
            </PaginationItem>
            <PaginationEllipsis />
          </PaginationContent>
        </Pagination>

        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" />
        <Checkbox aria-label="Accept" defaultChecked />
        <Separator />
        <Separator orientation="vertical" decorative={false} />
        <Slider aria-label="Range" defaultValue={[25, 75]} />
        <Slider aria-label="Single" min={0} max={10} />
        <ScrollArea>
          Scrollable
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </>,
    );

    expect(navigationMenuTriggerStyle()).toContain("font-medium");
    expect(screen.getByRole("textbox", { name: "Notes" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Accept" })).toBeTruthy();
    expect(screen.getAllByRole("slider")).toHaveLength(3);
  });
});
