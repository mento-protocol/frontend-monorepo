"use client";

import {
  // Layout Components
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  // Navigation Components
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  // Basic UI Components
  Button,
  Calendar,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  // Form Components
  Checkbox,
  // Specialized Components
  CoinCard,
  CoinCardFooter,
  CoinCardHeader,
  CoinCardHeaderGroup,
  CoinCardLogo,
  CoinCardName,
  CoinCardOrigin,
  CoinCardOriginFlag,
  CoinCardOriginText,
  CoinCardSupply,
  CoinCardSymbol,
  // Overlay Components
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  // Icons
  IconCheck,
  IconInfo,
  IconLoading,
  Input,
  Label,
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ProposalStatus,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Slider,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ui";

import Image from "next/image";
import { useState } from "react";
import USFlag from "./icons/us";

export function ClientComponents() {
  const [sliderValue, setSliderValue] = useState([50]);
  const [checkboxChecked, setCheckboxChecked] = useState(false);
  const [radioValue, setRadioValue] = useState("option1");
  const [selectValue, setSelectValue] = useState("");
  const [date, setDate] = useState<Date | undefined>(new Date());

  return (
    <div className="flex w-full flex-col gap-8 p-6">
      {/* Basic Components Section */}
      <section id="basic-components" className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">Basic Components</h2>
          <p className="text-muted-foreground">
            Fundamental UI building blocks
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Buttons */}
          <Card>
            <CardHeader>
              <CardTitle>Buttons</CardTitle>
              <CardDescription>
                Various button styles and states
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button>Default</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost">Ghost</Button>
                <Button variant="link">Link</Button>
                <Button variant="destructive">Destructive</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm">Small</Button>
                <Button size="lg">Large</Button>
                <Button disabled>Disabled</Button>
              </div>
            </CardContent>
          </Card>

          {/* Badges */}
          <Card>
            <CardHeader>
              <CardTitle>Badges</CardTitle>
              <CardDescription>Status indicators and labels</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge>Default</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="outline">Outline</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="destructive">Destructive</Badge>
              </div>
            </CardContent>
          </Card>

          {/* Icons */}
          <Card>
            <CardHeader>
              <CardTitle>Icons</CardTitle>
              <CardDescription>Common UI icons</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <IconCheck className="h-6 w-6" />
                <IconInfo className="h-6 w-6" />
                <IconLoading className="h-6 w-6 animate-spin" />
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <Separator />

      {/* Form Components Section */}
      <section id="form-components" className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">Form Components</h2>
          <p className="text-muted-foreground">
            Input controls and form elements
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Input & Textarea */}
          <Card>
            <CardHeader>
              <CardTitle>Text Inputs</CardTitle>
              <CardDescription>Text input and textarea fields</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="input-demo">Input Field</Label>
                <Input id="input-demo" placeholder="Enter text..." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="textarea-demo">Textarea</Label>
                <Textarea
                  id="textarea-demo"
                  placeholder="Enter longer text..."
                />
              </div>
            </CardContent>
          </Card>

          {/* Checkbox & Radio */}
          <Card>
            <CardHeader>
              <CardTitle>Selection Controls</CardTitle>
              <CardDescription>Checkboxes and radio buttons</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="checkbox-demo"
                  checked={checkboxChecked}
                  onCheckedChange={(checked) =>
                    setCheckboxChecked(checked === true)
                  }
                />
                <Label htmlFor="checkbox-demo">Checkbox option</Label>
              </div>

              <RadioGroup value={radioValue} onValueChange={setRadioValue}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="option1" id="r1" />
                  <Label htmlFor="r1">Option 1</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="option2" id="r2" />
                  <Label htmlFor="r2">Option 2</Label>
                </div>
              </RadioGroup>
            </CardContent>
          </Card>

          {/* Select & Slider */}
          <Card>
            <CardHeader>
              <CardTitle>Advanced Inputs</CardTitle>
              <CardDescription>Select dropdowns and sliders</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Select Option</Label>
                <Select value={selectValue} onValueChange={setSelectValue}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an option" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="option1">Option 1</SelectItem>
                    <SelectItem value="option2">Option 2</SelectItem>
                    <SelectItem value="option3">Option 3</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Slider ({sliderValue[0]})</Label>
                <Slider
                  value={sliderValue}
                  onValueChange={setSliderValue}
                  max={100}
                  step={1}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <Separator />

      {/* Layout Components Section */}
      <section id="layout-components" className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">Layout Components</h2>
          <p className="text-muted-foreground">
            Organize and structure content
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Tabs */}
          <Card>
            <CardHeader>
              <CardTitle>Tabs</CardTitle>
              <CardDescription>Tabbed content organization</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="tab1" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="tab1">Tab 1</TabsTrigger>
                  <TabsTrigger value="tab2">Tab 2</TabsTrigger>
                  <TabsTrigger value="tab3">Tab 3</TabsTrigger>
                </TabsList>
                <TabsContent value="tab1" className="mt-4">
                  <p>Content for tab 1</p>
                </TabsContent>
                <TabsContent value="tab2" className="mt-4">
                  <p>Content for tab 2</p>
                </TabsContent>
                <TabsContent value="tab3" className="mt-4">
                  <p>Content for tab 3</p>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Accordion */}
          <Card>
            <CardHeader>
              <CardTitle>Accordion</CardTitle>
              <CardDescription>Collapsible content sections</CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="item-1">
                  <AccordionTrigger>Section 1</AccordionTrigger>
                  <AccordionContent>
                    Content for the first accordion section.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-2">
                  <AccordionTrigger>Section 2</AccordionTrigger>
                  <AccordionContent>
                    Content for the second accordion section.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        </div>
      </section>

      <Separator />

      {/* Specialized Components Section */}
      <section id="specialized-components" className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">Specialized Components</h2>
          <p className="text-muted-foreground">Domain-specific UI components</p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Coin Card */}
          <div>
            <CoinCard className="h-fit">
              <CoinCardHeader>
                <CoinCardHeaderGroup>
                  <CoinCardSymbol>cUSD</CoinCardSymbol>
                  <CoinCardName>Celo Dollar</CoinCardName>
                </CoinCardHeaderGroup>
                <CoinCardLogo>
                  <Image
                    src="/celoDollar.png"
                    alt="Celo Dollar"
                    width={56}
                    height={56}
                    className="h-14 w-14"
                  />
                </CoinCardLogo>
              </CoinCardHeader>
              <CoinCardFooter>
                <CoinCardOrigin>
                  <CoinCardOriginFlag>
                    <USFlag className="h-4 w-4" />
                  </CoinCardOriginFlag>
                  <CoinCardOriginText>United States</CoinCardOriginText>
                </CoinCardOrigin>
                <CoinCardSupply>$464,278</CoinCardSupply>
              </CoinCardFooter>
            </CoinCard>
          </div>

          {/* Proposal Status */}
          <Card>
            <CardHeader>
              <CardTitle>Proposal Status</CardTitle>
              <CardDescription>Status indicators for proposals</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <ProposalStatus variant="active">Active</ProposalStatus>
                <ProposalStatus variant="succeeded">Succeeded</ProposalStatus>
                <ProposalStatus variant="defeated">Defeated</ProposalStatus>
              </div>
              <div className="flex flex-wrap gap-2">
                <ProposalStatus variant="pending">Pending</ProposalStatus>
                <ProposalStatus variant="queued">Queued</ProposalStatus>
                <ProposalStatus variant="executed">Executed</ProposalStatus>
              </div>
            </CardContent>
          </Card>

          {/* Calendar */}
          <Card>
            <CardHeader>
              <CardTitle>Calendar</CardTitle>
              <CardDescription>Date picker component</CardDescription>
            </CardHeader>
            <CardContent>
              <Calendar
                mode="single"
                selected={date}
                onSelect={setDate}
                className="rounded-md border"
              />
            </CardContent>
          </Card>
        </div>
      </section>

      <Separator />

      {/* Interactive Components Section */}
      <section id="interactive-components" className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">Interactive Components</h2>
          <p className="text-muted-foreground">
            Dialogs, popovers, and tooltips
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Dialog */}
          <Card>
            <CardHeader>
              <CardTitle>Dialog</CardTitle>
              <CardDescription>Modal dialogs and overlays</CardDescription>
            </CardHeader>
            <CardContent>
              <Dialog>
                <DialogTrigger asChild>
                  <Button>Open Dialog</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Dialog Title</DialogTitle>
                    <DialogDescription>
                      This is a sample dialog with some content.
                    </DialogDescription>
                  </DialogHeader>
                  <p>Dialog content goes here.</p>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          {/* Popover */}
          <Card>
            <CardHeader>
              <CardTitle>Popover</CardTitle>
              <CardDescription>Contextual content overlays</CardDescription>
            </CardHeader>
            <CardContent>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline">Open Popover</Button>
                </PopoverTrigger>
                <PopoverContent>
                  <div className="space-y-2">
                    <h4 className="font-medium">Popover Content</h4>
                    <p className="text-muted-foreground text-sm">
                      This is popover content with some information.
                    </p>
                  </div>
                </PopoverContent>
              </Popover>
            </CardContent>
          </Card>

          {/* Tooltip */}
          <Card>
            <CardHeader>
              <CardTitle>Tooltip</CardTitle>
              <CardDescription>Hover information displays</CardDescription>
            </CardHeader>
            <CardContent>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline">Hover me</Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>This is a tooltip</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </CardContent>
          </Card>
        </div>
      </section>

      <Separator />

      {/* Navigation Components Section */}
      <section id="navigation-components" className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">Navigation Components</h2>
          <p className="text-muted-foreground">
            Navigation and wayfinding elements
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Breadcrumb */}
          <Card>
            <CardHeader>
              <CardTitle>Breadcrumb</CardTitle>
              <CardDescription>Navigation breadcrumb trail</CardDescription>
            </CardHeader>
            <CardContent>
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink href="/">Home</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbLink href="/components">
                      Components
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>Current Page</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </CardContent>
          </Card>

          {/* Pagination */}
          <Card>
            <CardHeader>
              <CardTitle>Pagination</CardTitle>
              <CardDescription>Page navigation controls</CardDescription>
            </CardHeader>
            <CardContent>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious href="#" />
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#" isActive>
                      1
                    </PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#">2</PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#">3</PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext href="#" />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
