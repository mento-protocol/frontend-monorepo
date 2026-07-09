import { describe, expect, it, vi } from "vitest";

import { canUseStorageOverrides, readStorageOverride } from "./rpc-overrides";

describe("canUseStorageOverrides", () => {
  it("blocks overrides in production without the debug flag", () => {
    expect(canUseStorageOverrides(true, false)).toBe(false);
  });

  it("allows overrides in production when the debug flag is set", () => {
    expect(canUseStorageOverrides(true, true)).toBe(true);
  });

  it("allows overrides outside production on non-public hosts", () => {
    expect(canUseStorageOverrides(false, false)).toBe(true);
    expect(canUseStorageOverrides(false, false, "preview.vercel.app")).toBe(
      true,
    );
  });

  it("blocks overrides on public Mento hosts without the debug flag", () => {
    expect(canUseStorageOverrides(false, false, "app.mento.org")).toBe(false);
    expect(canUseStorageOverrides(false, false, "mento.org")).toBe(false);
  });

  it("allows overrides on public Mento hosts when the debug flag is set", () => {
    expect(canUseStorageOverrides(false, true, "app.mento.org")).toBe(true);
  });
});

describe("readStorageOverride", () => {
  it("returns the stored value when overrides are allowed", () => {
    const storage = {
      getItem: vi.fn().mockReturnValue("http://localhost:9999"),
    };

    const result = readStorageOverride("some-key", storage, false, false);

    expect(result).toBe("http://localhost:9999");
    expect(storage.getItem).toHaveBeenCalledWith("some-key");
  });

  it("returns null without reading storage in production with no debug flag", () => {
    const storage = {
      getItem: vi.fn().mockReturnValue("http://localhost:9999"),
    };

    const result = readStorageOverride("some-key", storage, true, false);

    expect(result).toBeNull();
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it("returns null without reading storage on public Mento hosts", () => {
    const storage = {
      getItem: vi.fn().mockReturnValue("http://localhost:9999"),
    };

    const result = readStorageOverride(
      "some-key",
      storage,
      false,
      false,
      "app.mento.org",
    );

    expect(result).toBeNull();
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it("does not touch window localStorage when overrides are blocked", () => {
    const originalWindow = globalThis.window;
    const localStorageGetter = vi.fn(() => {
      throw new Error("localStorage is blocked");
    });

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: Object.defineProperty({}, "localStorage", {
        get: localStorageGetter,
      }),
    });

    const result = readStorageOverride("some-key", undefined, true, false);

    expect(result).toBeNull();
    expect(localStorageGetter).not.toHaveBeenCalled();

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("returns null when browser storage access is blocked", () => {
    const originalWindow = globalThis.window;

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: Object.defineProperty({}, "localStorage", {
        get() {
          throw new Error("localStorage is blocked");
        },
      }),
    });

    const result = readStorageOverride("some-key", undefined, false, false);

    expect(result).toBeNull();

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("returns null when storage is undefined (SSR)", () => {
    const result = readStorageOverride("some-key", undefined, false, false);

    expect(result).toBeNull();
  });
});
