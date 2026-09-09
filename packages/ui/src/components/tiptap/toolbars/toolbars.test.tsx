import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FloatingToolbar } from "@/components/tiptap/extensions/floating-toolbar.js";
import { AlignmentTooolbar } from "@/components/tiptap/toolbars/alignment.js";
import { BlockquoteToolbar } from "@/components/tiptap/toolbars/blockquote.js";
import { BoldToolbar } from "@/components/tiptap/toolbars/bold.js";
import { BulletListToolbar } from "@/components/tiptap/toolbars/bullet-list.js";
import { CodeBlockToolbar } from "@/components/tiptap/toolbars/code-block.js";
import { CodeToolbar } from "@/components/tiptap/toolbars/code.js";
import { EditorToolbar } from "@/components/tiptap/toolbars/editor-toolbar.js";
import { HeadingsToolbar } from "@/components/tiptap/toolbars/headings.js";
import { ItalicToolbar } from "@/components/tiptap/toolbars/italic.js";
import { LinkToolbar } from "@/components/tiptap/toolbars/link.js";
import {
  MobileToolbarGroup,
  MobileToolbarItem,
} from "@/components/tiptap/toolbars/mobile-toolbar-group.js";
import { OrderedListToolbar } from "@/components/tiptap/toolbars/ordered-list.js";
import { StrikeThroughToolbar } from "@/components/tiptap/toolbars/strikethrough.js";
import {
  ToolbarProvider,
  useToolbar,
} from "@/components/tiptap/toolbars/toolbar-provider.js";
import { UnderlineToolbar } from "@/components/tiptap/toolbars/underline.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { useMediaQuery } from "@/hooks/use-media-query.js";

vi.mock("@/hooks/use-media-query.js", () => ({ useMediaQuery: vi.fn() }));

const mockedUseMediaQuery = vi.mocked(useMediaQuery);

type EditorHarness = {
  editor: Editor;
  chain: Record<string, ReturnType<typeof vi.fn>>;
  handlers: Map<string, () => void>;
  focus: ReturnType<typeof vi.fn>;
  setActive: (names: string[]) => void;
  setLink: (href: string) => void;
};

function createEditor(): EditorHarness {
  let active = new Set<string>();
  let href = "https://example.com";
  const handlers = new Map<string, () => void>();
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of [
    "focus",
    "toggleBlockquote",
    "toggleBold",
    "toggleBulletList",
    "toggleCodeBlock",
    "toggleCode",
    "toggleItalic",
    "toggleOrderedList",
    "toggleStrike",
    "toggleUnderline",
    "setParagraph",
    "toggleHeading",
    "setTextAlign",
    "setLink",
    "unsetLink",
  ]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.run = vi.fn(() => true);

  const focus = vi.fn();
  const editor = {
    isActive: (nameOrAttributes: string | Record<string, string>) => {
      if (typeof nameOrAttributes === "string")
        return active.has(nameOrAttributes);
      return active.has(nameOrAttributes.textAlign ?? "");
    },
    can: () => ({ chain: () => chain }),
    chain: () => chain,
    getAttributes: () => ({ href }),
    on: (event: string, handler: () => void) => handlers.set(event, handler),
    off: (event: string) => handlers.delete(event),
    view: { focus },
    options: { element: document.createElement("div") },
    isEditable: true,
    isFocused: true,
    registerPlugin: vi.fn(),
    unregisterPlugin: vi.fn(),
  } as unknown as Editor;

  return {
    editor,
    chain,
    handlers,
    focus,
    setActive: (names) => {
      active = new Set(names);
    },
    setLink: (value) => {
      href = value;
    },
  };
}

function MissingProviderConsumer() {
  useToolbar();
  return null;
}

