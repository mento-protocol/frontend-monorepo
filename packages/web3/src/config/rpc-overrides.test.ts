import { describe, expect, it, vi } from "vitest";

import { canUseStorageOverrides, readStorageOverride } from "./rpc-overrides";

describe("canUseStorageOverrides", () => {
  it("blocks overrides in production without the debug flag", () => {
    expect(canUseStorageOverrides(true, false)).toBe(false);
  });

  it("allows overrides in production when the debug flag is set", () => {
    expect(canUseStorageOverrides(true, true)).toBe(true);
  });

  it("allows overrides outside production", () => {
    expect(canUseStorageOverrides(false, false)).toBe(true);
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

  it("returns null when storage is undefined (SSR)", () => {
    const result = readStorageOverride("some-key", undefined, false, false);

    expect(result).toBeNull();
  });
});
