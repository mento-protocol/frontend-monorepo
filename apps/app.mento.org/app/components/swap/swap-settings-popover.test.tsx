import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { atom } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@repo/web3", () => ({
  formValuesAtom: atom({
    slippage: "0.3",
    isAutoSlippage: true,
    deadlineMinutes: "5",
    isAutoDeadline: true,
  }),
}));

vi.mock("@repo/ui", () => ({
  cn: (...classes: unknown[]) =>
    classes.filter((value) => typeof value === "string" && value).join(" "),
  Input: React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
    function MockInput(props, ref) {
      return <input ref={ref} {...props} />;
    },
  ),
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { SwapSettingsPopover } from "./swap-settings-popover";

describe("SwapSettingsPopover", () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the same deadline input mounted while typing a valid value", () => {
    render(
      <Provider store={store}>
        <SwapSettingsPopover />
      </Provider>,
    );

    const deadlineInput = screen.getByTestId("deadlineInput");
    deadlineInput.focus();

    fireEvent.change(deadlineInput, { target: { value: "10" } });

    const updatedInput = screen.getByTestId("deadlineInput");

    expect(updatedInput).toBe(deadlineInput);
    expect(document.activeElement).toBe(updatedInput);
    expect((updatedInput as HTMLInputElement).value).toBe("10");
  });

  it("preserves an empty draft while the user is editing manually", () => {
    render(
      <Provider store={store}>
        <SwapSettingsPopover />
      </Provider>,
    );

    const deadlineInput = screen.getByTestId("deadlineInput");

    fireEvent.change(deadlineInput, { target: { value: "" } });

    expect(
      (screen.getByTestId("deadlineInput") as HTMLInputElement).value,
    ).toBe("");
  });
});
