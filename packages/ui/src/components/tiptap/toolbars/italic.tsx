"use client";

import { ItalicIcon } from "lucide-react";
import React from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useToolbar } from "./toolbar-provider";

const ItalicToolbar = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, onClick, children, ...props }, ref) => {
    const { editor } = useToolbar();
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-8 w-8 p-0 sm:h-9 sm:w-9",
              editor?.isActive("italic") && "bg-accent",
              className,
            )}
            onClick={(e) => {
              editor?.chain().focus().toggleItalic().run();
              onClick?.(e);
            }}
            disabled={!editor?.can().chain().focus().toggleItalic().run()}
            ref={ref}
            {...props}
          >
            {children ?? <ItalicIcon className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <span>Italic</span>
          <span className="text-gray-11 ml-1 text-xs">(cmd + i)</span>
        </TooltipContent>
      </Tooltip>
    );
  },
);

ItalicToolbar.displayName = "ItalicToolbar";

export { ItalicToolbar };
