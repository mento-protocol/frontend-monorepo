import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BridgeView } from "./bridge-view";
import { patchBridgeWidgetAccessibility } from "./bridge-widget-accessibility";

const { accountState, chainState } = vi.hoisted(() => ({
  accountState: { isConnected: false },
  chainState: { chainId: 42220, supported: true },
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function BridgeWidgetStub() {
      return <div data-testid="bridge-widget" />;
    },
}));

vi.mock("./bridge-config", () => ({
  bridgeConfig: {},
  getBridgeTheme: () => ({}),
}));

vi.mock("./bridge-widget-accessibility", () => ({
  patchBridgeWidgetAccessibility: vi.fn(),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}));

vi.mock("@repo/web3", () => ({
  Celo: { id: 42220 },
  isFeatureConfiguredOnChain: () => chainState.supported,
  useSwitchChainWithFeedback: () => ({ switchToChain: vi.fn() }),
  ConnectButton: ({ text }: { text?: string }) => (
    <button type="button">{text}</button>
  ),
}));

vi.mock("@repo/web3/wagmi", () => ({
  useChainId: () => chainState.chainId,
  useAccount: () => accountState,
}));

describe("BridgeView", () => {
  afterEach(cleanup);

  beforeEach(() => {
    accountState.isConnected = false;
    chainState.chainId = 42220;
    chainState.supported = true;
    vi.mocked(patchBridgeWidgetAccessibility).mockClear();
  });

  it("asks for a wallet connection before showing the widget", () => {
    render(<BridgeView />);

    expect(
      screen.getByRole("heading", { name: "Connect your wallet to bridge" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect Wallet" })).toBeTruthy();
    expect(screen.queryByTestId("bridge-widget")).toBeNull();
  });

  it("shows the widget once a wallet is connected", () => {
    accountState.isConnected = true;

    render(<BridgeView />);

    expect(screen.getByTestId("bridge-widget")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Connect your wallet to bridge" }),
    ).toBeNull();
  });

  it("attaches the accessibility patch when the widget mounts after connecting", () => {
    const { container, rerender } = render(<BridgeView />);
    expect(patchBridgeWidgetAccessibility).not.toHaveBeenCalled();

    accountState.isConnected = true;
    rerender(<BridgeView />);

    const widgetRoot = container.querySelector(".bridge-widget");
    expect(widgetRoot).not.toBeNull();
    expect(patchBridgeWidgetAccessibility).toHaveBeenCalledWith(widgetRoot);
  });

  it("shows the mainnet-only state on an unsupported chain", () => {
    accountState.isConnected = true;
    chainState.chainId = 44787;
    chainState.supported = false;

    render(<BridgeView />);

    expect(
      screen.getByRole("heading", {
        name: "Bridging is currently mainnet-only",
      }),
    ).toBeTruthy();
    expect(screen.queryByTestId("bridge-widget")).toBeNull();
  });
});
