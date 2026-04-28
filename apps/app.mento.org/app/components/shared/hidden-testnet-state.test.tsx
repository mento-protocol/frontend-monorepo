import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { HiddenTestnetState } from "./hidden-testnet-state";

const refreshMock = vi.fn();
const pushMock = vi.fn();
const setTestnetModeMock = vi.fn();
const switchChainAsyncMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
    push: pushMock,
  }),
}));

vi.mock("@repo/web3", () => ({
  ChainId: {
    Celo: 42220,
  },
  chainIdToChain: {
    42220: { name: "Celo" },
  },
  useTestnetMode: () => [false, setTestnetModeMock],
}));

vi.mock("@repo/web3/wagmi", () => ({
  useSwitchChain: () => ({
    switchChainAsync: switchChainAsyncMock,
  }),
}));

describe("HiddenTestnetState", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    pushMock.mockReset();
    setTestnetModeMock.mockReset();
    switchChainAsyncMock.mockReset();
  });

  it("enables testnet mode and refreshes when requested", () => {
    render(
      <HiddenTestnetState title="Hidden" description="desc" refreshOnEnable />,
    );

    fireEvent.click(screen.getByText("Enable Testnet Mode"));

    expect(setTestnetModeMock).toHaveBeenCalledWith(true);
    expect(refreshMock).toHaveBeenCalled();
  });

  it("renders and triggers a switch-network action", async () => {
    render(
      <HiddenTestnetState
        title="Hidden"
        description="desc"
        switchChainId={42220}
      />,
    );

    fireEvent.click(screen.getByText("Switch to Celo"));

    expect(switchChainAsyncMock).toHaveBeenCalledWith({ chainId: 42220 });
  });
});
