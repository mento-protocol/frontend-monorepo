// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { parseUnits } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolDisplay } from "@repo/web3";

type TransactionParams = {
  to: string;
  data: string;
  value?: string;
};

type TestFlowStep = {
  id: string;
  buildTx: () => Promise<TransactionParams> | TransactionParams;
};

const mocks = vi.hoisted(() => ({
  useLiquidityQuote: vi.fn(),
  refetchLiquidityQuote: vi.fn(),
  useAddLiquidityTransaction: vi.fn(),
  buildAddLiquidityTransaction: vi.fn(),
  useZapInTransaction: vi.fn(),
  buildZapInTransaction: vi.fn(),
  executeLiquidityFlow: vi.fn(),
  useReadContract: vi.fn(),
  toastError: vi.fn(),
  showLiquiditySuccessToast: vi.fn(),
  setFlow: vi.fn(),
  balances: new Map<string, bigint>(),
  allowances: new Map<string, bigint>(),
}));

vi.mock("@mento-protocol/ui", () => ({
  Button: ({
    children,
    size: _size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string }) => (
    <button {...props}>{children}</button>
  ),
  CoinInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <select
      data-testid={value.startsWith("0x") ? "token-select" : "slippage-select"}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectItem: ({ value }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{value}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  TokenIcon: () => null,
  toast: { error: mocks.toastError },
}));

vi.mock("@repo/web3", () => ({
  SLIPPAGE_OPTIONS: [0.3, 0.5, 1],
  useLiquidityQuote: (params: unknown) => mocks.useLiquidityQuote(params),
  useAddLiquidityTransaction: (...args: unknown[]) =>
    mocks.useAddLiquidityTransaction(...args),
  useZapInQuote: () => ({ isFetching: false }),
  useZapInTransaction: (...args: unknown[]) =>
    mocks.useZapInTransaction(...args),
  ConnectButton: () => null,
  tryParseUnits: (amount: string, decimals: number) => {
    if (!amount) return null;
    const [integer = "0", fraction = ""] = amount.split(".");
    const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
    return (
      BigInt(integer) * 10n ** BigInt(decimals) + BigInt(paddedFraction || "0")
    );
  },
  formatCompactBalance: (balance: string) => balance,
  executeLiquidityFlow: (...args: unknown[]) =>
    mocks.executeLiquidityFlow(...args),
  liquidityFlowAtom: {},
  showLiquiditySuccessToast: mocks.showLiquiditySuccessToast,
  getPoolDisplayOrder: (pool: PoolDisplay) => ({
    displayToken0: pool.token0,
    displayToken1: pool.token1,
    isSwapped: false,
  }),
  isUserRejection: () => false,
}));

vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({
    address: "0x00000000000000000000000000000000000000aa",
  }),
  useConfig: () => ({}),
  useBlockNumber: () => ({ data: undefined }),
  useReadContract: (params: unknown) => mocks.useReadContract(params),
}));

vi.mock("@mento-protocol/mento-sdk", () => ({
  getContractAddress: () => "0x00000000000000000000000000000000000000bb",
}));

vi.mock("jotai", () => ({
  useSetAtom: () => mocks.setFlow,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    refetchQueries: vi.fn(),
  }),
}));

vi.mock("lucide-react", () => ({ AlertTriangle: () => null }));

import { AddLiquidityForm } from "./add-liquidity-form";

const EURM = "0x0000000000000000000000000000000000000002";
const USDM = "0x0000000000000000000000000000000000000003";
const OWNER = "0x00000000000000000000000000000000000000aa";

const pool: PoolDisplay = {
  poolAddr: "0x0000000000000000000000000000000000000001",
  chainId: 143,
  poolType: "FPMM",
  token0: { symbol: "EURm", address: EURM, decimals: 18, name: "Euro Mento" },
  token1: {
    symbol: "USDm",
    address: USDM,
    decimals: 18,
    name: "Dollar Mento",
  },
  reserves: {
    token0: "0",
    token1: "0",
    token0Ratio: 0.5,
    hasLiquidity: true,
  },
  fees: { total: 0.3, lp: 0.2, protocol: 0.1, label: "fee" },
  priceAlignment: { status: "in-band" },
  tvl: 0,
};

const walletEURm = parseUnits("2199.275594139894034278", 18);
const walletUSDm = parseUnits("1677.027867285683156092", 18);
const canonicalEURm = parseUnits("1938.824449465635730703", 18);
const canonicalUSDm = parseUnits("1677.027867285683156092", 18);

