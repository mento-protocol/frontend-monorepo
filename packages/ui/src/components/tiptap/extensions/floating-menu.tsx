"use client";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command.js";
import { ScrollArea } from "@/components/ui/scroll-area.js";
import { useDebounce } from "@/hooks/use-debounce.js";
import { cn } from "@/lib/utils.js";
import type { Editor } from "@tiptap/core";
import { FloatingMenu } from "@tiptap/react/menus";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronRight,
  Code2,
  CodeSquare,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Minus,
  Quote,
  TextQuote,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface CommandItemType {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords: string;
  command: (editor: Editor) => void;
  group: string;
}

type CommandGroupType = {
  group: string;
  items: Omit<CommandItemType, "group">[];
};

const groups: CommandGroupType[] = [
  {
    group: "Basic blocks",
    items: [
      {
        title: "Text",
        description: "Just start writing with plain text",
        icon: ChevronRight,
        keywords: "paragraph text",
        command: (editor) => editor.chain().focus().clearNodes().run(),
      },
      {
        title: "Heading 1",
        description: "Large section heading",
        icon: Heading1,
        keywords: "h1 title header",
        command: (editor) =>
          editor.chain().focus().toggleHeading({ level: 1 }).run(),
      },
      {
        title: "Heading 2",
        description: "Medium section heading",
        icon: Heading2,
        keywords: "h2 subtitle",
        command: (editor) =>
          editor.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        title: "Heading 3",
        description: "Small section heading",
        icon: Heading3,
        keywords: "h3 subheader",
        command: (editor) =>
          editor.chain().focus().toggleHeading({ level: 3 }).run(),
      },
      {
        title: "Bullet List",
        description: "Create a simple bullet list",
        icon: List,
        keywords: "unordered ul bullets",
        command: (editor) => editor.chain().focus().toggleBulletList().run(),
      },
      {
        title: "Numbered List",
        description: "Create a ordered list",
        icon: ListOrdered,
        keywords: "numbered ol",
        command: (editor) => editor.chain().focus().toggleOrderedList().run(),
      },
      {
        title: "Code Block",
        description: "Capture code snippets",
        icon: Code2,
        keywords: "code snippet pre",
        command: (editor) => editor.chain().focus().toggleCodeBlock().run(),
      },
      {
        title: "Horizontal Rule",
        description: "Add a horizontal divider",
        icon: Minus,
        keywords: "horizontal rule divider",
        command: (editor) => editor.chain().focus().setHorizontalRule().run(),
      },
    ],
  },
  {
    group: "Inline",
    items: [
      {
        title: "Quote",
        description: "Capture a quotation",
        icon: Quote,
        keywords: "blockquote cite",
        command: (editor) => editor.chain().focus().toggleBlockquote().run(),
      },
      {
        title: "Code",
        description: "Inline code snippet",
        icon: CodeSquare,
        keywords: "code inline",
        command: (editor) => editor.chain().focus().toggleCode().run(),
      },
      {
        title: "Blockquote",
        description: "Block quote",
        icon: TextQuote,
        keywords: "blockquote quote",
        command: (editor) => editor.chain().focus().toggleBlockquote().run(),
      },
    ],
  },
  {
    group: "Alignment",
    items: [
      {
        title: "Align Left",
        description: "Align text to the left",
        icon: AlignLeft,
        keywords: "align left",
        command: (editor) => editor.chain().focus().setTextAlign("left").run(),
      },
      {
        title: "Align Center",
        description: "Center align text",
        icon: AlignCenter,
        keywords: "align center",
        command: (editor) =>
          editor.chain().focus().setTextAlign("center").run(),
      },
      {
        title: "Align Right",
        description: "Align text to the right",
        icon: AlignRight,
        keywords: "align right",
        command: (editor) => editor.chain().focus().setTextAlign("right").run(),
      },
    ],
  },
];

