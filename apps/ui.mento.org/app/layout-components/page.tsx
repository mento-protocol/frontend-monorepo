"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Button,
} from "@repo/ui";
import { useState } from "react";

export default function LayoutComponentsPage() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="gap-8 p-6 flex w-full flex-col">
      <div className="space-y-2">
        <h1 className="font-bold text-3xl">Layout Components</h1>
        <p className="text-muted-foreground">Organize and structure content</p>
      </div>

      <div className="gap-6 lg:grid-cols-2 grid grid-cols-1">
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

        {/* Collapsible */}
        <Card>
          <CardHeader>
            <CardTitle>Collapsible</CardTitle>
            <CardDescription>Simple collapsible content</CardDescription>
          </CardHeader>
          <CardContent>
            <Collapsible open={isOpen} onOpenChange={setIsOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  Toggle Content
                  <span className="text-xs">{isOpen ? "Hide" : "Show"}</span>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-4 rounded p-4 border">
                <p>This content can be collapsed and expanded.</p>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
