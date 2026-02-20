import {
  Button,
  TokenIcon,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui";
import type { PoolDisplay, SlippageOption } from "@repo/web3";
import {
  SLIPPAGE_OPTIONS,
  useRemoveLiquidityQuote,
  useRemoveLiquidityTransaction,
  useZapOutQuote,
  useZapOutTransaction,
  useLiquidityApproval,
} from "@repo/web3";
import { useAccount, useReadContract } from "@repo/web3/wagmi";
import { erc20Abi, formatUnits, parseUnits, type Address } from "viem";
import { useState, useEffect, type ChangeEvent } from "react";
import { ExternalLink, ArrowRight } from "lucide-react";

function formatBalance(balance: string): string {
  const num = parseFloat(balance);
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(2) + "K";
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

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
}

export function RemoveLiquidityForm({ pool }: RemoveLiquidityFormProps) {
  const { address } = useAccount();
  const [mode, setMode] = useState<"balanced" | "single">("balanced");
  const [lpAmount, setLpAmount] = useState("");
  const [receiveToken, setReceiveToken] = useState<string>(pool.token0.address);
  const [slippage, setSlippage] = useState<SlippageOption>(0.3);

  const selectedToken =
    receiveToken === pool.token0.address ? pool.token0 : pool.token1;
  const otherToken =
    receiveToken === pool.token0.address ? pool.token1 : pool.token0;

  // Fetch LP token balance (LP token is the pool contract itself)
  const { data: lpBalance } = useReadContract({
    address: pool.poolAddr as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const formattedLpBalance = lpBalance ? formatUnits(lpBalance, 18) : "0";

  const hasAmount = Number(lpAmount) > 0;
  const lpAmountWei = hasAmount ? parseUnits(lpAmount, 18) : 0n;
  const insufficientLp =
    hasAmount && lpBalance !== undefined && lpAmountWei > lpBalance;

  // === Balanced quote hook (also used for underlying breakdown in single mode) ===
  const { data: quote, isFetching: isQuoting } = useRemoveLiquidityQuote({
    pool,
    lpAmount,
  });

  // === Balanced transaction hook ===
  const {
    buildTransaction,
    buildResult,
    isBuilding,
    sendRemoveLiquidity,
    isSending,
    isConfirming,
    isConfirmed,
    reset: resetTx,
  } = useRemoveLiquidityTransaction(pool);

  // === LP token approval hook ===
  const lpApproval = useLiquidityApproval("LP");

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
    isBuilding: isZapOutBuilding,
    sendZapOut,
    isSending: isZapOutSending,
    isConfirming: isZapOutConfirming,
    isConfirmed: isZapOutConfirmed,
    reset: resetZapOutTx,
  } = useZapOutTransaction(pool);

  const zapOutApproval = useLiquidityApproval("LP");

  // Build balanced transaction when we have a valid quote and wallet
  useEffect(() => {
    if (mode !== "balanced") return;
    if (!address || !quote || !hasAmount) return;
    const liquidity = parseUnits(lpAmount, 18);
    buildTransaction(liquidity, address, address, slippage);
  }, [quote, address, slippage, lpAmount, buildTransaction, mode, hasAmount]);

  // Build zap-out transaction when quote arrives
  useEffect(() => {
    if (mode !== "single" || !address || !zapOutQuote || !hasAmount) return;
    const liquidity = parseUnits(lpAmount, 18);
    buildZapOutTransaction(
      receiveToken as Address,
      liquidity,
      address,
      slippage,
    );
  }, [
    zapOutQuote,
    address,
    slippage,
    lpAmount,
    receiveToken,
    mode,
    hasAmount,
    buildZapOutTransaction,
  ]);

  // Reset form on balanced success
  useEffect(() => {
    if (isConfirmed) {
      setLpAmount("");
      resetTx();
      lpApproval.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed]);

  // Reset form on zap-out success
  useEffect(() => {
    if (isZapOutConfirmed) {
      setLpAmount("");
      resetZapOutTx();
      zapOutApproval.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isZapOutConfirmed]);

  // === Button state ===

  const getButtonState = () => {
    if (!address) return { text: "Connect Wallet", disabled: true };
    if (!hasAmount) return { text: "Enter amount", disabled: true };
    if (insufficientLp)
      return { text: "Insufficient LP balance", disabled: true };

    if (mode === "single") {
      if (isZapOutBuilding || isZapOutQuoting)
        return { text: "Preparing...", disabled: true };
      if (!zapOutBuildResult) return { text: "Preparing...", disabled: true };

      if (zapOutBuildResult.approval && !zapOutApproval.isApproved) {
        if (zapOutApproval.isApproving)
          return { text: "Approving LP token...", disabled: true };
        return {
          text: "Approve LP Token",
          disabled: false,
          action: "zap-out-approve" as const,
        };
      }

      if (isZapOutSending || isZapOutConfirming)
        return { text: "Removing liquidity...", disabled: true };

      return {
        text: `Remove as ${selectedToken.symbol}`,
        disabled: false,
        action: "zap-out" as const,
      };
    }

    // Balanced mode
    if (isBuilding || isQuoting)
      return { text: "Preparing...", disabled: true };
    if (!buildResult) return { text: "Preparing...", disabled: true };

    if (buildResult.approval && !lpApproval.isApproved) {
      if (lpApproval.isApproving)
        return { text: "Approving LP token...", disabled: true };
      return {
        text: "Approve LP Token",
        disabled: false,
        action: "approve-lp" as const,
      };
    }

    if (isSending || isConfirming)
      return { text: "Removing liquidity...", disabled: true };

    return {
      text: "Remove Liquidity",
      disabled: false,
      action: "remove" as const,
    };
  };

  const buttonState = getButtonState();

  const handleAction = async () => {
    if (!address) return;

    // Zap-out actions
    if (
      buttonState.action === "zap-out-approve" &&
      zapOutBuildResult?.approval
    ) {
      await zapOutApproval.sendApproval(zapOutBuildResult.approval);
      const liquidity = parseUnits(lpAmount, 18);
      const freshBuild = await buildZapOutTransaction(
        receiveToken as Address,
        liquidity,
        address,
        slippage,
      );
      if (freshBuild) await sendZapOut(freshBuild);
      return;
    }
    if (buttonState.action === "zap-out" && zapOutBuildResult) {
      await sendZapOut(zapOutBuildResult);
      return;
    }

    // Balanced actions
    if (!buildResult) return;

    if (buttonState.action === "approve-lp" && buildResult.approval) {
      await lpApproval.sendApproval(buildResult.approval);
      const liquidity = parseUnits(lpAmount, 18);
      const freshBuild = await buildTransaction(
        liquidity,
        address,
        address,
        slippage,
      );
      if (freshBuild) {
        await sendRemoveLiquidity(freshBuild);
      }
      return;
    }

    if (buttonState.action === "remove") {
      await sendRemoveLiquidity(buildResult);
    }
  };

  // === Preset handlers ===

  const [customPct, setCustomPct] = useState("");

  const handlePreset = (fraction: number) => {
    if (!lpBalance) return;
    if (fraction >= 1) {
      setLpAmount(formatUnits(lpBalance, 18));
    } else {
      const fractionalBalance =
        (lpBalance * BigInt(Math.round(fraction * 1000))) / 1000n;
      setLpAmount(formatUnits(fractionalBalance, 18));
    }
  };

  const handleCustomPctChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (!lpBalance) return;
    let raw = e.target.value.replace(/[^0-9.]/g, "");
    const num = parseFloat(raw);
    if (!isNaN(num) && num > 100) raw = "100";
    setCustomPct(raw);
    const pct = parseFloat(raw);
    if (!isNaN(pct) && pct > 0) {
      if (pct >= 100) {
        setLpAmount(formatUnits(lpBalance, 18));
      } else {
        const fractionalBalance =
          (lpBalance * BigInt(Math.round((pct / 100) * 1000))) / 1000n;
        setLpAmount(formatUnits(fractionalBalance, 18));
      }
    }
  };

  return (
    <div className="min-h-0 flex flex-1 flex-col">
      <div className="gap-6 px-6 pt-6 min-h-0 flex flex-1 flex-col overflow-y-auto">
        {/* Mode toggle */}
        <div className="gap-2 grid grid-cols-2">
          <button
            onClick={() => setMode("balanced")}
            className={`shadow-sm px-4 py-2.5 text-sm font-medium cursor-pointer rounded-md border ${
              mode === "balanced"
                ? "border-border bg-background text-foreground"
                : "border-transparent bg-transparent text-muted-foreground"
            }`}
          >
            Balanced (2 tokens)
          </button>
          <button
            onClick={() => setMode("single")}
            className={`shadow-sm px-4 py-2.5 text-sm font-medium cursor-pointer rounded-md border ${
              mode === "single"
                ? "border-border bg-background text-foreground"
                : "border-transparent bg-transparent text-muted-foreground"
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
              Balance: {formatBalance(formattedLpBalance)}{" "}
              <button
                className="font-medium cursor-pointer text-primary hover:underline"
                onClick={() => handlePreset(1)}
              >
                MAX
              </button>
            </div>
          </div>
          <Input
            type="text"
            inputMode="decimal"
            value={lpAmount}
            onChange={(e) => setLpAmount(e.target.value)}
            placeholder="0"
            className={`h-12 text-base ${insufficientLp ? "border-destructive" : ""}`}
          />
          {insufficientLp && (
            <p className="text-xs text-destructive">
              Insufficient LP token balance
            </p>
          )}
        </div>

        {/* Percentage presets */}
        <div className="gap-2 grid grid-cols-4">
          <button
            onClick={() => handlePreset(0.25)}
            className="py-1.5 text-xs font-medium cursor-pointer rounded-md border border-border bg-background text-center transition-colors hover:bg-muted/50"
          >
            25%
          </button>
          <button
            onClick={() => handlePreset(0.5)}
            className="py-1.5 text-xs font-medium cursor-pointer rounded-md border border-border bg-background text-center transition-colors hover:bg-muted/50"
          >
            50%
          </button>
          <button
            onClick={() => handlePreset(0.75)}
            className="py-1.5 text-xs font-medium cursor-pointer rounded-md border border-border bg-background text-center transition-colors hover:bg-muted/50"
          >
            75%
          </button>
          <div className="py-1.5 flex items-center justify-center overflow-hidden rounded-md border border-border bg-background">
            <input
              type="text"
              inputMode="decimal"
              placeholder="Custom %"
              value={customPct}
              className="min-w-0 text-xs font-medium w-full shrink bg-transparent text-center outline-none placeholder:text-muted-foreground"
              onChange={handleCustomPctChange}
              style={
                customPct
                  ? { width: `${customPct.length}ch`, flexShrink: 0 }
                  : undefined
              }
            />
            {customPct && (
              <span className="text-xs font-medium shrink-0">%</span>
            )}
          </div>
        </div>

        {mode === "balanced" ? (
          <>
            {/* Slippage Tolerance */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Slippage Tolerance %</span>
              <Select
                value={String(slippage)}
                onValueChange={(v) => setSlippage(Number(v) as SlippageOption)}
              >
                <SelectTrigger className="w-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SLIPPAGE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Preview — balanced */}
            {hasAmount && quote && (
              <div className="gap-3 p-3 flex flex-col rounded-md border border-border">
                <h3 className="font-semibold">Preview</h3>
                <div className="gap-2 text-sm flex flex-col">
                  <div className="flex items-center justify-between">
                    <div className="gap-2 flex items-center">
                      <TokenIcon
                        token={{
                          address: pool.token0.address,
                          symbol: pool.token0.symbol,
                        }}
                        size={24}
                        className="rounded-full"
                      />
                      <span>{pool.token0.symbol}</span>
                    </div>
                    <span className="font-medium">
                      {formatTokenAmount(quote?.amount0, pool.token0.decimals)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="gap-2 flex items-center">
                      <TokenIcon
                        token={{
                          address: pool.token1.address,
                          symbol: pool.token1.symbol,
                        }}
                        size={24}
                        className="rounded-full"
                      />
                      <span>{pool.token1.symbol}</span>
                    </div>
                    <span className="font-medium">
                      {formatTokenAmount(quote?.amount1, pool.token1.decimals)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
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
                      : "border-transparent bg-transparent text-muted-foreground"
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
                      : "border-transparent bg-transparent text-muted-foreground"
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

            {/* Slippage Tolerance */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Slippage Tolerance %</span>
              <Select
                value={String(slippage)}
                onValueChange={(v) => setSlippage(Number(v) as SlippageOption)}
              >
                <SelectTrigger className="w-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SLIPPAGE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Preview — single token */}
            {hasAmount && zapOutQuote && (
              <div className="gap-3 p-3 flex flex-col rounded-md border border-border">
                <h3 className="font-semibold">Preview</h3>
                <div className="text-sm flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Estimated {selectedToken.symbol}
                  </span>
                  <span className="font-medium">
                    {formatTokenAmount(
                      zapOutQuote?.expectedTokenOut,
                      selectedToken.decimals,
                    )}
                  </span>
                </div>
                <div className="border-t border-border" />
                <div className="gap-1 text-sm flex flex-col">
                  <span className="text-xs text-muted-foreground">
                    Underlying remove:
                  </span>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {pool.token0.symbol}
                    </span>
                    <span className="font-medium">
                      {formatTokenAmount(quote?.amount0, pool.token0.decimals)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {pool.token1.symbol}
                    </span>
                    <span className="font-medium">
                      {formatTokenAmount(quote?.amount1, pool.token1.decimals)}
                    </span>
                  </div>
                  <div className="gap-1 mt-1 text-xs flex items-center text-muted-foreground">
                    Auto-swap: {otherToken.symbol}
                    <ArrowRight className="h-3 w-3" />
                    {selectedToken.symbol}
                  </div>
                </div>
              </div>
            )}

            {/* Info text */}
            <p className="text-xs text-muted-foreground">
              Liquidity is removed into both pool tokens first, then one side is
              swapped so you receive a single token.
            </p>
          </>
        )}
      </div>

      {/* Bottom section — pinned */}
      <div className="gap-4 px-6 pb-6 pt-4 mt-auto flex shrink-0 flex-col">
        <Button
          size="lg"
          clipped="lg"
          className="w-full"
          disabled={buttonState.disabled}
          onClick={handleAction}
        >
          {buttonState.text}
        </Button>

        {/* Footer links */}
        <div className="gap-4 text-sm flex items-center justify-between">
          <a
            href={`https://explorer.celo.org/mainnet/address/${pool.poolAddr}`}
            target="_blank"
            rel="noopener noreferrer"
            className="gap-1 flex cursor-pointer items-center text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View pool on explorer
          </a>
          <a
            href="https://docs.mento.org/mento/overview/core-concepts/fixed-price-market-makers-fpmms"
            target="_blank"
            rel="noopener noreferrer"
            className="gap-1 flex cursor-pointer items-center text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Read FPMM mechanics
          </a>
        </div>
      </div>
    </div>
  );
}