export function TipTapFloatingMenu({ editor }: { editor: Editor }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const commandRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const filteredGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          items: group.items.filter(
            (item) =>
              item.title
                .toLowerCase()
                .includes(debouncedSearch.toLowerCase()) ||
              item.description
                .toLowerCase()
                .includes(debouncedSearch.toLowerCase()) ||
              item.keywords
                .toLowerCase()
                .includes(debouncedSearch.toLowerCase()),
          ),
        }))
        .filter((group) => group.items.length > 0),
    [debouncedSearch],
  );

  const flatFilteredItems = useMemo(
    () => filteredGroups.flatMap((g) => g.items),
    [filteredGroups],
  );

  const executeCommand = useCallback(
    (commandFn: (editor: Editor) => void) => {
      if (!editor) return;

      try {
        const { from } = editor.state.selection;
        const slashCommandLength = search.length + 1;

        // Delete the slash command text
        editor
          .chain()
          .focus()
          .deleteRange({
            from: Math.max(0, from - slashCommandLength),
            to: from,
          })
          .run();

        // Use requestAnimationFrame to ensure the editor has processed the deletion
        // before executing the command - this is crucial for Enter key to work properly
        requestAnimationFrame(() => {
          // Double check that editor still has focus before executing command
          if (!editor.view.hasFocus()) {
            console.debug(
              "[Slash Command] Refocusing editor before command execution",
            );
            editor.commands.focus();
          }

          // Small delay to ensure focus is properly set
          setTimeout(() => {
            console.debug(
              "[Slash Command] Executing command after focus check",
            );
            commandFn(editor);
          }, 0);
        });
      } catch (error) {
        console.error("Error executing command:", error);
      } finally {
        setIsOpen(false);
        setSearch("");
        setSelectedIndex(-1);
      }
    },
    [editor, search],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen || !editor) return;

      const preventDefault = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };

      switch (e.key) {
        case "ArrowDown":
          preventDefault();
          setSelectedIndex((prev) => {
            if (prev === -1) return 0;
            return prev < flatFilteredItems.length - 1 ? prev + 1 : 0;
          });
          break;

        case "ArrowUp":
          preventDefault();
          setSelectedIndex((prev) => {
            if (prev === -1) return flatFilteredItems.length - 1;
            return prev > 0 ? prev - 1 : flatFilteredItems.length - 1;
          });
          break;

        case "Enter": {
          preventDefault();
          console.debug("[Slash Command] Enter pressed", {
            selectedIndex,
            flatFilteredItemsLength: flatFilteredItems.length,
            isOpen,
          });

          let targetIndex = selectedIndex;

          if (targetIndex === -1 && flatFilteredItems.length > 0) {
            targetIndex = 0;
          }

          const selectedItem = flatFilteredItems[targetIndex];
          if (targetIndex >= 0 && selectedItem) {
            console.debug("[Slash Command] Executing command", {
              title: selectedItem.title,
              targetIndex,
            });
            executeCommand(selectedItem.command);
          } else {
            console.warn("[Slash Command] No item selected");
          }
          break;
        }

        case "Escape":
          preventDefault();
          setIsOpen(false);
          setSelectedIndex(-1);
          break;
      }
    },
    [isOpen, selectedIndex, flatFilteredItems, executeCommand, editor],
  );

  useEffect(() => {
    if (!editor?.view?.dom) return;

    const editorElement = editor.view.dom;
    const handleEditorKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (["Enter", "ArrowUp", "ArrowDown", "Escape"].includes(e.key)) {
        // Ensure we catch the event before any other handlers
        e.stopImmediatePropagation();
        handleKeyDown(e);
      }
    };

    // Use both capture and passive:false to ensure we get the event first
    editorElement.addEventListener("keydown", handleEditorKeyDown, {
      capture: true,
      passive: false,
    });

    // Also add to document to catch events that might bubble up
    const handleDocumentKeyDown = (e: KeyboardEvent) => {
      if (!isOpen || !editor.view.hasFocus()) return;

      if (e.key === "Enter" && isOpen) {
        handleEditorKeyDown(e);
      }
    };

    document.addEventListener("keydown", handleDocumentKeyDown, {
      capture: true,
      passive: false,
    });

    return () => {
      editorElement.removeEventListener("keydown", handleEditorKeyDown, {
        capture: true,
      });
      document.removeEventListener("keydown", handleDocumentKeyDown, {
        capture: true,
      });
    };
  }, [isOpen, handleKeyDown, editor]);

  useEffect(() => {
    if (flatFilteredItems.length > 0) {
      if (
        flatFilteredItems.length === 1 ||
        (debouncedSearch.length > 0 &&
          flatFilteredItems[0] &&
          flatFilteredItems[0].keywords
            .toLowerCase()
            .includes(debouncedSearch.toLowerCase()))
      ) {
        setSelectedIndex(0);
      } else {
        setSelectedIndex(-1);
      }
    } else {
      setSelectedIndex(-1);
    }
  }, [flatFilteredItems, debouncedSearch]);

  useEffect(() => {
    if (selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
      itemRefs.current[selectedIndex]?.focus();
    }
  }, [selectedIndex]);

  return (
    <FloatingMenu
      editor={editor}
      shouldShow={({ state }) => {
        if (!editor) return false;

        const { $from } = state.selection;
        const currentLineText = $from.parent.textBetween(
          0,
          $from.parentOffset,
          "\n",
          " ",
        );

        const isSlashCommand =
          currentLineText.startsWith("/") &&
          $from.parent.type.name !== "codeBlock" &&
          $from.parentOffset === currentLineText.length;

        if (!isSlashCommand) {
          if (isOpen) {
            console.debug("[Slash Command] Closing - not a slash command");
            setIsOpen(false);
          }
          return false;
        }

        const query = currentLineText.slice(1).trim();
        if (query !== search) {
          console.debug("[Slash Command] Query changed", {
            from: search,
            to: query,
          });
          setSearch(query);
        }
        if (!isOpen) {
          console.debug("[Slash Command] Opening menu");
          setIsOpen(true);
        }
        return true;
      }}
      options={{
        placement: "bottom-start",
        offset: 4,
      }}
    >
      <Command
        role="listbox"
        ref={commandRef}
        className="w-72 shadow-lg z-50 overflow-hidden rounded-lg border bg-popover"
      >
        <ScrollArea className="max-h-[330px]">
          <CommandList>
            <CommandEmpty className="py-3 text-sm text-center text-muted-foreground">
              No results found
            </CommandEmpty>

            {filteredGroups.map((group, groupIndex) => (
              <CommandGroup
                key={`${group.group}-${groupIndex}`}
                heading={
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    {group.group}
                  </div>
                }
              >
                {group.items.map((item, itemIndex) => {
                  const flatIndex =
                    filteredGroups
                      .slice(0, groupIndex)
                      .reduce((acc, g) => acc + g.items.length, 0) + itemIndex;

                  return (
                    <CommandItem
                      role="option"
                      key={`${group.group}-${item.title}-${itemIndex}`}
                      value={`${group.group}-${item.title}`}
                      onSelect={() => executeCommand(item.command)}
                      className={cn(
                        "gap-3 aria-selected:bg-accent/50",
                        flatIndex === selectedIndex ? "bg-accent/50" : "",
                      )}
                      aria-selected={flatIndex === selectedIndex}
                      ref={(el) => {
                        itemRefs.current[flatIndex] = el;
                      }}
                      tabIndex={flatIndex === selectedIndex ? 0 : -1}
                    >
                      <div className="h-9 w-9 flex items-center justify-center rounded-md border bg-background">
                        <item.icon className="h-4 w-4" />
                      </div>
                      <div className="flex flex-1 flex-col">
                        <span className="text-sm font-medium">
                          {item.title}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      </div>
                      <kbd className="h-5 rounded px-1.5 text-xs ml-auto flex items-center bg-muted text-muted-foreground">
                        ↵
                      </kbd>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </ScrollArea>
      </Command>
    </FloatingMenu>
  );
}
