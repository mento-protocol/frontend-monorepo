import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { setUserMock, setContextMock, setTagMock, useWalletInfoMock } =
  vi.hoisted(() => ({
    setUserMock: vi.fn(),
    setContextMock: vi.fn(),
    setTagMock: vi.fn(),
    useWalletInfoMock: vi.fn(),
  }));

vi.mock("@sentry/nextjs", () => ({
  setUser: setUserMock,
  setContext: setContextMock,
  setTag: setTagMock,
}));

vi.mock("@repo/web3", () => ({
  useWalletInfo: () => useWalletInfoMock(),
}));

import {
  sentryUserId,
  useSentryWalletContext,
} from "./use-sentry-wallet-context";

const ADDRESS = "0x1234567890AbcdEF1234567890aBcdef12345678";

function connectedWallet(address: string = ADDRESS) {
  return {
    address,
    connectorName: "MetaMask",
    connectorId: "metaMask",
    connectorType: "injected",
    chainId: 42220,
    connectionStatus: "connected",
    isConnected: true,
  };
}

afterEach(() => {
  setUserMock.mockReset();
  setContextMock.mockReset();
  setTagMock.mockReset();
  useWalletInfoMock.mockReset();
});

describe("useSentryWalletContext", () => {
  it("sets a pseudonymous 16-hex-character user id when connected", () => {
    useWalletInfoMock.mockReturnValue(connectedWallet());

    renderHook(() => useSentryWalletContext());

    expect(setUserMock).toHaveBeenCalledTimes(1);
    const user = setUserMock.mock.calls[0]?.[0];
    expect(Object.keys(user)).toEqual(["id"]);
    expect(user.id).toMatch(/^[0-9a-f]{16}$/);
    expect(user.id).toBe(sentryUserId(ADDRESS));
    const lowerAddress = ADDRESS.toLowerCase();
    expect(user.id).not.toContain(lowerAddress.slice(2, 18));
    expect(lowerAddress).not.toContain(user.id);
  });

  it("keeps the wallet address out of the wallet context", () => {
    useWalletInfoMock.mockReturnValue(connectedWallet());

    renderHook(() => useSentryWalletContext());

    expect(setContextMock).toHaveBeenCalledWith("wallet", {
      connector_name: "MetaMask",
      connector_id: "metaMask",
      connector_type: "injected",
      chain_id: 42220,
      connection_status: "connected",
    });
    const context = setContextMock.mock.calls[0]?.[1];
    expect(context).not.toHaveProperty("address");
    expect(JSON.stringify(context).toLowerCase()).not.toContain(
      ADDRESS.toLowerCase(),
    );
  });

  it("derives the same id regardless of address case", () => {
    expect(sentryUserId(ADDRESS.toLowerCase())).toBe(sentryUserId(ADDRESS));
    expect(sentryUserId(ADDRESS.toUpperCase().replace("0X", "0x"))).toBe(
      sentryUserId(ADDRESS),
    );
  });

  it("clears the user when disconnected", () => {
    useWalletInfoMock.mockReturnValue({
      address: undefined,
      connectorName: undefined,
      connectorId: undefined,
      connectorType: undefined,
      chainId: undefined,
      connectionStatus: "disconnected",
      isConnected: false,
    });

    renderHook(() => useSentryWalletContext());

    expect(setUserMock).toHaveBeenCalledWith(null);
    expect(setContextMock).toHaveBeenCalledWith("wallet", null);
  });
});
