import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  editor: null as null | {
    commands: { setContent: ReturnType<typeof vi.fn> };
    getHTML: ReturnType<typeof vi.fn>;
    view: { focus: ReturnType<typeof vi.fn> };
  },
  options: undefined as undefined | Record<string, unknown>,
}));

vi.mock("@tiptap/react", () => ({
  EditorContent: () => <div data-testid="editor-content" />,
  useEditor: (options: Record<string, unknown>) => {
    mocks.options = options;
    return mocks.editor;
  },
}));

vi.mock("./toolbars/editor-toolbar.js", () => ({
  EditorToolbar: () => <div data-testid="editor-toolbar" />,
}));
vi.mock("./extensions/floating-toolbar.js", () => ({
  FloatingToolbar: () => <div className="tippy-content">Floating toolbar</div>,
}));
vi.mock("./extensions/floating-menu.js", () => ({
  TipTapFloatingMenu: () => <div role="listbox">Floating menu</div>,
}));

import { RichTextEditor } from "./rich-text-editor.js";

afterEach(cleanup);

beforeEach(() => {
  mocks.options = undefined;
  mocks.editor = {
    commands: { setContent: vi.fn() },
    getHTML: vi.fn(() => "<p>current</p>"),
    view: { focus: vi.fn() },
  };
});

describe("RichTextEditor", () => {
  it("returns no markup while the editor initializes", () => {
    mocks.editor = null;
    const { container } = render(<RichTextEditor value="<p>value</p>" />);
    expect(container.innerHTML).toBe("");
  });

  it("composes editor controls and synchronizes an external value", () => {
    render(
      <RichTextEditor className="custom-editor" value="<p>replacement</p>" />,
    );

    expect(screen.getByTestId("editor-toolbar")).toBeTruthy();
    expect(screen.getByTestId("editor-content")).toBeTruthy();
    expect(mocks.editor?.commands.setContent).toHaveBeenCalledWith(
      "<p>replacement</p>",
      { emitUpdate: false },
    );
  });

  it("does not replace equal or undefined content", () => {
    mocks.editor!.getHTML.mockReturnValue("<p>same</p>");
    const { rerender } = render(<RichTextEditor value="<p>same</p>" />);
    rerender(<RichTextEditor />);
    expect(mocks.editor?.commands.setContent).not.toHaveBeenCalled();
  });

  it("reports editor updates when a change callback is present", () => {
    const onChange = vi.fn();
    render(<RichTextEditor onChange={onChange} />);
    const onUpdate = mocks.options?.onUpdate as (value: {
      editor: { getHTML: () => string };
    }) => void;

    onUpdate({ editor: { getHTML: () => "<p>updated</p>" } });
    expect(onChange).toHaveBeenCalledWith("<p>updated</p>");

    render(<RichTextEditor />);
    const withoutCallback = mocks.options?.onUpdate as typeof onUpdate;
    expect(() =>
      withoutCallback({ editor: { getHTML: () => "ignored" } }),
    ).not.toThrow();
  });

  it("focuses only when the editor container is clicked", () => {
    const { container } = render(<RichTextEditor />);
    const editorContainer = container.firstElementChild as HTMLElement;

    fireEvent.click(editorContainer);
    expect(mocks.editor?.view.focus).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("listbox"));
    fireEvent.click(screen.getByText("Floating toolbar"));
    expect(mocks.editor?.view.focus).toHaveBeenCalledTimes(1);
  });
});
