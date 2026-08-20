import { createStore } from "jotai";
import { RESET } from "jotai/utils";
import { describe, expect, it, vi } from "vitest";

vi.mock("./chains", () => ({
  ChainId: {
    Celo: 42220,
    CeloSepolia: 11142220,
    Monad: 143,
    MonadTestnet: 10143,
    Polygon: 137,
    PolygonAmoy: 80002,
    BaseSepolia: 84532,
  },
}));

import {
  readTestnetModeCookie,
  readTestnetModeStorage,
  TESTNET_MODE_COOKIE,
  testnetModeAtom,
} from "./testnet-mode";

describe("testnet-mode cookie parsing", () => {
  it("reads enabled cookie values", () => {
    expect(readTestnetModeCookie("foo=bar; mento_testnet_mode=1")).toBe(true);
    expect(readTestnetModeCookie("mento_testnet_mode=true")).toBe(true);
  });

  it("reads disabled and missing cookie values", () => {
    expect(readTestnetModeCookie("mento_testnet_mode=0")).toBe(false);
    expect(readTestnetModeCookie("mento_testnet_mode=v1:123:0")).toBe(false);
    expect(
      readTestnetModeCookie(`mento_testnet_mode=v1:${"9".repeat(1000)}:0`),
    ).toBe(false);
    expect(readTestnetModeCookie("foo=bar")).toBe(false);
  });
});

describe("testnet-mode storage access", () => {
  it("falls back when localStorage is null", () => {
    const originalWindow = globalThis.window;

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: null },
    });

    try {
      expect(readTestnetModeStorage()).toBe(false);
      expect(readTestnetModeStorage(true)).toBe(true);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it("falls back when localStorage access throws", () => {
    const originalWindow = globalThis.window;

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        get localStorage() {
          throw new Error("localStorage is blocked");
        },
      },
    });

    try {
      expect(readTestnetModeStorage()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it("falls back to localStorage when cookie access throws", () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: { getItem: vi.fn(() => "true") } },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        get cookie() {
          throw new Error("cookies are blocked");
        },
      },
    });

    try {
      expect(readTestnetModeStorage()).toBe(true);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
    }
  });

  it("continues when cookie writes are blocked", () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: vi.fn(() => null),
          setItem: vi.fn(),
          removeItem: vi.fn(),
        },
      },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        get cookie() {
          return "";
        },
        set cookie(_value: string) {
          throw new Error("cookies are blocked");
        },
      },
    });

    try {
      const store = createStore();

      expect(() => store.set(testnetModeAtom, true)).not.toThrow();
      expect(() => store.set(testnetModeAtom, RESET)).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
    }
  });

  it("prefers a successful localStorage write over a stale cookie", () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    let localStorageValue: string | null = "false";

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: vi.fn(() => localStorageValue),
          setItem: vi.fn((_key: string, value: string) => {
            localStorageValue = value;
          }),
        },
      },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        get cookie() {
          return `${TESTNET_MODE_COOKIE}=0`;
        },
        set cookie(_value: string) {
          throw new Error("cookies are blocked");
        },
      },
    });

    try {
      const store = createStore();

      expect(() => store.set(testnetModeAtom, true)).not.toThrow();
      expect(readTestnetModeStorage(false)).toBe(true);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
    }
  });

  it("prefers a successful localStorage reset over a stale cookie", () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    let localStorageValue: string | null = "true";

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: vi.fn(() => localStorageValue),
          setItem: vi.fn((_key: string, value: string) => {
            localStorageValue = value;
          }),
        },
      },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        get cookie() {
          return `${TESTNET_MODE_COOKIE}=1`;
        },
        set cookie(_value: string) {
          throw new Error("cookies are blocked");
        },
      },
    });

    try {
      const store = createStore();

      expect(() => store.set(testnetModeAtom, RESET)).not.toThrow();
      expect(readTestnetModeStorage(true)).toBe(false);
      expect(localStorageValue).toMatch(/^v1:\d+:0$/);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
    }
  });

  it("selects the newest version across cookie and localStorage", () => {
    const originalWindow = globalThis.window;
    let localStorageValue = "v1:100:0";

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: vi.fn(() => localStorageValue),
        },
      },
    });

    try {
      expect(
        readTestnetModeStorage(false, `${TESTNET_MODE_COOKIE}=v1:200:1`),
      ).toBe(true);

      localStorageValue = "v1:300:1";
      expect(
        readTestnetModeStorage(true, `${TESTNET_MODE_COOKIE}=v1:250:0`),
      ).toBe(true);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it("persists the cookie when a localStorage write throws", () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const cookieWrites: string[] = [];
    let cookieValue = "";

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: vi.fn(() => "false"),
          setItem: vi.fn(() => {
            throw new Error("localStorage is blocked");
          }),
        },
      },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        get cookie() {
          return cookieValue;
        },
        set cookie(value: string) {
          cookieWrites.push(value);
          cookieValue = value.split(";")[0] ?? "";
        },
      },
    });

    try {
      const store = createStore();

      expect(() => store.set(testnetModeAtom, true)).not.toThrow();
      expect(cookieWrites).toHaveLength(1);
      expect(cookieWrites[0]).toMatch(
        new RegExp(
          `^${TESTNET_MODE_COOKIE}=v1:\\d+:1; Path=/; Max-Age=31536000; SameSite=Lax$`,
        ),
      );
      expect(readTestnetModeStorage(false, cookieValue)).toBe(true);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
    }
  });

  it("persists a false tombstone when a localStorage write throws", () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const cookieWrites: string[] = [];
    let cookieValue = `${TESTNET_MODE_COOKIE}=1`;

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: vi.fn(() => "true"),
          setItem: vi.fn(() => {
            throw new Error("localStorage is blocked");
          }),
        },
      },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        get cookie() {
          return cookieValue;
        },
        set cookie(value: string) {
          cookieWrites.push(value);
          cookieValue = value.split(";")[0] ?? "";
        },
      },
    });

    try {
      const store = createStore();

      expect(() => store.set(testnetModeAtom, RESET)).not.toThrow();
      expect(cookieWrites).toHaveLength(1);
      expect(cookieWrites[0]).toMatch(
        new RegExp(
          `^${TESTNET_MODE_COOKIE}=v1:\\d+:0; Path=/; Max-Age=31536000; SameSite=Lax$`,
        ),
      );
      expect(readTestnetModeStorage(false, cookieValue)).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
    }
  });
});
