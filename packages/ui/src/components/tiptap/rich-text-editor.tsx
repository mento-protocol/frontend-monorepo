"use client";
import "./tiptap.css";
import { cn } from "../../lib/utils.js";
import { ImageExtension } from "./extensions/image.js";
import { ImagePlaceholder } from "./extensions/image-placeholder.js";
import SearchAndReplace from "./extensions/search-and-replace.js";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import Typography from "@tiptap/extension-typography";
import Underline from "@tiptap/extension-underline";
import { EditorContent, type Extension, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TipTapFloatingMenu } from "./extensions/floating-menu.js";
import { FloatingToolbar } from "./extensions/floating-toolbar.js";
import { EditorToolbar } from "./toolbars/editor-toolbar.js";
import Placeholder from "@tiptap/extension-placeholder";

const extensions = [
  StarterKit.configure({
    orderedList: {
      HTMLAttributes: {
        class: "list-decimal",
      },
    },
    bulletList: {
      HTMLAttributes: {
        class: "list-disc",
      },
    },
    heading: {
      levels: [1, 2, 3, 4],
    },
  }),
  Placeholder.configure({
    emptyNodeClass: "is-editor-empty",
    placeholder: ({ node }) => {
      switch (node.type.name) {
        case "heading":
          return `Heading ${node.attrs.level}`;
        case "detailsSummary":
          return "Section title";
        case "codeBlock":
          // never show the placeholder when editing code
          return "";
        default:
          return "Write, type '/' for commands";
      }
    },
    includeChildren: false,
  }),
  TextAlign.configure({
    types: ["heading", "paragraph"],
  }),
  TextStyle,
  Subscript,
  Superscript,
  Underline,
  Link,
  Color,
  Highlight.configure({
    multicolor: true,
  }),
  ImageExtension,
  ImagePlaceholder,
  SearchAndReplace,
  Typography,
];

export function RichTextEditor({ className }: { className?: string }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: extensions as Extension[],
    // content,
    editorProps: {
      attributes: {
        class: "max-w-full focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      // do what you want to do with output
      // Update stats
      // saving as text/json/hmtml
      // const text = editor.getHTML();
      console.log(editor.getText());
    },
  });

  if (!editor) return null;

  return (
    <div
      className={cn("relative w-full pb-[60px] sm:pb-0", className)}
      onClick={() => {
        editor?.view.focus();
      }}
    >
      <EditorToolbar editor={editor} />
      <FloatingToolbar editor={editor} />
      <TipTapFloatingMenu editor={editor} />
      <EditorContent
        editor={editor}
        className="bg-input/30 border-input min-h-[600px] w-full min-w-full cursor-text border sm:p-6"
      />
    </div>
  );
}
