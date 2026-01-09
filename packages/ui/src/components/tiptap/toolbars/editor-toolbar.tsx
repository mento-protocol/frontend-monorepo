import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area.js";
import { Separator } from "@/components/ui/separator.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { Editor } from "@tiptap/core";
import { AlignmentTooolbar } from "./alignment.js";
import { BlockquoteToolbar } from "./blockquote.js";
import { BoldToolbar } from "./bold.js";
import { BulletListToolbar } from "./bullet-list.js";
import { CodeBlockToolbar } from "./code-block.js";
import { CodeToolbar } from "./code.js";
import { HeadingsToolbar } from "./headings.js";
import { ItalicToolbar } from "./italic.js";
import { LinkToolbar } from "./link.js";
import { OrderedListToolbar } from "./ordered-list.js";
import { StrikeThroughToolbar } from "./strikethrough.js";
import { ToolbarProvider } from "./toolbar-provider.js";
import { UnderlineToolbar } from "./underline.js";

export const EditorToolbar = ({ editor }: { editor: Editor }) => {
  return (
    <div className="mb-1 w-full border border-b border-input bg-input/30">
      <ToolbarProvider editor={editor}>
        <TooltipProvider>
          <ScrollArea className="py-0.5 h-fit">
            <div className="gap-1 px-2 flex items-center text-muted-foreground">
              <HeadingsToolbar />
              <BlockquoteToolbar />
              <CodeToolbar />
              <CodeBlockToolbar />
              <Separator orientation="vertical" className="mx-1 h-7" />

              {/* Basic Formatting Group */}
              <BoldToolbar />
              <ItalicToolbar />
              <UnderlineToolbar />
              <StrikeThroughToolbar />
              <LinkToolbar />
              <Separator orientation="vertical" className="mx-1 h-7" />

              {/* Lists & Structure Group */}
              <BulletListToolbar />
              <OrderedListToolbar />
              <Separator orientation="vertical" className="mx-1 h-7" />

              {/* Alignment Group */}
              <AlignmentTooolbar />
              <Separator orientation="vertical" className="mx-1 h-7" />
            </div>
            <ScrollBar className="hidden" orientation="horizontal" />
          </ScrollArea>
        </TooltipProvider>
      </ToolbarProvider>
    </div>
  );
};
