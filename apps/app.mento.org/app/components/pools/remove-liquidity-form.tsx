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
  type LiquidityFlowStepDefinition,
} from "@repo/web3";
import {
  useAccount,
  useReadContract,
  useConfig,
  useBlockNumber,
} from "@repo/web3/wagmi";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useState, useEffect } from "react";
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

function getErrorMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

function isZapOutRouteUnavailableError(message: string): boolean {
  return /no viable zap-out route|route not found|no route for this amount|route unavailable|insufficient liquidity|insufficientliquidity|insufficient reserves|insufficient output amount|bb55fd27|execution reverted|call execution error/i.test(
    message,
  );
}

interface RemoveLiquidityFormProps {
  pool: PoolDisplay;
  onLiquidityUpdated?: () => void | Promise<void>;
  header?: React.ReactNode;
  disabled?: boolean;
}

export function RemoveLiquidityForm({
  pool,
  onLiquidityUpdated,
  header,
  disabled,
}: RemoveLiquidityFormProps) {
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
    chainId,
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
    chainId,
  });

  // === Balanced transaction hook (build only) ===
  const { buildTransaction, buildResult, isBuilding } =
    useRemoveLiquidityTransaction(pool, chainId);

  // === Zap-out (single-token) hooks ===
  const {
    data: zapOutQuote,
    isFetching: isZapOutQuoting,
    isError: isZapOutQuoteError,
    error: zapOutQuoteError,
  } = useZapOutQuote({
    pool,
    tokenOut: receiveToken,
    lpAmount: mode === "single" ? lpAmount : "",
    slippage,
    chainId,
  });

  const {
    buildTransaction: buildZapOutTransaction,
    buildResult: zapOutBuildResult,
    buildError: zapOutBuildError,
    isBuilding: isZapOutBuilding,
  } = useZapOutTransaction(pool, chainId);

  const zapOutQuoteErrorMessage = getErrorMessage(zapOutQuoteError);
  const zapOutQuoteUiError = isZapOutQuoteError
    ? isZapOutRouteUnavailableError(zapOutQuoteErrorMessage)
      ? "No viable zap-out route for this amount. Reduce amount or use balanced mode."
      : "Unable to quote single-token removal right now."
    : null;
  const zapOutUiError = zapOutBuildError ?? zapOutQuoteUiError;
  const builtZapOutMinTokenOut = (
    zapOutBuildResult?.zapOut as { estimatedMinTokenOut?: bigint } | undefined
  )?.estimatedMinTokenOut;
  const estimatedSingleTokenOut =
    builtZapOutMinTokenOut ?? zapOutQuote?.estimatedMinTokenOut;

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
    if (disabled) return { text: "Wrong network", disabled: true };
    if (isSubmitting) return { text: "Confirm in wallet...", disabled: true };
    if (!hasAmount) return { text: "Enter amount", disabled: true };
    if (insufficientLp)
      return { text: "Insufficient LP balance", disabled: true };

    if (mode === "single") {
      if (currentZapBuildKey === null)
        return { text: "Enter amount", disabled: true };
      if (isZapOutBuilding || isZapOutQuoting)
        return { text: "Preparing...", disabled: true };
      if (zapOutUiError) {
        return {
          text: isZapOutRouteUnavailableError(zapOutUiError)
            ? "Route unavailable"
            : "Quote unavailable",
          disabled: true,
        };
      }
      if (zapBuildStateKey !== currentZapBuildKey)
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

      if (mode === "single") {
        // --- Zap-out flow ---
        const capturedLiquidity = lpAmountWei;
        const capturedReceiveToken = receiveToken;
        const capturedSlippage = slippage;

        if (
          currentZapBuildKey === null ||
          zapBuildReadyKey !== currentZapBuildKey
        ) {
          throw new Error("Preparing transaction. Please try again.");
        }
        if (zapOutUiError) {
          throw new Error(zapOutUiError);
        }

        const preflightBuild = await buildZapOutTransaction(
          capturedReceiveToken as Address,
          capturedLiquidity,
          address,
          capturedSlippage,
        );
        if (!preflightBuild) {
          throw new Error(
            zapOutUiError ||
              "No viable zap-out route for this amount. Reduce amount or use balanced mode.",
          );
        }

        const steps: LiquidityFlowStepDefinition[] = [];

        if (preflightBuild.approval) {
          const approvalParams = preflightBuild.approval.params;
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
          chainId,
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
          chainId,
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
        if (
          /no viable zap-out route|no route for this amount|route unavailable|unable to quote single-token/i.test(
            msg,
          )
        ) {
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

  // Summary values for balanced mode
  const summaryReceive0 =
    hasAmount && quote
      ? formatTokenAmount(quote.amount0, pool.token0.decimals)
      : "0.0000";
  const summaryReceive1 =
    hasAmount && quote
      ? formatTokenAmount(quote.amount1, pool.token1.decimals)
      : "0.0000";

  return (
    <div className="gap-4 md:grid-cols-[2fr_1fr] grid grid-cols-1">
      {/* Left — Inputs card */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {header}
        <div className="gap-6 p-6 flex flex-col">
          {/* Mode toggle */}
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

          {/* LP token input */}
          <div className="gap-2 flex flex-col">
            <div className="gap-2 flex items-center justify-between">
              <span className="font-semibold font-mono tracking-widest text-[11px] text-muted-foreground uppercase">
                LP Tokens to Burn
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                Balance:{" "}
                <span className="text-muted-foreground/80">
                  {formatCompactBalance(formattedLpBalance)}
                </span>
              </span>
            </div>
            <div
              className={`gap-2 px-4 py-1 flex items-center rounded-xl border bg-muted/30 transition-colors focus-within:border-primary ${insufficientLp ? "border-destructive" : "border-border"}`}
            >
              <CoinInput
                value={lpAmount}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setLpAmount(e.target.value)
                }
                placeholder="0.00"
                disabled={disabled}
                className="h-10 p-0 text-sm font-mono flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
              />
              <div className="gap-1.5 px-3 py-1.5 flex items-center rounded-lg bg-muted/50">
                <div className="-space-x-1.5 flex">
                  <TokenIcon
                    token={{
                      address: pool.token0.address,
                      symbol: pool.token0.symbol,
                    }}
                    size={18}
                    className="relative z-10 rounded-full"
                  />
                  <TokenIcon
                    token={{
                      address: pool.token1.address,
                      symbol: pool.token1.symbol,
                    }}
                    size={18}
                    className="rounded-full"
                  />
                </div>
                <span className="text-sm font-semibold text-foreground/70">
                  LP
                </span>
              </div>
            </div>
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
            ].map(({ label, fraction }) => {
              const val =
                lpBalance && fraction < 1
                  ? formatUnits(
                      (lpBalance * BigInt(Math.round(fraction * 1_000_000))) /
                        1_000_000n,
                      18,
                    )
                  : lpBalance
                    ? formatUnits(lpBalance, 18)
                    : "";
              const isActive = lpAmount === val && val !== "";
              return (
                <button
                  key={label}
                  onClick={() => handlePreset(fraction)}
                  disabled={disabled}
                  className={`py-1.5 text-xs font-medium cursor-pointer rounded-md border text-center transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    isActive
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border bg-background hover:bg-muted/50"
                  }`}
                >
                  {label}
                </button>
              );
            })}
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

      {/* Right — Summary & Action */}
      <div className="gap-4 flex flex-col">
        {/* Summary card */}
        <div className="p-6 flex-1 rounded-xl border border-border bg-card">
          <h3 className="text-sm font-semibold mb-5 text-muted-foreground">
            Transaction Summary
          </h3>

          <div className="space-y-3.5">
            {mode === "balanced" ? (
              <>
                {/* Receive token 0 */}
                <div className="flex items-center justify-between">
                  <div className="gap-2 flex items-center">
                    <TokenIcon
                      token={{
                        address: pool.token0.address,
                        symbol: pool.token0.symbol,
                      }}
                      size={20}
                      className="rounded-full"
                    />
                    <span className="text-sm text-muted-foreground">
                      Receive {pool.token0.symbol}
                    </span>
                  </div>
                  <span className="text-sm font-semibold font-mono tabular-nums">
                    {summaryReceive0}
                  </span>
                </div>

                {/* Receive token 1 */}
                <div className="flex items-center justify-between">
                  <div className="gap-2 flex items-center">
                    <TokenIcon
                      token={{
                        address: pool.token1.address,
                        symbol: pool.token1.symbol,
                      }}
                      size={20}
                      className="rounded-full"
                    />
                    <span className="text-sm text-muted-foreground">
                      Receive {pool.token1.symbol}
                    </span>
                  </div>
                  <span className="text-sm font-semibold font-mono tabular-nums">
                    {summaryReceive1}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between">
                <div className="gap-2 flex items-center">
                  <TokenIcon
                    token={{
                      address: selectedToken.address,
                      symbol: selectedToken.symbol,
                    }}
                    size={20}
                    className="rounded-full"
                  />
                  <span className="text-sm text-muted-foreground">
                    Receive {selectedToken.symbol}
                  </span>
                </div>
                <span className="text-sm font-semibold font-mono tabular-nums">
                  {hasAmount && estimatedSingleTokenOut
                    ? formatTokenAmount(
                        estimatedSingleTokenOut,
                        selectedToken.decimals,
                      )
                    : "0.0000"}
                </span>
              </div>
            )}

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
            Sets minimum amounts for zap swaps and liquidity mint/burn.
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
            {mode === "single" && zapOutUiError && (
              <p className="text-xs leading-5 text-center text-muted-foreground">
                {zapOutUiError}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
