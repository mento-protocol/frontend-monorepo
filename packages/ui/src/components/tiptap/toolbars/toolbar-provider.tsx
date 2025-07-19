"use client";

import type { Editor } from "@tiptap/react";
import React from "react";

export interface ToolbarContextProps {
  editor: Editor;
  executeWithFocus: (command: () => void) => void;
}

export const ToolbarContext = React.createContext<ToolbarContextProps | null>(
  null,
);

interface ToolbarProviderProps {
  editor: Editor;
  children: React.ReactNode;
}

export const ToolbarProvider = ({ editor, children }: ToolbarProviderProps) => {
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
