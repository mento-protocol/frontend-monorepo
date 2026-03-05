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
  useRemoveLiquidityQuote,
  useRemoveLiquidityTransaction,
  useZapOutQuote,
  useZapOutTransaction,
  ConnectButton,
  tryParseUnits,
  formatCompactBalance,
  executeLiquidityFlow,
  liquidityFlowAtom,
  showLiquiditySuccessToast,
  useExplorerUrl,
  type LiquidityFlowStepDefinition,
} from "@repo/web3";
import {
  useAccount,
  useReadContract,
  useConfig,
  useChainId,
  useBlockNumber,
} from "@repo/web3/wagmi";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useState, useEffect } from "react";
import { ExternalLink } from "lucide-react";
import { useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";

function formatTokenAmount(
  amount: bigint | undefined,
  decimals: number,
): string {
  if (!amount || amount === 0n) return "0.0000";
  return Number(formatUnits(amount, decimals)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

interface RemoveLiquidityFormProps {
  pool: PoolDisplay;
  onLiquidityUpdated?: () => void | Promise<void>;
  header?: React.ReactNode;
}

export function RemoveLiquidityForm({
  pool,
  onLiquidityUpdated,
  header,
}: RemoveLiquidityFormProps) {
  const { address } = useAccount();
  const wagmiConfig = useConfig();
  const chainId = useChainId();
  const { data: blockNumber } = useBlockNumber({
    watch: !!address,
    query: { enabled: !!address },
  });
  const explorerUrl = useExplorerUrl();
  const queryClient = useQueryClient();
  const setFlow = useSetAtom(liquidityFlowAtom);

  const [mode, setMode] = useState<"balanced" | "single">("balanced");
  const [lpAmount, setLpAmount] = useState("");
  const [receiveToken, setReceiveToken] = useState<string>(pool.token0.address);
  const [slippage, setSlippage] = useState<SlippageOption>(0.3);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [zapBuildStateKey, setZapBuildStateKey] = useState<string | null>(null);
  const [zapBuildReadyKey, setZapBuildReadyKey] = useState<string | null>(null);

  const selectedToken =
    receiveToken === pool.token0.address ? pool.token0 : pool.token1;

  // Fetch LP token balance (LP token is the pool contract itself)
  const { data: lpBalance, refetch: refetchLpBalance } = useReadContract({
    address: pool.poolAddr as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      staleTime: 0,
      refetchOnMount: true,
    },
  });

  const formattedLpBalance = lpBalance ? formatUnits(lpBalance, 18) : "0";

  useEffect(() => {
    if (!address || blockNumber === undefined) return;
    void refetchLpBalance();
  }, [address, blockNumber, refetchLpBalance]);

  const lpAmountWei = tryParseUnits(lpAmount, 18);
  const hasAmount = lpAmountWei !== null && lpAmountWei > 0n;
  const currentZapBuildKey =
    mode === "single" && lpAmountWei !== null && lpAmountWei > 0n
      ? `${receiveToken.toLowerCase()}:${lpAmountWei.toString()}:${slippage}`
      : null;
  const insufficientLp =
    lpAmountWei !== null && lpBalance !== undefined && lpAmountWei > lpBalance;

  // === Balanced quote hook ===
  const { data: quote, isFetching: isQuoting } = useRemoveLiquidityQuote({
    pool,
    lpAmount,
  });

  // === Balanced transaction hook (build only) ===
  const { buildTransaction, buildResult, isBuilding } =
    useRemoveLiquidityTransaction(pool);

  // === Zap-out (single-token) hooks ===
  const { data: zapOutQuote, isFetching: isZapOutQuoting } = useZapOutQuote({
    pool,
    tokenOut: receiveToken,
    lpAmount: mode === "single" ? lpAmount : "",
    slippage,
  });

  const {
    buildTransaction: buildZapOutTransaction,
    buildResult: zapOutBuildResult,
    buildError: zapOutBuildError,
    isBuilding: isZapOutBuilding,
  } = useZapOutTransaction(pool);

  // Build balanced transaction when we have a valid quote and wallet
  useEffect(() => {
    if (mode !== "balanced") return;
    if (
      !address ||
      !quote ||
      !hasAmount ||
      lpAmountWei === null ||
      lpAmountWei <= 0n
    )
      return;
    buildTransaction(lpAmountWei, address, address, slippage);
  }, [
    quote,
    address,
    slippage,
    lpAmountWei,
    buildTransaction,
    mode,
    hasAmount,
  ]);

  // Build zap-out transaction when quote arrives and keep track of build freshness.
  useEffect(() => {
    if (
      mode !== "single" ||
      !address ||
      !zapOutQuote ||
      !hasAmount ||
      lpAmountWei === null ||
      lpAmountWei <= 0n ||
      currentZapBuildKey === null
    ) {
      setZapBuildStateKey(null);
      setZapBuildReadyKey(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      const freshBuild = await buildZapOutTransaction(
        receiveToken as Address,
        lpAmountWei,
        address,
        slippage,
      );

      if (cancelled) return;
      setZapBuildStateKey(currentZapBuildKey);
      setZapBuildReadyKey(freshBuild ? currentZapBuildKey : null);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    zapOutQuote,
    address,
    slippage,
    lpAmountWei,
    receiveToken,
    mode,
    hasAmount,
    currentZapBuildKey,
    buildZapOutTransaction,
  ]);

  // === Button state ===

  const getButtonState = () => {
    if (isSubmitting) return { text: "Confirm in wallet...", disabled: true };
    if (!hasAmount) return { text: "Enter amount", disabled: true };
    if (insufficientLp)
      return { text: "Insufficient LP balance", disabled: true };

    if (mode === "single") {
      if (currentZapBuildKey === null)
        return { text: "Enter amount", disabled: true };
      if (zapBuildStateKey !== currentZapBuildKey)
        return { text: "Preparing...", disabled: true };
      if (zapOutBuildError) {
        return { text: "Route unavailable", disabled: true };
      }
      if (isZapOutBuilding || isZapOutQuoting)
        return { text: "Preparing...", disabled: true };
      if (zapBuildReadyKey !== currentZapBuildKey)
        return { text: "Preparing...", disabled: true };
      if (!zapOutBuildResult) return { text: "Preparing...", disabled: true };
      return {
        text: `Remove as ${selectedToken.symbol}`,
        disabled: false,
      };
    }

    // Balanced mode
    if (isBuilding || isQuoting)
      return { text: "Preparing...", disabled: true };
    if (!buildResult) return { text: "Preparing...", disabled: true };

    return { text: "Remove Liquidity", disabled: false };
  };

  const buttonState = getButtonState();

  const refreshLiquidityState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pools-list", chainId] }),
      queryClient.invalidateQueries({ queryKey: ["readContract"] }),
      queryClient.refetchQueries({
        queryKey: ["readContract"],
        type: "active",
      }),
      refetchLpBalance(),
      onLiquidityUpdated?.(),
    ]);
  };

  const handleAction = async () => {
    if (!address) return;
    setIsSubmitting(true);

    try {
      if (lpAmountWei === null || lpAmountWei <= 0n) {
        throw new Error("Enter a valid LP amount");
      }

      const latestBalanceResult = await refetchLpBalance();
      const latestLpBalance = latestBalanceResult.data;
      if (latestLpBalance !== undefined && lpAmountWei > latestLpBalance) {
        setLpAmount(formatUnits(latestLpBalance, 18));
        throw new Error(
          "Amount exceeds your current LP balance. Click MAX to use the latest value.",
        );
      }

      if (mode === "single" && zapOutBuildResult) {
        // --- Zap-out flow ---
        const capturedLiquidity = lpAmountWei;
        const capturedReceiveToken = receiveToken;
        const capturedSlippage = slippage;
        const requiresZapApproval = !!zapOutBuildResult.approval;
        const prebuiltZapOutParams = zapOutBuildResult.zapOut.params;

        if (
          currentZapBuildKey === null ||
          zapBuildReadyKey !== currentZapBuildKey
        ) {
          throw new Error("Preparing transaction. Please try again.");
        }

        const steps: LiquidityFlowStepDefinition[] = [];

        if (zapOutBuildResult.approval) {
          const approvalParams = zapOutBuildResult.approval.params;
          steps.push({
            id: "approve-lp",
            label: "Approve LP Token",
            buildTx: async () => approvalParams,
          });
        }

        steps.push({
          id: "zap-out",
          label: `Remove as ${selectedToken.symbol}`,
          buildTx: async () => {
            if (!requiresZapApproval) {
              return prebuiltZapOutParams;
            }

            const freshBuild = await buildZapOutTransaction(
              capturedReceiveToken as Address,
              capturedLiquidity,
              address,
              capturedSlippage,
            );
            if (!freshBuild) {
              throw new Error(
                zapOutBuildError ||
                  "No viable zap-out route for this amount. Reduce amount or use balanced mode.",
              );
            }
            return freshBuild.zapOut.params;
          },
        });

        const result = await executeLiquidityFlow(
          wagmiConfig,
          setFlow,
          "Remove Liquidity",
          steps,
        );

        if (result.success) {
          const lastTxHash = result.txHashes[result.txHashes.length - 1];
          if (lastTxHash) {
            showLiquiditySuccessToast({
              action: "removed",
              token0Symbol: pool.token0.symbol,
              token1Symbol: pool.token1.symbol,
              txHash: lastTxHash,
              chainId,
            });
          }
          await refreshLiquidityState();
          setLpAmount("");
          setZapBuildStateKey(null);
          setZapBuildReadyKey(null);
        }
      } else if (mode === "balanced" && buildResult) {
        // --- Balanced remove flow ---
        const capturedLiquidity = lpAmountWei;
        const capturedSlippage = slippage;

        const steps: LiquidityFlowStepDefinition[] = [];

        if (buildResult.approval) {
          const approvalParams = buildResult.approval.params;
          steps.push({
            id: "approve-lp",
            label: "Approve LP Token",
            buildTx: async () => approvalParams,
          });
        }

        steps.push({
          id: "remove-liquidity",
          label: "Remove Liquidity",
          buildTx: async () => {
            const freshBuild = await buildTransaction(
              capturedLiquidity,
              address,
              address,
              capturedSlippage,
            );
            if (!freshBuild) throw new Error("Failed to build transaction");
            return freshBuild.removeLiquidity.params;
          },
        });

        const result = await executeLiquidityFlow(
          wagmiConfig,
          setFlow,
          "Remove Liquidity",
          steps,
        );

        if (result.success) {
          const lastTxHash = result.txHashes[result.txHashes.length - 1];
          if (lastTxHash) {
            showLiquiditySuccessToast({
              action: "removed",
              token0Symbol: pool.token0.symbol,
              token1Symbol: pool.token1.symbol,
              txHash: lastTxHash,
              chainId,
            });
          }
          await refreshLiquidityState();
          setLpAmount("");
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/user\s+rejected/i.test(msg) && !/denied/i.test(msg)) {
        if (/no viable zap-out route/i.test(msg)) {
          toast.error(
            "No viable zap-out route for this amount. Reduce amount or use balanced mode.",
          );
        } else {
          toast.error("Something went wrong. Please try again.");
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // === Preset handlers ===

  const handlePreset = (fraction: number) => {
    if (!lpBalance) return;
    if (fraction >= 1) {
      setLpAmount(formatUnits(lpBalance, 18));
    } else {
      const fractionalBalance =
        (lpBalance * BigInt(Math.round(fraction * 1_000_000))) / 1_000_000n;
      setLpAmount(formatUnits(fractionalBalance, 18));
    }
  };

  return (
    <div className="md:flex-row flex flex-col">
      {/* Left Column — Inputs */}
      <div className="min-w-0 md:border-r flex-1 border-border">
        {header}
        <div className="gap-6 p-6 flex flex-col">
          {/* Mode toggle */}
          <div className="gap-2 grid grid-cols-2">
            <button
              onClick={() => setMode("balanced")}
              className={`px-4 py-2.5 text-sm font-medium cursor-pointer rounded-md border ${
                mode === "balanced"
                  ? "border-border bg-background text-foreground"
                  : "border-border bg-transparent text-muted-foreground"
              }`}
            >
              Balanced (2 tokens)
            </button>
            <button
              onClick={() => setMode("single")}
              className={`px-4 py-2.5 text-sm font-medium cursor-pointer rounded-md border ${
                mode === "single"
                  ? "border-border bg-background text-foreground"
                  : "border-border bg-transparent text-muted-foreground"
              }`}
            >
              Single token (auto-swap)
            </button>
          </div>

          {/* LP token input */}
          <div className="gap-2 flex flex-col">
            <div className="gap-2 flex items-center justify-between">
              <div className="gap-2 flex items-center">
                <div className="-space-x-2 flex">
                  <TokenIcon
                    token={{
                      address: pool.token0.address,
                      symbol: pool.token0.symbol,
                    }}
                    size={24}
                    className="relative z-10 rounded-full"
                  />
                  <TokenIcon
                    token={{
                      address: pool.token1.address,
                      symbol: pool.token1.symbol,
                    }}
                    size={24}
                    className="rounded-full"
                  />
                </div>
                <span className="font-medium">LP Tokens</span>
              </div>
              <div className="text-sm text-muted-foreground">
                Balance:{" "}
                <span className="font-medium font-mono text-foreground/80">
                  {formatCompactBalance(formattedLpBalance)}
                </span>{" "}
                <button
                  className="font-medium cursor-pointer text-primary hover:underline"
                  onClick={() => handlePreset(1)}
                >
                  MAX
                </button>
              </div>
            </div>
            <CoinInput
              value={lpAmount}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setLpAmount(e.target.value)
              }
              placeholder="0"
              className={`shadow-xs h-10 px-3 text-sm font-mono placeholder:text-sm border border-input focus-within:border-primary focus:border-primary focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${insufficientLp ? "border-destructive" : ""}`}
            />
            {insufficientLp && (
              <p className="text-xs text-destructive">
                Insufficient LP token balance
              </p>
            )}
          </div>

          {/* Percentage presets */}
          <div className="gap-2 grid grid-cols-4">
            {[
              { label: "25%", fraction: 0.25 },
              { label: "50%", fraction: 0.5 },
              { label: "75%", fraction: 0.75 },
              { label: "Max", fraction: 1 },
            ].map(({ label, fraction }) => (
              <button
                key={label}
                onClick={() => handlePreset(fraction)}
                className="py-1.5 text-xs font-medium cursor-pointer rounded-md border border-border bg-background text-center transition-colors hover:bg-muted/50"
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "single" && (
            <>
              {/* Receive as — single token selector */}
              <div className="gap-2 flex flex-col">
                <label className="text-sm text-muted-foreground">
                  Receive as
                </label>
                <div className="gap-2 grid grid-cols-2">
                  <button
                    onClick={() => setReceiveToken(pool.token0.address)}
                    className={`gap-2 px-4 py-2.5 text-sm font-medium flex cursor-pointer items-center justify-center rounded-md border ${
                      receiveToken === pool.token0.address
                        ? "border-border bg-background text-foreground"
                        : "border-border bg-transparent text-muted-foreground"
                    }`}
                  >
                    <TokenIcon
                      token={{
                        address: pool.token0.address,
                        symbol: pool.token0.symbol,
                      }}
                      size={24}
                      className="rounded-full"
                    />
                    {pool.token0.symbol}
                  </button>
                  <button
                    onClick={() => setReceiveToken(pool.token1.address)}
                    className={`gap-2 px-4 py-2.5 text-sm font-medium flex cursor-pointer items-center justify-center rounded-md border ${
                      receiveToken === pool.token1.address
                        ? "border-border bg-background text-foreground"
                        : "border-border bg-transparent text-muted-foreground"
                    }`}
                  >
                    <TokenIcon
                      token={{
                        address: pool.token1.address,
                        symbol: pool.token1.symbol,
                      }}
                      size={24}
                      className="rounded-full"
                    />
                    {pool.token1.symbol}
                  </button>
                </div>
              </div>

              {/* Info text */}
              <p className="text-xs text-muted-foreground">
                Liquidity is removed into both pool tokens first, then one side
                is swapped so you receive a single token.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Right Column — Summary & Action */}
      <div className="md:w-80 p-6 flex shrink-0 flex-col">
        <h3 className="text-sm font-semibold mb-4 text-foreground">Summary</h3>

        {/* Summary metrics */}
        <div className="space-y-3 flex-1">
          {mode === "balanced" ? (
            <>
              <div className="text-sm flex items-center justify-between">
                <div className="gap-1.5 flex items-center">
                  <TokenIcon
                    token={{
                      address: pool.token0.address,
                      symbol: pool.token0.symbol,
                    }}
                    size={18}
                    className="rounded-full"
                  />
                  <span className="text-muted-foreground">
                    Receive {pool.token0.symbol}
                  </span>
                </div>
                <span className="font-medium font-mono tabular-nums">
                  {hasAmount && quote
                    ? formatTokenAmount(quote.amount0, pool.token0.decimals)
                    : "0.0000"}{" "}
                  {pool.token0.symbol}
                </span>
              </div>
              <div className="text-sm flex items-center justify-between">
                <div className="gap-1.5 flex items-center">
                  <TokenIcon
                    token={{
                      address: pool.token1.address,
                      symbol: pool.token1.symbol,
                    }}
                    size={18}
                    className="rounded-full"
                  />
                  <span className="text-muted-foreground">
                    Receive {pool.token1.symbol}
                  </span>
                </div>
                <span className="font-medium font-mono tabular-nums">
                  {hasAmount && quote
                    ? formatTokenAmount(quote.amount1, pool.token1.decimals)
                    : "0.0000"}{" "}
                  {pool.token1.symbol}
                </span>
              </div>
            </>
          ) : (
            <div className="text-sm flex items-center justify-between">
              <div className="gap-1.5 flex items-center">
                <TokenIcon
                  token={{
                    address: selectedToken.address,
                    symbol: selectedToken.symbol,
                  }}
                  size={18}
                  className="rounded-full"
                />
                <span className="text-muted-foreground">
                  Receive {selectedToken.symbol}
                </span>
              </div>
              <span className="font-medium font-mono tabular-nums">
                {hasAmount && zapOutQuote
                  ? formatTokenAmount(
                      zapOutQuote.estimatedMinTokenOut,
                      selectedToken.decimals,
                    )
                  : "0.0000"}{" "}
                {selectedToken.symbol}
              </span>
            </div>
          )}
          <div className="text-sm flex justify-between">
            <span className="text-muted-foreground">LP fee</span>
            <span className="font-medium font-mono">
              {pool.fees.lp.toFixed(2)}%
            </span>
          </div>
        </div>

        {/* Slippage Tolerance */}
        <div className="pt-4 mt-4 mb-4 border-t border-border">
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs text-muted-foreground">
              Slippage tolerance
            </label>
            <Select
              value={String(slippage)}
              onValueChange={(v) => setSlippage(Number(v) as SlippageOption)}
            >
              <SelectTrigger className="h-7 text-xs w-[90px]">
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
          <p className="text-[11px] text-muted-foreground">
            Used to set minimum amounts for zap swaps and liquidity mint/burn.
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
            {mode === "single" && zapOutBuildError && (
              <p className="text-xs leading-5 mt-2 text-center text-muted-foreground">
                {zapOutBuildError}
              </p>
            )}
          </>
        )}

        {/* Footer links */}
        <div className="mt-3 flex items-center justify-between">
          <a
            href={`${explorerUrl}/address/${pool.poolAddr}`}
            target="_blank"
            rel="noopener noreferrer"
            className="gap-1 flex items-center text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            View on explorer
          </a>
          <a
            href="https://docs.mento.org/mento/overview/core-concepts/fixed-price-market-makers-fpmms"
            target="_blank"
            rel="noopener noreferrer"
            className="gap-1 flex items-center text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            FPMM mechanics
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
