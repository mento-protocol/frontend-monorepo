import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TipTapFloatingMenu } from "@/components/tiptap/extensions/floating-menu.js";

type EditorHarness = {
  editor: Editor;
  editorElement: HTMLDivElement;
  handlers: Map<string, () => void>;
  setText: (text: string) => void;
  chain: Record<string, ReturnType<typeof vi.fn>>;
  focus: ReturnType<typeof vi.fn>;
};

function createEditor(): EditorHarness {
  let text = "/";
  const handlers = new Map<string, () => void>();
  const container = document.createElement("div");
  container.className = "relative";
  const editorElement = document.createElement("div");
  container.append(editorElement);
  document.body.append(container);

  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of [
    "focus",
    "clearNodes",
    "toggleHeading",
    "toggleBulletList",
    "toggleOrderedList",
    "toggleCodeBlock",
    "setHorizontalRule",
    "toggleBlockquote",
    "toggleCode",
    "setTextAlign",
    "deleteRange",
    "run",
  ]) {
    chain[method] = vi.fn(() => chain);
  }

  const focus = vi.fn();
  const editor = {
    state: {
      selection: {
        get from() {
          return text.length;
        },
        $from: {
          parent: {
            textBetween: () => text,
            type: { name: "paragraph" },
          },
          get parentOffset() {
            return text.length;
          },
          pos: 3,
        },
      },
    },
    view: {
      dom: editorElement,
      coordsAtPos: () => ({ top: 80, left: 40 }),
      hasFocus: () => false,
    },
    commands: { focus },
    chain: () => chain,
    on: (event: string, handler: () => void) => handlers.set(event, handler),
    off: (event: string) => handlers.delete(event),
  } as unknown as Editor;

  return {
    editor,
    editorElement,
    handlers,
    setText: (value) => {
      text = value;
    },
    chain,
    focus,
  };
}

function updateEditor(harness: EditorHarness) {
  act(() => harness.handlers.get("transaction")?.());
}

function getOption(title: string) {
  const titleElement = screen.getByText(title, {
    exact: true,
    selector: "span",
  });
  const option = titleElement.closest('[role="option"]');
  if (!option) throw new Error(`No option found for ${title}`);
  return option;
}

describe("TipTapFloatingMenu", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("runs every slash command through the editor chain", () => {
    const harness = createEditor();
    render(<TipTapFloatingMenu editor={harness.editor} />);

    const commands: Array<[string, string]> = [
      ["Text", "clearNodes"],
      ["Heading 1", "toggleHeading"],
      ["Heading 2", "toggleHeading"],
      ["Heading 3", "toggleHeading"],
      ["Bullet List", "toggleBulletList"],
      ["Numbered List", "toggleOrderedList"],
      ["Code Block", "toggleCodeBlock"],
      ["Horizontal Rule", "setHorizontalRule"],
      ["Quote", "toggleBlockquote"],
      ["Code", "toggleCode"],
      ["Blockquote", "toggleBlockquote"],
      ["Align Left", "setTextAlign"],
      ["Align Center", "setTextAlign"],
      ["Align Right", "setTextAlign"],
    ];

    for (const [title, method] of commands) {
      harness.setText("/");
      updateEditor(harness);
      const option = getOption(title);
      fireEvent.click(option);
      act(() => vi.runAllTimers());
      expect(harness.chain[method]).toHaveBeenCalled();
    }

    expect(harness.chain.deleteRange).toHaveBeenCalled();
    expect(harness.focus).toHaveBeenCalled();
    // This case drives all fourteen commands through a full
    // render/interact/flush cycle, so it costs roughly five times the heaviest
    // other test in this file — about 0.7s on a developer machine but ~5.6s on
    // a CI runner, which overran Vitest's 5s default and failed the shard on
    // runner speed rather than on behaviour. Budget it explicitly instead of
    // leaving it balanced on the default.
  }, 15_000);

  it("filters commands and supports keyboard selection and dismissal", () => {
    const harness = createEditor();
    render(<TipTapFloatingMenu editor={harness.editor} />);

    harness.setText("/center");
    updateEditor(harness);
    act(() => vi.advanceTimersByTime(150));
    expect(getOption("Align Center")).toBeTruthy();

    fireEvent.keyDown(harness.editorElement, { key: "ArrowDown" });
    fireEvent.keyDown(harness.editorElement, { key: "ArrowUp" });
    fireEvent.keyDown(harness.editorElement, { key: "Enter" });
    act(() => vi.runAllTimers());
    expect(harness.chain.setTextAlign).toHaveBeenCalledWith("center");

    harness.setText("/");
    updateEditor(harness);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryAllByRole("listbox")).toHaveLength(0);

    updateEditor(harness);
    expect(screen.queryAllByRole("listbox")).toHaveLength(0);
    harness.setText("plain text");
    updateEditor(harness);
    harness.setText("/");
    updateEditor(harness);
    expect(screen.getAllByRole("listbox")).toHaveLength(2);
  });

  it("closes for outside clicks but stays open for editor and menu clicks", () => {
    const harness = createEditor();
    render(<TipTapFloatingMenu editor={harness.editor} />);

    fireEvent.mouseDown(screen.getAllByRole("listbox")[0]!);
    expect(screen.getAllByRole("listbox")).toHaveLength(2);
    fireEvent.mouseDown(harness.editorElement);
    expect(screen.getAllByRole("listbox")).toHaveLength(2);

    const toolbar = document.createElement("button");
    harness.editorElement.parentElement?.append(toolbar);
    fireEvent.mouseDown(toolbar);
    expect(screen.queryAllByRole("listbox")).toHaveLength(0);

    harness.setText("plain text");
    updateEditor(harness);
    harness.setText("/");
    updateEditor(harness);
    fireEvent.mouseDown(document.body);
    expect(screen.queryAllByRole("listbox")).toHaveLength(0);
  });

  it("clears the menu when the slash is removed and contains command errors", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const harness = createEditor();
    render(<TipTapFloatingMenu editor={harness.editor} />);

    harness.setText("plain text");
    updateEditor(harness);
    expect(screen.queryAllByRole("listbox")).toHaveLength(0);

    harness.setText("/");
    updateEditor(harness);
    harness.chain.deleteRange?.mockImplementationOnce(() => {
      throw new Error("delete failed");
    });
    fireEvent.click(getOption("Text"));
    expect(consoleError).toHaveBeenCalledWith(
      "Error executing command:",
      expect.any(Error),
    );
  });
});