let currentQuote: Record<string, unknown>;
let currentAddBuild: Record<string, unknown>;
let currentZapPreviewBuild: Record<string, unknown>;
let sentTransactions: TransactionParams[];
let flowEvents: string[];

function minimumAmount(amount: bigint): bigint {
  return (amount * 9_970n) / 10_000n;
}

function makeAddBuild({ approvals }: { approvals: boolean }) {
  return {
    approvalA: approvals
      ? { params: { to: EURM, data: "0xapprove-eurm", value: "0" } }
      : undefined,
    approvalB: approvals
      ? { params: { to: USDM, data: "0xapprove-usdm", value: "0" } }
      : undefined,
    addLiquidity: {
      amountADesired: canonicalEURm,
      amountBDesired: canonicalUSDm,
      amountAMin: minimumAmount(canonicalEURm),
      amountBMin: minimumAmount(canonicalUSDm),
      params: {
        to: "0x00000000000000000000000000000000000000bb",
        data: "0xcanonical-add-liquidity",
        value: "0",
      },
    },
  };
}

function makeZapBuild({
  token,
  approvalData,
  zapData,
}: {
  token: string;
  approvalData?: string;
  zapData: string;
}) {
  return {
    approval: approvalData
      ? { params: { to: token, data: approvalData, value: "0" } }
      : undefined,
    zapIn: {
      params: {
        to: "0x00000000000000000000000000000000000000bb",
        data: zapData,
        value: "0",
      },
    },
  };
}

