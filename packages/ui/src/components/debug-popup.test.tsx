import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hotkeyHandler: undefined as undefined | (() => void),
}));

vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: (
    _keys: string,
    handler: () => void,
    _options: Record<string, unknown>,
  ) => {
    void _options;
    mocks.hotkeyHandler = handler;
  },
}));

import { DebugPopup, isForkModeEnabled } from "./debug-popup.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_USE_FORK;
});

beforeEach(() => {
  localStorage.clear();
  mocks.hotkeyHandler = undefined;
});

describe("DebugPopup", () => {
  it("opens, enables fork mode, and hides from the hotkey", () => {
    const consoleDebug = vi
      .spyOn(console, "debug")
      .mockImplementation(() => {});
    render(<DebugPopup />);
    expect(screen.queryByTestId("debug-popup-button")).toBeNull();

    act(() => mocks.hotkeyHandler?.());
    fireEvent.click(screen.getByRole("button", { name: "Toggle debug menu" }));
    const forkToggle = screen.getByRole("switch");
    expect(forkToggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(forkToggle);
    expect(localStorage.getItem("mento_use_fork")).toBe("true");
    expect(consoleDebug).toHaveBeenCalledWith(
      "Fork mode enabled. Reloading...",
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle debug menu" }));
    expect(screen.queryByRole("switch")).toBeNull();
    act(() => mocks.hotkeyHandler?.());
    expect(screen.queryByTestId("debug-popup-button")).toBeNull();
  });

  it("loads and disables an existing fork preference", () => {
    localStorage.setItem("mento_use_fork", "true");
    const consoleDebug = vi
      .spyOn(console, "debug")
      .mockImplementation(() => {});
    render(<DebugPopup />);
    act(() => mocks.hotkeyHandler?.());
    fireEvent.click(screen.getByRole("button", { name: "Toggle debug menu" }));

    const forkToggle = screen.getByRole("switch");
    expect(forkToggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(forkToggle);

    expect(localStorage.getItem("mento_use_fork")).toBe("false");
    expect(consoleDebug).toHaveBeenCalledWith(
      "Fork mode disabled. Reloading...",
    );
  });
});

describe("isForkModeEnabled", () => {
  it("prefers a stored browser value", () => {
    process.env.NEXT_PUBLIC_USE_FORK = "false";
    localStorage.setItem("mento_use_fork", "true");
    expect(isForkModeEnabled()).toBe(true);

    localStorage.setItem("mento_use_fork", "false");
    expect(isForkModeEnabled()).toBe(false);
  });

  it("uses the environment when browser storage is empty", () => {
    process.env.NEXT_PUBLIC_USE_FORK = "true";
    expect(isForkModeEnabled()).toBe(true);
    process.env.NEXT_PUBLIC_USE_FORK = "false";
    expect(isForkModeEnabled()).toBe(false);
  });

  it("uses the environment during server rendering", () => {
    const browserWindow = window;
    vi.stubGlobal("window", undefined);
    process.env.NEXT_PUBLIC_USE_FORK = "true";
    expect(isForkModeEnabled()).toBe(true);
    vi.stubGlobal("window", browserWindow);
  });
});
