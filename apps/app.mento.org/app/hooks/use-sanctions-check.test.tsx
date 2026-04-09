import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import React from "react";

const { disconnectMock, toastErrorMock } = vi.hoisted(() => ({
  disconnectMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: vi.fn(),
  useDisconnect: () => ({ disconnect: disconnectMock }),
}));

vi.mock("@repo/ui", () => ({
  toast: { error: toastErrorMock },
}));

import { useAccount } from "wagmi";
import { useSanctionsCheck } from "./use-sanctions-check";

const useAccountMock = vi.mocked(useAccount);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return function Wrapper({ children }: PropsWithChildren) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

beforeEach(() => {
  disconnectMock.mockClear();
  toastErrorMock.mockClear();
  vi.unstubAllGlobals();

  useAccountMock.mockReturnValue({
    address: undefined,
    isConnected: false,
  } as ReturnType<typeof useAccount>);
});

afterEach(() => {
  cleanup();
});

describe("useSanctionsCheck", () => {
  it("returns default state when not connected", () => {
    const { result } = renderHook(() => useSanctionsCheck(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isSanctioned).toBe(false);
    expect(result.current.isChecking).toBe(false);
    expect(result.current.checkFailed).toBe(false);
  });

  it("sets isChecking while query is in-flight", async () => {
    useAccountMock.mockReturnValue({
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      isConnected: true,
    } as ReturnType<typeof useAccount>);

    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));

    const { result, unmount } = renderHook(() => useSanctionsCheck(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isChecking).toBe(true);
    });
    expect(result.current.isSanctioned).toBe(false);
    expect(result.current.checkFailed).toBe(false);

    unmount();
  });

  it("returns isSanctioned: false for a clean address", async () => {
    useAccountMock.mockReturnValue({
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      isConnected: true,
    } as ReturnType<typeof useAccount>);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ isSanctioned: false }),
      }),
    );

    const { result } = renderHook(() => useSanctionsCheck(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });
    expect(result.current.isSanctioned).toBe(false);
    expect(result.current.checkFailed).toBe(false);
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it("disconnects and toasts when address is sanctioned", async () => {
    useAccountMock.mockReturnValue({
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      isConnected: true,
    } as ReturnType<typeof useAccount>);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ isSanctioned: true }),
      }),
    );

    const { result } = renderHook(() => useSanctionsCheck(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSanctioned).toBe(true);
    });

    expect(disconnectMock).toHaveBeenCalledOnce();
    expect(toastErrorMock).toHaveBeenCalledOnce();
    expect(toastErrorMock).toHaveBeenCalledWith(
      "This address cannot use this application due to sanctions compliance.",
      { duration: Infinity },
    );
  });

  it("sets checkFailed on API error after retries", async () => {
    useAccountMock.mockReturnValue({
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      isConnected: true,
    } as ReturnType<typeof useAccount>);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 502 }),
    );

    const { result } = renderHook(() => useSanctionsCheck(), {
      wrapper: createWrapper(),
    });

    await waitFor(
      () => {
        expect(result.current.checkFailed).toBe(true);
      },
      { timeout: 5000 },
    );
    expect(result.current.isSanctioned).toBe(false);
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it("treats isSanctioned: null as a failure", async () => {
    useAccountMock.mockReturnValue({
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      isConnected: true,
    } as ReturnType<typeof useAccount>);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ isSanctioned: null }),
      }),
    );

    const { result } = renderHook(() => useSanctionsCheck(), {
      wrapper: createWrapper(),
    });

    await waitFor(
      () => {
        expect(result.current.checkFailed).toBe(true);
      },
      { timeout: 5000 },
    );
  });

  it("does not disconnect twice on re-render", async () => {
    useAccountMock.mockReturnValue({
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      isConnected: true,
    } as ReturnType<typeof useAccount>);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ isSanctioned: true }),
      }),
    );

    const { result, rerender } = renderHook(() => useSanctionsCheck(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSanctioned).toBe(true);
    });

    await act(async () => rerender());
    await act(async () => rerender());

    expect(disconnectMock).toHaveBeenCalledOnce();
  });
});
