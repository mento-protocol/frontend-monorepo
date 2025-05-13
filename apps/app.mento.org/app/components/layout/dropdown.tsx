"use client";
import type { ReactElement, ReactNode } from "react";

interface MenuProps {
  buttonContent: ReactNode;
  buttonClasses?: string;
  buttonTitle?: string;
  menuItems: ReactNode[];
  menuClasses?: string;
}

// Uses Headless menu, which auto-closes on any item click
export function DropdownMenu({
  buttonContent,
  buttonClasses,
  buttonTitle,
  menuItems,
  menuClasses,
}: MenuProps) {
  return <></>;
}

export type Alignment = "start" | "end";
export type Side = "top" | "right" | "bottom" | "left";
export type AlignedPlacement = `${Side}-${Alignment}`;
export type Placement = Side | AlignedPlacement;

interface ModalProps {
  buttonContent: (open: boolean) => React.ReactElement;
  buttonClasses?: string;
  buttonTitle?: string;
  modalContent: (close: () => void) => ReactElement;
  modalClasses?: string;
  placement?: Placement;
  placementOffset?: number;
}

// Uses Headless Popover, which is a more general purpose dropdown box
export function DropdownModal({
  buttonContent,
  buttonClasses,
  buttonTitle,
  modalContent,
  modalClasses,
  placement = "bottom-start",
  placementOffset = 0,
}: ModalProps) {
  return <></>;
}