describe("TipTap toolbars", () => {
  beforeEach(() => {
    mockedUseMediaQuery.mockReturnValue(false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("requires the toolbar provider", () => {
    expect(() => render(<MissingProviderConsumer />)).toThrow(
      "useToolbar must be used within a ToolbarProvider",
    );
  });

  it("runs every formatting command and preserves caller click handlers", () => {
    const harness = createEditor();
    harness.setActive([
      "blockquote",
      "bold",
      "bulletList",
      "codeBlock",
      "code",
      "italic",
      "orderedList",
      "strike",
      "underline",
      "heading",
    ]);
    const onClick = vi.fn();

    render(
      <ToolbarProvider editor={harness.editor}>
        <TooltipProvider>
          <BlockquoteToolbar onClick={onClick}>
            Blockquote action
          </BlockquoteToolbar>
          <BoldToolbar onClick={onClick}>Bold action</BoldToolbar>
          <BulletListToolbar onClick={onClick}>Bullet action</BulletListToolbar>
          <CodeBlockToolbar onClick={onClick}>
            Code block action
          </CodeBlockToolbar>
          <CodeToolbar onClick={onClick}>Code action</CodeToolbar>
          <ItalicToolbar onClick={onClick}>Italic action</ItalicToolbar>
          <OrderedListToolbar onClick={onClick}>
            Ordered action
          </OrderedListToolbar>
          <StrikeThroughToolbar onClick={onClick}>
            Strike action
          </StrikeThroughToolbar>
          <UnderlineToolbar onClick={onClick}>
            Underline action
          </UnderlineToolbar>
        </TooltipProvider>
      </ToolbarProvider>,
    );

    for (const name of [
      "Blockquote action",
      "Bold action",
      "Bullet action",
      "Code block action",
      "Code action",
      "Italic action",
      "Ordered action",
      "Strike action",
      "Underline action",
    ]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }

    expect(onClick).toHaveBeenCalledTimes(9);
    expect(harness.chain.toggleBold).toHaveBeenCalled();
    expect(harness.chain.toggleUnderline).toHaveBeenCalled();
    harness.handlers.get("transaction")?.();
  });

  it("renders disabled controls when no editor is available", () => {
    render(
      <ToolbarProvider editor={null as unknown as Editor}>
        <TooltipProvider>
          <BoldToolbar>No editor</BoldToolbar>
          <AlignmentTooolbar />
        </TooltipProvider>
      </ToolbarProvider>,
    );

    expect(screen.getByRole("button", { name: "No editor" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("executes desktop heading and alignment choices", () => {
    const harness = createEditor();
    harness.setActive(["2", "center"]);
    render(
      <ToolbarProvider editor={harness.editor}>
        <TooltipProvider>
          <HeadingsToolbar />
          <AlignmentTooolbar />
        </TooltipProvider>
      </ToolbarProvider>,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: /Normal/ }));
    fireEvent.click(screen.getByText("H1"));
    fireEvent.pointerDown(screen.getByRole("button", { name: /Center Align/ }));
    fireEvent.click(screen.getAllByText("Center Align").at(-1)!);
    vi.runAllTimers();

    expect(harness.chain.toggleHeading).toHaveBeenCalledWith({ level: 1 });
    expect(harness.chain.setTextAlign).toHaveBeenCalledWith("center");
    expect(harness.focus).toHaveBeenCalled();
  });

  it("executes mobile heading and alignment choices", () => {
    mockedUseMediaQuery.mockReturnValue(true);
    const harness = createEditor();
    harness.setActive(["heading", "1", "left"]);
    render(
      <ToolbarProvider editor={harness.editor}>
        <HeadingsToolbar />
        <AlignmentTooolbar />
      </ToolbarProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "H1" }));
    fireEvent.click(screen.getByRole("button", { name: "H2" }));
    cleanup();
    render(
      <ToolbarProvider editor={harness.editor}>
        <AlignmentTooolbar />
      </ToolbarProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Left Align/ }));
    fireEvent.click(screen.getByRole("button", { name: /Right Align/ }));
    vi.runAllTimers();

    expect(harness.chain.toggleHeading).toHaveBeenCalledWith({ level: 2 });
    expect(harness.chain.setTextAlign).toHaveBeenCalledWith("right");
  });

  it("adds, updates, and removes links", () => {
    const harness = createEditor();
    render(
      <ToolbarProvider editor={harness.editor}>
        <TooltipProvider>
          <LinkToolbar />
        </TooltipProvider>
      </ToolbarProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Link/ }));
    const input = screen.getByPlaceholderText("https://example.com");
    fireEvent.change(input, { target: { value: "mento.org" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(harness.chain.setLink).toHaveBeenCalledWith({
      href: "https://mento.org/",
    });

    fireEvent.click(screen.getByRole("button", { name: /Link/ }));
    fireEvent.click(screen.getByRole("button", { name: /Remove/ }));
    expect(harness.chain.unsetLink).toHaveBeenCalled();

    harness.setLink("");
  });

  it("closes standalone mobile groups after an item click", () => {
    const onClick = vi.fn();
    render(
      <MobileToolbarGroup label="Format">
        text
        <MobileToolbarItem active onClick={onClick}>
          Choice
        </MobileToolbarItem>
      </MobileToolbarGroup>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Format/ }));
    fireEvent.click(screen.getByRole("button", { name: "Choice" }));
    vi.advanceTimersByTime(100);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders the complete desktop and mobile toolbars", () => {
    const harness = createEditor();
    const { rerender } = render(<EditorToolbar editor={harness.editor} />);
    expect(screen.getByText("Normal")).toBeTruthy();

    mockedUseMediaQuery.mockReturnValue(true);
    rerender(<FloatingToolbar editor={harness.editor} />);
    const element = harness.editor.options.element as HTMLElement;
    const event = new Event("contextmenu", { cancelable: true });
    element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    rerender(<FloatingToolbar editor={null} />);
    expect(screen.queryByText("Normal")).toBeNull();
  });
});
