import React, { useEffect, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PoolsView } from "./pools-view";

const replaceMock = vi.fn();
const refetchMock = vi.fn();
const currentSearch = { value: "" };

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: replaceMock,
  }),
  useSearchParams: () => new URLSearchParams(currentSearch.value),
}));

vi.mock("next/image", () => ({
  default: (
    props: React.ImgHTMLAttributes<HTMLImageElement> & {
      unoptimized?: boolean;
    },
  ) => {
    const imageProps = { ...props };
    delete imageProps.unoptimized;

    // eslint-disable-next-line @next/next/no-img-element
    return <img {...imageProps} alt={props.alt ?? ""} />;
  },
}));

vi.mock("@repo/ui", () => ({
  Button: ({
    children,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...rest}>{children}</button>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
  useDebounce: (value: string, delay: number) => {
    const [debouncedValue, setDebouncedValue] = useState(value);

    useEffect(() => {
      const timeoutId = window.setTimeout(
        () => setDebouncedValue(value),
        delay,
      );
      return () => window.clearTimeout(timeoutId);
    }, [delay, value]);

    return debouncedValue;
  },
}));

vi.mock("@repo/web3", () => ({
  useAllPoolsList: () => ({
    data: [
      {
        chainId: 42220,
        poolAddr: "0xpool",
        poolType: "FPMM",
        token0: {
          symbol: "cUSD",
          name: "Celo Dollar",
        },
        token1: {
          symbol: "CELO",
          name: "Celo",
        },
      },
    ],
    isLoading: false,
    isFetchingMore: false,
    isError: false,
    isPartialError: false,
    failedChainIds: [],
    refetch: refetchMock,
  }),
  usePoolRewards: () => ({
    rewards: new Map(),
    isLoading: false,
    isError: false,
    failedChainIds: [],
    refetch: refetchMock,
  }),
  getPoolRewardKey: () => "reward-key",
  chainIdToSlug: () => "celo",
  chainIdToChain: {
    42220: {
      name: "Celo",
      iconUrl: "/celo.png",
    },
  },
  useVisibleChains: () => [42220],
}));

vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({
    address: undefined,
    isConnected: false,
  }),
  useReadContracts: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("./pools-table", () => ({
  PoolsTable: ({ pools }: { pools: Array<{ poolAddr: string }> }) => (
    <div data-testid="pools-table">
      {pools.map((pool) => pool.poolAddr).join(",")}
    </div>
  ),
}));

vi.mock("./liquidity-flow-dialog", () => ({
  LiquidityFlowDialog: () => null,
}));

vi.mock("./rewards-campaign-banner", () => ({
  RewardsCampaignBanner: () => null,
}));

describe("PoolsView", () => {
  beforeEach(() => {
    currentSearch.value = "";
    replaceMock.mockReset();
    refetchMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("debounces router updates while keeping typing responsive", () => {
    render(<PoolsView />);

    const input = screen.getByPlaceholderText("Search pools...");

    fireEvent.change(input, { target: { value: "c" } });
    fireEvent.change(input, { target: { value: "ce" } });
    fireEvent.change(input, { target: { value: "cel" } });

    expect((input as HTMLInputElement).value).toBe("cel");
    expect(replaceMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(replaceMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenLastCalledWith("?q=cel", {
      scroll: false,
    });
  });
});
