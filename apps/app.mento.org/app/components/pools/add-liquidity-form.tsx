import {
  Button,
  TokenIcon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  CoinInput,
  toast,
} from "@repo/ui";
import type { PoolDisplay, SlippageOption } from "@repo/web3";
import {
  SLIPPAGE_OPTIONS,
  useLiquidityQuote,
  getProportionalAmount,
  useAddLiquidityTransaction,
  useZapInQuote,
  useZapInTransaction,
  ConnectButton,
  tryParseUnits,
  formatCompactBalance,
  executeLiquidityFlow,
  liquidityFlowAtom,
  showLiquiditySuccessToast,
  type LiquidityFlowStepDefinition,
  getPoolDisplayOrder,
} from "@repo/web3";
import {
  useAccount,
  useReadContract,
  useConfig,
  useBlockNumber,
} from "@repo/web3/wagmi";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useState, useEffect, useCallback, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { getContractAddress } from "@mento-protocol/mento-sdk";
import { useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";

function TokenAmountInput({
  token,
  balance,
  amount,
  onChange,
  onMax,
  insufficient,
  disabled,
}: {
  token: { address: string; symbol: string };
  balance: string;
  amount: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  onMax: () => void;
  insufficient: boolean;
}) {
  return (
    <div className="gap-2 flex flex-col">
      <div className="gap-2 flex items-center justify-between">
        <span className="font-semibold font-mono tracking-widest text-[11px] text-muted-foreground uppercase">
          {token.symbol}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          Balance:{" "}
          <span className="text-muted-foreground/80">
            {formatCompactBalance(balance)}
          </span>
        </span>
      </div>
      <div
        className={`gap-2 px-4 py-1 flex items-center rounded-xl border bg-muted/30 transition-colors focus-within:border-primary ${insufficient ? "border-destructive" : "border-border"}`}
      >
        <CoinInput
          value={amount}
          onChange={onChange}
          placeholder="0.00"
          disabled={disabled}
          className="h-10 p-0 text-sm font-mono flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <button
          className="px-2 py-1 font-bold font-mono tracking-wider cursor-pointer rounded-md bg-primary/10 text-[11px] text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onMax}
          disabled={disabled}
        >
          MAX
        </button>
        <div className="gap-1.5 px-3 py-1.5 flex items-center rounded-lg bg-muted/50">
          <TokenIcon
            token={{ address: token.address, symbol: token.symbol }}
            size={20}
            className="rounded-full"
          />
          <span className="text-sm font-semibold text-foreground/70">
            {token.symbol}
          </span>
        </div>
      </div>
      {insufficient && (
        <p className="text-xs text-destructive">
          Insufficient {token.symbol} balance
        </p>
      )}
    </div>
  );
}

function formatSummaryAmount(amount: string): string {
  if (amount === "—") return amount;

  const value = Number(amount);
  if (!Number.isFinite(value)) return "0.0000";

  return value.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

interface AddLiquidityFormProps {
  pool: PoolDisplay;
  onLiquidityUpdated?: () => void | Promise<void>;
  header?: React.ReactNode;
  disabled?: boolean;
}

export function AddLiquidityForm({
  pool,
  onLiquidityUpdated,
  header,
  disabled,
}: AddLiquidityFormProps) {
  const { displayToken0, displayToken1, isSwapped } = getPoolDisplayOrder(pool);
  const { address } = useAccount();
  const wagmiConfig = useConfig();
  const chainId = pool.chainId;
  const { data: blockNumber } = useBlockNumber({
    chainId,
    watch: !!address,
    query: { enabled: !!address },
  });
  const queryClient = useQueryClient();
  const setFlow = useSetAtom(liquidityFlowAtom);
  const routerAddress = getContractAddress(
    Number(chainId) as Parameters<typeof getContractAddress>[0],
    "Router",
  ) as Address;

  const [mode, setMode] = useState<"balanced" | "single">("balanced");
  const [token0Amount, setToken0Amount] = useState("");
  const [token1Amount, setToken1Amount] = useState("");
  const [lastEditedToken, setLastEditedToken] = useState<0 | 1>(0);
  const [slippage, setSlippage] = useState<SlippageOption>(0.3);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Single-token (zap) state
  const [zapTokenIn, setZapTokenIn] = useState<string>(pool.token0.address);
  const [zapAmount, setZapAmount] = useState("");

  // Track whether the auto-fill should be suppressed (during programmatic updates)
  const isAutoFilling = useRef(false);

  // Fetch token balances
  const { data: token0Balance, refetch: refetchToken0Balance } =
    useReadContract({
      chainId,
      address: pool.token0.address as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: address ? [address] : undefined,
      query: {
        enabled: !!address,
        staleTime: 0,
        refetchOnMount: true,
      },
    });

  const { data: token1Balance, refetch: refetchToken1Balance } =
    useReadContract({
      chainId,
      address: pool.token1.address as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: address ? [address] : undefined,
      query: {
        enabled: !!address,
        staleTime: 0,
        refetchOnMount: true,
      },
    });

  const formattedToken0Balance = token0Balance
    ? formatUnits(token0Balance, pool.token0.decimals)
    : "0";
  const formattedToken1Balance = token1Balance
    ? formatUnits(token1Balance, pool.token1.decimals)
    : "0";

  // Fetch token allowances for Router to avoid unnecessary approval steps.
  const { data: token0Allowance, refetch: refetchToken0Allowance } =
    useReadContract({
      chainId,
      address: pool.token0.address as Address,
      abi: erc20Abi,
      functionName: "allowance",
      args: address ? [address, routerAddress] : undefined,
      query: {
        enabled: !!address && !!routerAddress,
        staleTime: 0,
        refetchOnMount: true,
      },
    });

  const { data: token1Allowance, refetch: refetchToken1Allowance } =
    useReadContract({
      chainId,
      address: pool.token1.address as Address,
      abi: erc20Abi,
      functionName: "allowance",
      args: address ? [address, routerAddress] : undefined,
      query: {
        enabled: !!address && !!routerAddress,
        staleTime: 0,
        refetchOnMount: true,
      },
    });

  useEffect(() => {
    if (!address || blockNumber === undefined) return;
    void refetchToken0Balance();
    void refetchToken1Balance();
    void refetchToken0Allowance();
    void refetchToken1Allowance();
  }, [
    address,
    blockNumber,
    refetchToken0Balance,
    refetchToken1Balance,
    refetchToken0Allowance,
    refetchToken1Allowance,
  ]);

  // === Balanced mode hooks ===

  const { data: quote, isFetching: isQuoting } = useLiquidityQuote({
    pool,
    token0Amount: mode === "balanced" ? token0Amount : "",
    token1Amount: mode === "balanced" ? token1Amount : "",
    lastEditedToken,
    chainId,
  });

  // Auto-fill proportional amount when quote returns
  useEffect(() => {
    if (mode !== "balanced" || !quote || isAutoFilling.current) return;
    const proportional = getProportionalAmount(quote, lastEditedToken, pool);
    if (!proportional) return;

    isAutoFilling.current = true;
    if (lastEditedToken === 0) {
      setToken1Amount(proportional);
    } else {
      setToken0Amount(proportional);
    }
    requestAnimationFrame(() => {
      isAutoFilling.current = false;
    });
  }, [quote, lastEditedToken, pool, mode]);

  const { buildTransaction, buildResult, isBuilding } =
    useAddLiquidityTransaction(pool, chainId);

  // Build transaction when we have a valid quote and wallet
  useEffect(() => {
    if (mode !== "balanced") return;
    if (!address || !quote || quote.amountA === 0n || quote.amountB === 0n)
      return;
    buildTransaction(quote.amountA, quote.amountB, address, slippage);
  }, [quote, address, slippage, buildTransaction, mode]);

  // === Single-token (zap) hooks ===

  const zapToken =
    zapTokenIn === pool.token0.address ? pool.token0 : pool.token1;
  const zapTokenBalance =
    zapTokenIn === pool.token0.address ? token0Balance : token1Balance;
  const formattedZapBalance = zapTokenBalance
    ? formatUnits(zapTokenBalance, zapToken.decimals)
    : "0";

  const { isFetching: isZapQuoting } = useZapInQuote({
    pool,
    tokenIn: zapTokenIn,
    amountIn: mode === "single" ? zapAmount : "",
    slippage,
    chainId,
  });

  const {
    buildTransaction: buildZapTransaction,
    buildResult: zapBuildResult,
    buildError: zapBuildError,
    isBuilding: isZapBuilding,
  } = useZapInTransaction(pool, chainId);

  // Build zap transaction whenever the amount is valid for current state.
  useEffect(() => {
    if (mode !== "single" || !address || !zapAmount) return;
    const amountInWei = tryParseUnits(zapAmount, zapToken.decimals);
    if (!amountInWei || amountInWei <= 0n) return;
    buildZapTransaction(zapTokenIn as Address, amountInWei, address, slippage);
  }, [
    address,
    slippage,
    zapAmount,
    zapTokenIn,
    zapToken.decimals,
    mode,
    buildZapTransaction,
  ]);

  // === Input handlers ===

  const handleToken0Change = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isAutoFilling.current) return;
      setLastEditedToken(0);
      setToken0Amount(e.target.value);
    },
    [],
  );

  const handleToken1Change = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isAutoFilling.current) return;
      setLastEditedToken(1);
      setToken1Amount(e.target.value);
    },
    [],
  );

  const handleMax0 = useCallback(() => {
    setLastEditedToken(0);
    setToken0Amount(formattedToken0Balance);
  }, [formattedToken0Balance]);

  const handleMax1 = useCallback(() => {
    setLastEditedToken(1);
    setToken1Amount(formattedToken1Balance);
  }, [formattedToken1Balance]);

  // === Validation ===

  // Balanced mode
  const parsedToken0 = tryParseUnits(token0Amount, pool.token0.decimals);
  const parsedToken1 = tryParseUnits(token1Amount, pool.token1.decimals);
  const hasAmounts =
    parsedToken0 !== null &&
    parsedToken0 > 0n &&
    parsedToken1 !== null &&
    parsedToken1 > 0n;
  const insufficientToken0 =
    parsedToken0 !== null &&
    token0Balance !== undefined &&
    parsedToken0 > token0Balance;
  const insufficientToken1 =
    parsedToken1 !== null &&
    token1Balance !== undefined &&
    parsedToken1 > token1Balance;

  // Single-token mode
  const parsedZap = tryParseUnits(zapAmount, zapToken.decimals);
  const hasZapAmount = parsedZap !== null && parsedZap > 0n;
  const insufficientZap =
    parsedZap !== null &&
    zapTokenBalance !== undefined &&
    parsedZap > zapTokenBalance;

  // === Button state ===

  const getButtonState = () => {
    if (disabled) return { text: "Wrong network", disabled: true };
    if (isSubmitting) return { text: "Confirm in wallet...", disabled: true };

    if (mode === "single") {
      if (!hasZapAmount) return { text: "Enter amount", disabled: true };
      if (insufficientZap)
        return {
          text: `Insufficient ${zapToken.symbol} balance`,
          disabled: true,
        };
      if (zapBuildError) return { text: "Unavailable", disabled: true };
      if (isZapBuilding || isZapQuoting)
        return { text: "Preparing...", disabled: true };
      if (!zapBuildResult) return { text: "Preparing...", disabled: true };
      return { text: "Add Liquidity", disabled: false };
    }

    // Balanced mode
    if (!hasAmounts) return { text: "Enter amount", disabled: true };
    if (insufficientToken0)
      return {
        text: `Insufficient ${pool.token0.symbol} balance`,
        disabled: true,
      };
    if (insufficientToken1)
      return {
        text: `Insufficient ${pool.token1.symbol} balance`,
        disabled: true,
      };
    if (isBuilding || isQuoting)
      return { text: "Preparing...", disabled: true };
    if (!buildResult) return { text: "Preparing...", disabled: true };

    return { text: "Add Liquidity", disabled: false };
  };

  const buttonState = getButtonState();

  const refreshLiquidityState = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pools-list", chainId] }),
      queryClient.invalidateQueries({ queryKey: ["readContract"] }),
      queryClient.refetchQueries({
        queryKey: ["readContract"],
        type: "active",
      }),
      refetchToken0Balance(),
      refetchToken1Balance(),
      refetchToken0Allowance(),
      refetchToken1Allowance(),
      onLiquidityUpdated?.(),
    ]);
  }, [
    queryClient,
    chainId,
    refetchToken0Balance,
    refetchToken1Balance,
    refetchToken0Allowance,
    refetchToken1Allowance,
    onLiquidityUpdated,
  ]);

  const getLatestAllowances = useCallback(async () => {
    const [token0AllowanceResult, token1AllowanceResult] = await Promise.all([
      refetchToken0Allowance(),
      refetchToken1Allowance(),
    ]);

    return {
      token0: token0AllowanceResult.data ?? token0Allowance ?? 0n,
      token1: token1AllowanceResult.data ?? token1Allowance ?? 0n,
    };
  }, [
    refetchToken0Allowance,
    refetchToken1Allowance,
    token0Allowance,
    token1Allowance,
  ]);

  const handleAction = async () => {
    if (!address) return;
    setIsSubmitting(true);

    try {
      if (mode === "single" && zapBuildResult) {
        // --- Zap-in flow ---
        const capturedZapAmount = parsedZap;
        const capturedZapTokenIn = zapTokenIn;
        const capturedSlippage = slippage;

        if (!capturedZapAmount || capturedZapAmount <= 0n) {
          throw new Error("Invalid zap amount");
        }
        if (zapBuildError) {
          throw new Error(zapBuildError);
        }

        const steps: LiquidityFlowStepDefinition[] = [];

        const allowances = await getLatestAllowances();
        const currentZapAllowance =
          capturedZapTokenIn.toLowerCase() === pool.token0.address.toLowerCase()
            ? allowances.token0
            : allowances.token1;

        if (
          zapBuildResult.approval &&
          capturedZapAmount > currentZapAllowance
        ) {
          const approvalParams = zapBuildResult.approval.params;
          steps.push({
            id: "approve-token",
            label: `Approve ${zapToken.symbol}`,
            buildTx: async () => approvalParams,
          });
        }

        steps.push({
          id: "zap-in",
          label: "Add Liquidity",
          buildTx: async () => {
            const freshBuild = await buildZapTransaction(
              capturedZapTokenIn as Address,
              capturedZapAmount,
              address,
              capturedSlippage,
            );
            if (!freshBuild) {
              throw new Error(
                zapBuildError ||
                  "No viable zap-in route for this amount. Reduce amount or use balanced mode.",
              );
            }
            return freshBuild.zapIn.params;
          },
        });

        const result = await executeLiquidityFlow(
          wagmiConfig,
          setFlow,
          "Add Liquidity",
          steps,
          chainId,
        );

        if (result.success) {
          const lastTxHash = result.txHashes[result.txHashes.length - 1];
          if (lastTxHash) {
            showLiquiditySuccessToast({
              action: "added",
              token0Symbol: displayToken0.symbol,
              token1Symbol: displayToken1.symbol,
              txHash: lastTxHash,
              chainId,
            });
          }
          await refreshLiquidityState();
          setZapAmount("");
        }
      } else if (mode === "balanced" && quote && buildResult) {
        // --- Balanced add flow ---
        const capturedQuote = quote;
        const capturedSlippage = slippage;

        const steps: LiquidityFlowStepDefinition[] = [];
        const allowances = await getLatestAllowances();

        if (
          buildResult.approvalA &&
          capturedQuote.amountA > allowances.token0
        ) {
          const approvalParams = buildResult.approvalA.params;
          steps.push({
            id: "approve-a",
            label: `Approve ${pool.token0.symbol}`,
            buildTx: async () => approvalParams,
          });
        }

        if (
          buildResult.approvalB &&
          capturedQuote.amountB > allowances.token1
        ) {
          const approvalParams = buildResult.approvalB.params;
          steps.push({
            id: "approve-b",
            label: `Approve ${pool.token1.symbol}`,
            buildTx: async () => approvalParams,
          });
        }

        steps.push({
          id: "add-liquidity",
          label: "Add Liquidity",
          buildTx: async () => {
            const freshBuild = await buildTransaction(
              capturedQuote.amountA,
              capturedQuote.amountB,
              address,
              capturedSlippage,
            );
            if (!freshBuild) throw new Error("Failed to build transaction");
            return freshBuild.addLiquidity.params;
          },
        });

        const result = await executeLiquidityFlow(
          wagmiConfig,
          setFlow,
          "Add Liquidity",
          steps,
          chainId,
        );

        if (result.success) {
          const lastTxHash = result.txHashes[result.txHashes.length - 1];
          if (lastTxHash) {
            showLiquiditySuccessToast({
              action: "added",
              token0Symbol: displayToken0.symbol,
              token1Symbol: displayToken1.symbol,
              txHash: lastTxHash,
              chainId,
            });
          }
          await refreshLiquidityState();
          setToken0Amount("");
          setToken1Amount("");
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/user\s+rejected/i.test(msg) && !/denied/i.test(msg)) {
        if (
          /no viable zap-in route/i.test(msg) ||
          /route unavailable/i.test(msg)
        ) {
          toast.error(
            "No viable zap-in route for this amount. Reduce amount or use balanced mode.",
          );
        } else {
          toast.error("Something went wrong. Please try again.");
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // === Preview calculations ===

  const handleAmountPreset = (pctString: string) => {
    if (!zapTokenBalance) return;
    const pct = Number(pctString);
    if (pct >= 100) {
      setZapAmount(formattedZapBalance);
    } else {
      if (!zapTokenBalance || zapTokenBalance === 0n) return;
      const scaledPct = BigInt(Math.round(pct * 10));
      const fractionalBalance = (zapTokenBalance * scaledPct) / 1000n;
      setZapAmount(formatUnits(fractionalBalance, zapToken.decimals));
    }
  };

  // Summary display values
  const summaryToken0Amount =
    mode === "balanced"
      ? formatSummaryAmount(token0Amount || "0")
      : zapTokenIn === pool.token0.address
        ? formatSummaryAmount(zapAmount || "0")
        : "—";
  const summaryToken1Amount =
    mode === "balanced"
      ? formatSummaryAmount(token1Amount || "0")
      : zapTokenIn === pool.token1.address
        ? formatSummaryAmount(zapAmount || "0")
        : "—";

  return (
    <div className="gap-4 md:grid-cols-[2fr_1fr] grid grid-cols-1">
      {/* Left — Inputs card */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {header}
        <div className="gap-6 p-6 flex flex-col">
          {/* Deposit mode toggle */}
          <div className="gap-1 p-1 grid grid-cols-2 rounded-lg bg-muted/50">
            <button
              onClick={() => setMode("balanced")}
              className={`px-4 py-2.5 text-xs font-semibold cursor-pointer rounded-md transition-colors ${
                mode === "balanced"
                  ? "shadow-sm bg-background text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Balanced (2 tokens)
            </button>
            <button
              onClick={() => setMode("single")}
              className={`px-4 py-2.5 text-xs font-semibold cursor-pointer rounded-md transition-colors ${
                mode === "single"
                  ? "shadow-sm bg-background text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Single token
            </button>
          </div>

          {mode === "balanced" ? (
            <>
              {(isSwapped
                ? [
                    <TokenAmountInput
                      key="t1"
                      token={pool.token1}
                      balance={formattedToken1Balance}
                      amount={token1Amount}
                      onChange={handleToken1Change}
                      onMax={handleMax1}
                      insufficient={insufficientToken1}
                      disabled={disabled}
                    />,
                    <TokenAmountInput
                      key="t0"
                      token={pool.token0}
                      balance={formattedToken0Balance}
                      amount={token0Amount}
                      onChange={handleToken0Change}
                      onMax={handleMax0}
                      insufficient={insufficientToken0}
                      disabled={disabled}
                    />,
                  ]
                : [
                    <TokenAmountInput
                      key="t0"
                      token={pool.token0}
                      balance={formattedToken0Balance}
                      amount={token0Amount}
                      onChange={handleToken0Change}
                      onMax={handleMax0}
                      insufficient={insufficientToken0}
                      disabled={disabled}
                    />,
                    <TokenAmountInput
                      key="t1"
                      token={pool.token1}
                      balance={formattedToken1Balance}
                      amount={token1Amount}
                      onChange={handleToken1Change}
                      onMax={handleMax1}
                      insufficient={insufficientToken1}
                      disabled={disabled}
                    />,
                  ]
              ).map((input) => input)}
            </>
          ) : (
            <>
              {/* Token selector + input */}
              <div className="gap-2 flex flex-col">
                <div className="gap-2 flex items-center justify-between">
                  <span className="font-semibold font-mono tracking-widest text-[11px] text-muted-foreground uppercase">
                    Deposit Token
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    Balance:{" "}
                    <span className="text-muted-foreground/80">
                      {formatCompactBalance(formattedZapBalance)}
                    </span>
                  </span>
                </div>
                <div
                  className={`gap-2 px-4 py-1 flex items-center rounded-xl border bg-muted/30 transition-colors focus-within:border-primary ${insufficientZap ? "border-destructive" : "border-border"}`}
                >
                  <CoinInput
                    value={zapAmount}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setZapAmount(e.target.value)
                    }
                    placeholder="0.00"
                    disabled={disabled}
                    className="h-10 p-0 text-sm font-mono flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
                  />
                  <button
                    className="px-2 py-1 font-bold font-mono tracking-wider cursor-pointer rounded-md bg-primary/10 text-[11px] text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => setZapAmount(formattedZapBalance)}
                    disabled={disabled}
                  >
                    MAX
                  </button>
                  {/* Token selector */}
                  <Select
                    value={zapTokenIn}
                    onValueChange={(v) => {
                      setZapTokenIn(v);
                      setZapAmount("");
                    }}
                  >
                    <SelectTrigger className="gap-1.5 px-3 py-1.5 font-semibold h-auto w-auto rounded-lg border-0 bg-muted/50 shadow-none">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        value={displayToken0.address}
                        className="py-2.5 pl-3 pr-9"
                      >
                        <div className="gap-2.5 flex items-center">
                          <TokenIcon
                            token={{
                              address: displayToken0.address,
                              symbol: displayToken0.symbol,
                            }}
                            size={22}
                            className="rounded-full"
                          />
                          {displayToken0.symbol}
                        </div>
                      </SelectItem>
                      <SelectItem
                        value={displayToken1.address}
                        className="py-2.5 pl-3 pr-9"
                      >
                        <div className="gap-2.5 flex items-center">
                          <TokenIcon
                            token={{
                              address: displayToken1.address,
                              symbol: displayToken1.symbol,
                            }}
                            size={22}
                            className="rounded-full"
                          />
                          {displayToken1.symbol}
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {insufficientZap && (
                  <p className="text-xs text-destructive">
                    Insufficient {zapToken.symbol} balance
                  </p>
                )}
              </div>

              {/* Amount presets */}
              <div className="gap-2 grid grid-cols-4">
                {[
                  { label: "25%", pct: "25" },
                  { label: "50%", pct: "50" },
                  { label: "75%", pct: "75" },
                  { label: "Max", pct: "100" },
                ].map(({ label, pct }) => (
                  <button
                    key={label}
                    onClick={() => handleAmountPreset(pct)}
                    className="py-1.5 text-xs font-medium cursor-pointer rounded-md border border-border bg-background text-center transition-colors hover:bg-muted/50"
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Warning */}
              <div className="gap-2 p-3 border-yellow-500/20 bg-yellow-50/50 text-xs text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400 flex items-start rounded-lg border">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Single-sided deposits use an auto-swap, which incurs the pool
                  fee and some price impact.
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right — Summary & Action */}
      <div className="gap-4 flex flex-col">
        {/* Summary card */}
        <div className="p-6 flex-1 rounded-xl border border-border bg-card">
          <h3 className="text-sm font-semibold mb-5 text-muted-foreground">
            Transaction Summary
          </h3>

          <div className="space-y-3.5">
            {/* Deposit display token 0 */}
            <div className="flex items-center justify-between">
              <div className="gap-2 flex items-center">
                <TokenIcon
                  token={{
                    address: displayToken0.address,
                    symbol: displayToken0.symbol,
                  }}
                  size={20}
                  className="rounded-full"
                />
                <span className="text-sm text-muted-foreground">
                  Deposit {displayToken0.symbol}
                </span>
              </div>
              <span className="text-sm font-semibold font-mono tabular-nums">
                {isSwapped ? summaryToken1Amount : summaryToken0Amount}
              </span>
            </div>

            {/* Deposit display token 1 */}
            <div className="flex items-center justify-between">
              <div className="gap-2 flex items-center">
                <TokenIcon
                  token={{
                    address: displayToken1.address,
                    symbol: displayToken1.symbol,
                  }}
                  size={20}
                  className="rounded-full"
                />
                <span className="text-sm text-muted-foreground">
                  Deposit {displayToken1.symbol}
                </span>
              </div>
              <span className="text-sm font-semibold font-mono tabular-nums">
                {isSwapped ? summaryToken0Amount : summaryToken1Amount}
              </span>
            </div>

            <div className="h-px bg-border" />

            {/* LP fee */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">LP fee</span>
              <span className="text-sm font-medium font-mono text-muted-foreground/80">
                {pool.fees.lp.toFixed(1)}%
              </span>
            </div>

            {/* Slippage tolerance */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Slippage tolerance
              </span>
              <Select
                value={String(slippage)}
                onValueChange={(v) => setSlippage(Number(v) as SlippageOption)}
              >
                <SelectTrigger className="h-7 text-xs font-mono w-[80px] border-border bg-muted/30">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SLIPPAGE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="mt-4 leading-relaxed text-[11px] text-muted-foreground/60">
            Sets the minimum amounts for single-token deposits/withdrawals and
            liquidity mint/burn.
          </p>
        </div>

        {/* CTA */}
        {!address ? (
          <ConnectButton size="lg" text="Connect Wallet" fullWidth />
        ) : (
          <>
            <Button
              size="lg"
              className="w-full"
              disabled={buttonState.disabled}
              onClick={handleAction}
            >
              {buttonState.text}
            </Button>
            {mode === "single" && zapBuildError && (
              <p className="text-xs leading-5 text-center text-muted-foreground">
                {zapBuildError}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
