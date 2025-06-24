"use client";

import { BubbleMenu, type Editor } from "@tiptap/react";
import { BoldToolbar } from "@/components/tiptap/toolbars/bold.js";
import { ItalicToolbar } from "@/components/tiptap/toolbars/italic.js";
import { UnderlineToolbar } from "@/components/tiptap/toolbars/underline.js";
import { LinkToolbar } from "@/components/tiptap/toolbars/link.js";
import { ColorHighlightToolbar } from "@/components/tiptap/toolbars/color-and-highlight.js";
import { ToolbarProvider } from "@/components/tiptap/toolbars/toolbar-provider.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { useMediaQuery } from "@/hooks/use-media-querry.js";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area.js";
import { Separator } from "@/components/ui/separator.js";
import { HeadingsToolbar } from "@/components/tiptap/toolbars/headings.js";
import { BulletListToolbar } from "@/components/tiptap/toolbars/bullet-list.js";
import { OrderedListToolbar } from "@/components/tiptap/toolbars/ordered-list.js";
import { ImagePlaceholderToolbar } from "@/components/tiptap/toolbars/image-placeholder-toolbar.js";
import { AlignmentTooolbar } from "@/components/tiptap/toolbars/alignment.js";
import { BlockquoteToolbar } from "@/components/tiptap/toolbars/blockquote.js";
import { useEffect } from "react";

export function FloatingToolbar({ editor }: { editor: Editor | null }) {
  const isMobile = useMediaQuery("(max-width: 640px)");

  // Prevent default context menu on mobile
  useEffect(() => {
    if (!editor?.options.element || !isMobile) return;

    const handleContextMenu = (e: Event) => {
      e.preventDefault();
    };

    const el = editor.options.element;
    el.addEventListener("contextmenu", handleContextMenu);

    return () => el.removeEventListener("contextmenu", handleContextMenu);
  }, [editor, isMobile]);

  if (!editor) return null;

  if (isMobile) {
    return (
      <TooltipProvider>
        <BubbleMenu
          tippyOptions={{
            duration: 100,
            placement: "bottom",
            offset: [0, 10],
          }}
          shouldShow={() => {
            // Show toolbar when editor is focused and has selection
            return editor.isEditable && editor.isFocused;
          }}
          editor={editor}
          className="bg-background mx-0 w-full min-w-full rounded-sm border shadow-sm"
        >
          <ToolbarProvider editor={editor}>
            <ScrollArea className="h-fit w-full py-0.5">
              <div className="flex items-center gap-0.5 px-2">
                <div className="flex items-center gap-0.5 p-1">
                  {/* Primary formatting */}
                  <BoldToolbar />
                  <ItalicToolbar />
                  <UnderlineToolbar />
                  <Separator orientation="vertical" className="mx-1 h-6" />

                  {/* Structure controls */}
                  <HeadingsToolbar />
                  <BulletListToolbar />
                  <OrderedListToolbar />
                  <Separator orientation="vertical" className="mx-1 h-6" />

                  {/* Rich formatting */}
                  <ColorHighlightToolbar />
                  <LinkToolbar />
                  <ImagePlaceholderToolbar />
                  <Separator orientation="vertical" className="mx-1 h-6" />

                  {/* Additional controls */}
                  <AlignmentTooolbar />
                  <BlockquoteToolbar />
                </div>
              </div>
              <ScrollBar className="h-0.5" orientation="horizontal" />
            </ScrollArea>
          </ToolbarProvider>
        </BubbleMenu>
      </TooltipProvider>
    );
  }

  return null;
}
