import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMediaQuery } from "./use-media-query.js";
import { useIsMobile } from "./use-mobile.js";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const changeListeners = new Set<() => void>();
  const media = {
    get matches() {
      return matches;
    },
    media: "",
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: () => void) => {
      changeListeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: () => void) => {
      changeListeners.delete(listener);
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;
  vi.spyOn(window, "matchMedia").mockReturnValue(media);

  return {
    media,
    setMatches(value: boolean) {
      matches = value;
      for (const listener of changeListeners) listener();
    },
  };
}

describe("browser hooks", () => {
  it("tracks a window media query across resize events", () => {
    const match = installMatchMedia(true);
    const { result, unmount } = renderHook(() =>
      useMediaQuery("(min-width: 1px)"),
    );

    expect(result.current).toBe(true);
    act(() => match.setMatches(false));
    act(() => window.dispatchEvent(new Event("resize")));
    expect(result.current).toBe(false);

    unmount();
  });

  it("tracks reduced-motion changes and removes its listener", () => {
    const match = installMatchMedia(false);
    const { result, unmount } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);

    act(() => match.setMatches(true));
    expect(result.current).toBe(true);

    unmount();
    expect(match.media.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });

  it.each([
    [500, true],
    [900, false],
  ])("reports mobile for a %spx viewport: %s", (width, expected) => {
    const match = installMatchMedia(expected);
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: width,
    });
    const { result, unmount } = renderHook(() => useIsMobile());

    expect(result.current).toBe(expected);
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: expected ? 1_200 : 400,
    });
    act(() => match.setMatches(!expected));
    expect(result.current).toBe(!expected);

    unmount();
    expect(match.media.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });
});
