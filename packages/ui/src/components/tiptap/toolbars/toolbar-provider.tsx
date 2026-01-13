"use client";

import type { Editor } from "@tiptap/react";
import React from "react";

interface ToolbarContextProps {
  editor: Editor;
  executeWithFocus: (command: () => void) => void;
}

const ToolbarContext = React.createContext<ToolbarContextProps | null>(null);

interface ToolbarProviderProps {
  editor: Editor;
  children: React.ReactNode;
}

export const ToolbarProvider = ({ editor, children }: ToolbarProviderProps) => {
  // Force re-render when editor selection/transaction changes
  const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);

  React.useEffect(() => {
    if (!editor) return;

    // Subscribe to editor updates to force toolbar re-renders
    const handleUpdate = () => forceUpdate();

    editor.on("selectionUpdate", handleUpdate);
    editor.on("transaction", handleUpdate);

    return () => {
      editor.off("selectionUpdate", handleUpdate);
      editor.off("transaction", handleUpdate);
    };
  }, [editor]);

  const executeWithFocus = React.useCallback(
    (command: () => void) => {
      command();
      // Use a small delay to ensure UI components (dropdowns, drawers) complete their focus management
      setTimeout(() => {
        if (editor?.view) {
          editor.view.focus();
        }
      }, 10);
    },
    [editor],
  );

  return (
    <ToolbarContext.Provider value={{ editor, executeWithFocus }}>
      {children}
    </ToolbarContext.Provider>
  );
};

export const useToolbar = () => {
  const context = React.useContext(ToolbarContext);

  if (!context) {
    throw new Error("useToolbar must be used within a ToolbarProvider");
  }

  return context;
};
