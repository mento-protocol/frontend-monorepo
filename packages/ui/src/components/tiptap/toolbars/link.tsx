"use client";

// @ts-nocheck
import { PopoverClose } from "@radix-ui/react-popover";
import { Trash2, X } from "lucide-react";

import React, { type FormEvent } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToolbar } from "./toolbar-provider";
import { getUrlFromString } from "@/lib/tiptap-utils";

const LinkToolbar = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, ...props }, ref) => {
    const { editor } = useToolbar();
    const [link, setLink] = React.useState("");
    const [open, setOpen] = React.useState(false);

    const handleSubmit = (e: FormEvent) => {
      e.preventDefault();
      const url = getUrlFromString(link);
      if (url) {
        editor?.chain().focus().setLink({ href: url }).run();
      }
      setOpen(false);
    };

    React.useEffect(() => {
      setLink(editor?.getAttributes("link").href ?? "");
    }, [editor]);

    return (
      <Popover modal={false} open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger
              disabled={!editor?.can().chain().setLink({ href: "" }).run()}
              asChild
            >
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-8 w-max px-3 font-normal",
                  editor?.isActive("link") && "bg-accent",
                  className,
                )}
                ref={ref}
                {...props}
              >
                <p className="mr-2 text-base">↗</p>
                <p className={"decoration-gray-7 underline underline-offset-4"}>
                  Link
                </p>
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <span>Link</span>
          </TooltipContent>
        </Tooltip>

        <PopoverContent
          onInteractOutside={(e) => {
            e.preventDefault();
          }}
        >
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <PopoverClose
              className="absolute right-3 top-3"
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" />
            </PopoverClose>
            <form onSubmit={handleSubmit}>
              <Label>Link</Label>
              <p className="text-gray-11 text-sm">
                Attach a link to the selected text
              </p>
              <div className="mt-3 flex flex-col items-end justify-end gap-3">
                <Input
                  value={link}
                  onChange={(e) => {
                    setLink(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  className="w-full"
                  placeholder="https://example.com"
                  autoFocus
                />
                <div className="flex items-center gap-3">
                  {editor?.getAttributes("link").href && (
                    <Button
                      type="reset"
                      size="sm"
                      className="text-gray-11 h-8"
                      variant="ghost"
                      onClick={() => {
                        editor?.chain().focus().unsetLink().run();
                        setLink("");
                      }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Remove
                    </Button>
                  )}
                  <Button size="sm" className="h-8">
                    {editor?.getAttributes("link").href ? "Update" : "Confirm"}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </PopoverContent>
      </Popover>
    );
  },
);

LinkToolbar.displayName = "LinkToolbar";

export { LinkToolbar };
