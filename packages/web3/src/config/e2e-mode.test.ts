import { afterEach, describe, expect, it, vi } from "vitest";

import { isE2eTestMode } from "./e2e-mode";

const originalWindow = globalThis.window;

function stubWindow(
  hostname: string,
  storageValues: Record<string, string> = {},
) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { hostname },
      localStorage: {
        getItem: (key: string) => storageValues[key] ?? null,
      },
    },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

describe("isE2eTestMode", () => {
  it("returns false on the server (no window), even with the env flag stubbed", () => {
    vi.stubEnv("NEXT_PUBLIC_E2E_TEST", "true");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: undefined,
    });

    expect(isE2eTestMode()).toBe(false);
  });

  it("returns true for localhost with the env flag set", () => {
    vi.stubEnv("NEXT_PUBLIC_E2E_TEST", "true");
    stubWindow("localhost");

    expect(isE2eTestMode()).toBe(true);
  });

  it("returns true for 127.0.0.1 with the env flag set", () => {
    vi.stubEnv("NEXT_PUBLIC_E2E_TEST", "true");
    stubWindow("127.0.0.1");

    expect(isE2eTestMode()).toBe(true);
  });

  it("returns true for localhost with localStorage mento_e2e_wallet set (no env flag)", () => {
    stubWindow("localhost", { mento_e2e_wallet: "true" });

    expect(isE2eTestMode()).toBe(true);
  });

  it("returns false for a public Mento hostname even with both the env flag and localStorage set (allowlist wins)", () => {
    vi.stubEnv("NEXT_PUBLIC_E2E_TEST", "true");
    stubWindow("app.mento.org", { mento_e2e_wallet: "true" });

    expect(isE2eTestMode()).toBe(false);
  });

  it("returns false for a Vercel-preview-style hostname with both the env flag and localStorage set", () => {
    vi.stubEnv("NEXT_PUBLIC_E2E_TEST", "true");
    stubWindow("frontend-monorepo-git-branch.vercel.app", {
      mento_e2e_wallet: "true",
    });

    expect(isE2eTestMode()).toBe(false);
  });

  it("returns false for localhost with neither the env flag nor localStorage set", () => {
    stubWindow("localhost");

    expect(isE2eTestMode()).toBe(false);
  });

  it("returns false when localStorage getItem throws, without crashing", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { hostname: "localhost" },
        localStorage: {
          getItem: () => {
            throw new Error("localStorage is blocked");
          },
        },
      },
    });

    expect(isE2eTestMode()).toBe(false);
  });
});
