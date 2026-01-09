"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Button,
} from "@repo/ui";

export default function InteractiveComponentsPage() {
  return (
    <div className="gap-8 p-6 flex w-full flex-col">
      <div className="space-y-2">
        <h1 className="font-bold text-3xl">Interactive Components</h1>
        <p className="text-muted-foreground">Dialogs, popovers, and tooltips</p>
      </div>

      <div className="gap-6 md:grid-cols-2 lg:grid-cols-3 grid grid-cols-1">
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
                  <p className="text-sm text-muted-foreground">
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
    </div>
  );
}