describe("AddLiquidityForm canonical transaction flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sentTransactions = [];
    flowEvents = [];
    mocks.balances.clear();
    mocks.allowances.clear();
    mocks.balances.set(EURM, walletEURm);
    mocks.balances.set(USDM, walletUSDm);
    mocks.allowances.set(EURM, 0n);
    mocks.allowances.set(USDM, 0n);

    currentQuote = {
      amountA: canonicalEURm,
      amountB: canonicalUSDm,
      liquidity: 1n,
      totalSupply: 10_000n,
      reserve0: parseUnits("2000", 18),
      reserve1: parseUnits("1730", 18),
      requestId: 1,
      requestKind: "max",
      surplus0: walletEURm - canonicalEURm,
      surplus1: walletUSDm - canonicalUSDm,
    };
    currentAddBuild = makeAddBuild({ approvals: true });
    currentZapPreviewBuild = makeZapBuild({
      token: EURM,
      approvalData: "0xold-preview-approval",
      zapData: "0xold-preview-zap",
    });

    mocks.refetchLiquidityQuote.mockImplementation(async () => ({
      data: currentQuote,
      error: null,
    }));
    mocks.useLiquidityQuote.mockImplementation(
      ({ request }: { request: { id: number } | null }) => ({
        data: request ? currentQuote : null,
        isFetching: false,
        isDebouncing: false,
        refetch: mocks.refetchLiquidityQuote,
      }),
    );
    mocks.useAddLiquidityTransaction.mockImplementation(() => ({
      buildTransaction: mocks.buildAddLiquidityTransaction,
      buildResult: currentAddBuild,
      isBuilding: false,
    }));
    mocks.useZapInTransaction.mockImplementation(() => ({
      buildTransaction: mocks.buildZapInTransaction,
      buildResult: currentZapPreviewBuild,
      buildError: null,
      isBuilding: false,
    }));
    mocks.useReadContract.mockImplementation(
      ({
        address,
        functionName,
      }: {
        address: string;
        functionName: string;
      }) => {
        const data =
          functionName === "balanceOf"
            ? mocks.balances.get(address)
            : mocks.allowances.get(address);
        return {
          data,
          refetch: vi.fn().mockResolvedValue({ data }),
        };
      },
    );
    mocks.executeLiquidityFlow.mockImplementation(
      async (...args: unknown[]) => {
        const steps = args[3] as TestFlowStep[];
        for (const step of steps) {
          flowEvents.push(`step:${step.id}`);
          const transaction = await step.buildTx();
          sentTransactions.push(transaction);
          flowEvents.push(`send:${transaction.data}`);
        }
        return { success: false, txHashes: [] };
      },
    );
  });

  afterEach(() => cleanup());

  it("uses one Router-clipped MAX quote for inputs, summary, approvals, and calldata", async () => {
    const previewBuild = makeAddBuild({ approvals: true });
    const capturedBuild = makeAddBuild({ approvals: true });
    const freshBuild = makeAddBuild({ approvals: false });
    mocks.buildAddLiquidityTransaction
      .mockResolvedValueOnce(previewBuild)
      .mockResolvedValueOnce(capturedBuild)
      .mockResolvedValueOnce(freshBuild);

    render(<AddLiquidityForm pool={pool} />);
    fireEvent.click(screen.getByRole("button", { name: "MAX EURm" }));

    await waitFor(() => {
      expect(
        (screen.getByLabelText("Deposit amount in EURm") as HTMLInputElement)
          .value,
      ).toBe("1938.824449465635730703");
      expect(
        (screen.getByLabelText("Deposit amount in USDm") as HTMLInputElement)
          .value,
      ).toBe("1677.027867285683156092");
    });
    expect(screen.getByText("1,938.824449465635730703")).toBeTruthy();
    expect(screen.getByText("1,677.027867285683156092")).toBeTruthy();
    expect(mocks.useLiquidityQuote).toHaveBeenLastCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          kind: "max",
          token: 0,
          token0Balance: walletEURm,
          token1Balance: walletUSDm,
        }),
      }),
    );
    await waitFor(() =>
      expect(mocks.buildAddLiquidityTransaction).toHaveBeenCalledTimes(1),
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Liquidity" }));

    await waitFor(() =>
      expect(mocks.buildAddLiquidityTransaction).toHaveBeenCalledTimes(3),
    );
    for (const call of mocks.buildAddLiquidityTransaction.mock.calls) {
      expect(call).toEqual([canonicalEURm, canonicalUSDm, OWNER, 0.3]);
    }
    expect(sentTransactions).toEqual([
      capturedBuild.approvalA?.params,
      capturedBuild.approvalB?.params,
      freshBuild.addLiquidity.params,
    ]);
  });

  it.each([
    ["EURm", EURM],
    ["USDm", USDM],
  ])(
    "uses the click-time %s approval and refuses a zap whose fresh build still needs approval",
    async (symbol, selectedToken) => {
      const otherToken = selectedToken === EURM ? USDM : EURM;
      const amount = parseUnits("1", 18);
      mocks.balances.set(EURM, parseUnits("10", 18));
      mocks.balances.set(USDM, parseUnits("10", 18));
      mocks.allowances.set(selectedToken, 0n);
      mocks.allowances.set(otherToken, amount + 1n);

      const oldPreview = makeZapBuild({
        token: selectedToken,
        approvalData: `0xold-${symbol.toLowerCase()}`,
        zapData: "0xold-zap",
      });
      const clickTimeBuild = makeZapBuild({
        token: selectedToken,
        approvalData: `0xcaptured-${symbol.toLowerCase()}`,
        zapData: "0xcaptured-zap",
      });
      const stillNeedsApproval = makeZapBuild({
        token: selectedToken,
        approvalData: `0xstill-${symbol.toLowerCase()}`,
        zapData: "0xfresh-zap-must-not-send",
      });
      currentZapPreviewBuild = oldPreview;

      let buildCall = 0;
      mocks.buildZapInTransaction.mockImplementation(async () => {
        buildCall += 1;
        if (buildCall === 1) return oldPreview;
        if (buildCall === 2) {
          flowEvents.push("click-time-build");
          return clickTimeBuild;
        }
        flowEvents.push("fresh-zap-build");
        return stillNeedsApproval;
      });

      render(<AddLiquidityForm pool={pool} />);
      fireEvent.click(screen.getByRole("button", { name: "Single token" }));
      if (selectedToken === USDM) {
        fireEvent.change(screen.getByTestId("token-select"), {
          target: { value: USDM },
        });
      }
      fireEvent.change(screen.getByLabelText(`Deposit amount in ${symbol}`), {
        target: { value: "1" },
      });
      await waitFor(() =>
        expect(mocks.buildZapInTransaction).toHaveBeenCalledTimes(1),
      );

      fireEvent.click(screen.getByRole("button", { name: "Add Liquidity" }));

      await waitFor(() =>
        expect(mocks.buildZapInTransaction).toHaveBeenCalledTimes(3),
      );
      expect(mocks.buildZapInTransaction.mock.calls[1]).toEqual([
        selectedToken,
        amount,
        OWNER,
        0.3,
      ]);
      expect(mocks.buildZapInTransaction.mock.calls[2]).toEqual([
        selectedToken,
        amount,
        OWNER,
        0.3,
      ]);
      expect(sentTransactions).toEqual([clickTimeBuild.approval?.params]);
      expect(sentTransactions).not.toContainEqual(oldPreview.approval?.params);
      expect(sentTransactions).not.toContainEqual(
        stillNeedsApproval.zapIn.params,
      );
      expect(flowEvents.indexOf("step:approve-token")).toBeLessThan(
        flowEvents.indexOf("fresh-zap-build"),
      );
    },
  );
});
