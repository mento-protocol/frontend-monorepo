import {
  Button,
  TokenIcon,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui";
import type { PoolDisplay, SlippageOption } from "@repo/web3";
import {
  SLIPPAGE_OPTIONS,
  useLiquidityQuote,
  getProportionalAmount,
  useLiquidityApproval,
  useAddLiquidityTransaction,
  useZapInQuote,
  useZapInTransaction,
} from "@repo/web3";
import { useAccount, useReadContract } from "@repo/web3/wagmi";
import { erc20Abi, formatUnits, parseUnits, type Address } from "viem";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  ChevronDown,
  Check,
  Info,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";

function formatBalance(balance: string): string {
  const num = parseFloat(balance);
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(2) + "K";
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatLP(liquidity: bigint | undefined): string {
  if (!liquidity || liquidity === 0n) return "0.00";
  return Number(formatUnits(liquidity, 18)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function calcPoolShare(
  liquidity: bigint | undefined,
  totalSupply: bigint | undefined,
): string {
  if (!liquidity || !totalSupply || totalSupply === 0n) return "0.00";
  return (
    (Number(liquidity) / (Number(totalSupply) + Number(liquidity))) *
    100
  ).toFixed(4);
}

function TokenAmountInput({
  token,
  balance,
  amount,
  onChange,
  onMax,
  insufficient,
}: {
  token: { address: string; symbol: string };
  balance: string;
  amount: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onMax: () => void;
  insufficient: boolean;
}) {
  return (
    <div className="gap-2 flex flex-col">
      <div className="gap-2 flex items-center justify-between">
        <div className="gap-2 flex items-center">
          <TokenIcon
            token={{ address: token.address, symbol: token.symbol }}
            size={24}
            className="rounded-full"
          />
          <span className="font-medium">{token.symbol}</span>
        </div>
        <div className="text-sm text-muted-foreground">
          Balance: {formatBalance(balance)}{" "}
          <button
            className="font-medium cursor-pointer text-primary hover:underline"
            onClick={onMax}
          >
            MAX
          </button>
        </div>
      </div>
      <Input
        type="text"
        inputMode="decimal"
        value={amount}
        onChange={onChange}
        placeholder="0"
        className={`h-12 text-base ${insufficient ? "border-destructive" : ""}`}
      />
      {insufficient && (
        <p className="text-xs text-destructive">
          Insufficient {token.symbol} balance
        </p>
      )}
    </div>
  );
}

function LPPreview({
  estimatedLP,
  sharePercent,
}: {
  estimatedLP: string;
  sharePercent: string;
}) {
  return (
    <div className="gap-3 flex flex-col">
      <h3 className="font-semibold">Preview</h3>
      <div className="gap-2 text-sm flex flex-col">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Estimated LP tokens</span>
          <span className="font-medium">{estimatedLP} LP</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Approx share of pool</span>
          <span className="font-medium">{sharePercent}%</span>
        </div>
      </div>
    </div>
  );
}

interface AddLiquidityFormProps {
  pool: PoolDisplay;
}

export function AddLiquidityForm({ pool }: AddLiquidityFormProps) {
  const { address } = useAccount();
  const [mode, setMode] = useState<"balanced" | "single">("balanced");
  const [token0Amount, setToken0Amount] = useState("");
  const [token1Amount, setToken1Amount] = useState("");
  const [lastEditedToken, setLastEditedToken] = useState<0 | 1>(0);
  const [slippage, setSlippage] = useState<SlippageOption>(0.3);
  const [slippageOpen, setSlippageOpen] = useState(false);

  // Single-token (zap) state
  const [zapTokenIn, setZapTokenIn] = useState<string>(pool.token0.address);
  const [zapAmount, setZapAmount] = useState("");

  // Track whether the auto-fill should be suppressed (during programmatic updates)
  const isAutoFilling = useRef(false);

  // Fetch token balances
  const { data: token0Balance } = useReadContract({
    address: pool.token0.address as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: token1Balance } = useReadContract({
    address: pool.token1.address as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const formattedToken0Balance = token0Balance
    ? formatUnits(token0Balance, pool.token0.decimals)
    : "0";
  const formattedToken1Balance = token1Balance
    ? formatUnits(token1Balance, pool.token1.decimals)
    : "0";

  // === Balanced mode hooks ===

  const { data: quote, isFetching: isQuoting } = useLiquidityQuote({
    pool,
    token0Amount: mode === "balanced" ? token0Amount : "",
    token1Amount: mode === "balanced" ? token1Amount : "",
    lastEditedToken,
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

  const {
    buildTransaction,
    buildResult,
    isBuilding,
    sendAddLiquidity,
    isSending,
    isConfirming,
    isConfirmed,
    reset: resetTx,
  } = useAddLiquidityTransaction(pool);

  const approvalA = useLiquidityApproval(pool.token0.symbol);
  const approvalB = useLiquidityApproval(pool.token1.symbol);

  // Build transaction when we have a valid quote and wallet
  useEffect(() => {
    if (mode !== "balanced") return;
    if (!address || !quote || quote.amountA === 0n || quote.amountB === 0n)
      return;
    buildTransaction(quote.amountA, quote.amountB, address, slippage);
  }, [quote, address, slippage, buildTransaction, mode]);

  // Reset form on success
  useEffect(() => {
    if (isConfirmed) {
      setToken0Amount("");
      setToken1Amount("");
      resetTx();
      approvalA.reset();
      approvalB.reset();
    }
  }, [isConfirmed, resetTx, approvalA, approvalB]);

  // === Single-token (zap) hooks ===

  const zapToken =
    zapTokenIn === pool.token0.address ? pool.token0 : pool.token1;
  const zapTokenBalance =
    zapTokenIn === pool.token0.address ? token0Balance : token1Balance;
  const formattedZapBalance = zapTokenBalance
    ? formatUnits(zapTokenBalance, zapToken.decimals)
    : "0";

  const { data: zapQuote, isFetching: isZapQuoting } = useZapInQuote({
    pool,
    tokenIn: zapTokenIn,
    amountIn: mode === "single" ? zapAmount : "",
    slippage,
  });

  const {
    buildTransaction: buildZapTransaction,
    buildResult: zapBuildResult,
    isBuilding: isZapBuilding,
    sendZapIn,
    isSending: isZapSending,
    isConfirming: isZapConfirming,
    isConfirmed: isZapConfirmed,
    reset: resetZapTx,
  } = useZapInTransaction(pool);

  const zapApproval = useLiquidityApproval(zapToken.symbol);

  // Build zap transaction when quote arrives
  useEffect(() => {
    if (
      mode !== "single" ||
      !address ||
      !zapQuote ||
      !zapAmount ||
      Number(zapAmount) <= 0
    )
      return;
    const amountInWei = parseUnits(zapAmount, zapToken.decimals);
    buildZapTransaction(zapTokenIn as Address, amountInWei, address, slippage);
  }, [
    zapQuote,
    address,
    slippage,
    zapAmount,
    zapTokenIn,
    zapToken.decimals,
    mode,
    buildZapTransaction,
  ]);

  // Reset on zap confirmation
  useEffect(() => {
    if (isZapConfirmed) {
      setZapAmount("");
      resetZapTx();
      zapApproval.reset();
    }
  }, [isZapConfirmed, resetZapTx, zapApproval]);

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
  const hasAmounts = Number(token0Amount) > 0 && Number(token1Amount) > 0;
  const insufficientToken0 =
    hasAmounts &&
    token0Balance !== undefined &&
    Number(token0Amount) > 0 &&
    parseUnits(token0Amount || "0", pool.token0.decimals) > token0Balance;
  const insufficientToken1 =
    hasAmounts &&
    token1Balance !== undefined &&
    Number(token1Amount) > 0 &&
    parseUnits(token1Amount || "0", pool.token1.decimals) > token1Balance;

  // Single-token mode
  const hasZapAmount = Number(zapAmount) > 0;
  const insufficientZap =
    hasZapAmount &&
    zapTokenBalance !== undefined &&
    parseUnits(zapAmount || "0", zapToken.decimals) > zapTokenBalance;

  // === Button state ===

  const getButtonState = () => {
    if (!address) return { text: "Connect Wallet", disabled: true };

    if (mode === "single") {
      if (!hasZapAmount) return { text: "Enter amount", disabled: true };
      if (insufficientZap)
        return {
          text: `Insufficient ${zapToken.symbol} balance`,
          disabled: true,
        };
      if (isZapBuilding || isZapQuoting)
        return { text: "Preparing...", disabled: true };
      if (!zapBuildResult) return { text: "Preparing...", disabled: true };

      if (zapBuildResult.approval && !zapApproval.isApproved) {
        if (zapApproval.isApproving)
          return {
            text: `Approving ${zapToken.symbol}...`,
            disabled: true,
          };
        return {
          text: `Approve ${zapToken.symbol}`,
          disabled: false,
          action: "zap-approve" as const,
        };
      }

      if (isZapSending || isZapConfirming)
        return { text: "Adding liquidity...", disabled: true };

      return {
        text: "Add Liquidity",
        disabled: false,
        action: "zap" as const,
      };
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

    if (buildResult?.approvalA && !approvalA.isApproved) {
      if (approvalA.isApproving)
        return {
          text: `Approving ${pool.token0.symbol}...`,
          disabled: true,
        };
      return {
        text: `Approve ${pool.token0.symbol}`,
        disabled: false,
        action: "approve-a" as const,
      };
    }

    if (buildResult?.approvalB && !approvalB.isApproved) {
      if (approvalB.isApproving)
        return {
          text: `Approving ${pool.token1.symbol}...`,
          disabled: true,
        };
      return {
        text: `Approve ${pool.token1.symbol}`,
        disabled: false,
        action: "approve-b" as const,
      };
    }

    if (isSending || isConfirming)
      return { text: "Adding liquidity...", disabled: true };

    return { text: "Add Liquidity", disabled: false, action: "add" as const };
  };

  const buttonState = getButtonState();

  const handleAction = async () => {
    if (!address) return;

    // Zap actions
    if (buttonState.action === "zap-approve" && zapBuildResult?.approval) {
      await zapApproval.sendApproval(zapBuildResult.approval);
      const amountInWei = parseUnits(zapAmount, zapToken.decimals);
      const freshBuild = await buildZapTransaction(
        zapTokenIn as Address,
        amountInWei,
        address,
        slippage,
      );
      if (freshBuild) await sendZapIn(freshBuild);
      return;
    }
    if (buttonState.action === "zap" && zapBuildResult) {
      await sendZapIn(zapBuildResult);
      return;
    }

    // Balanced actions
    if (!quote) return;
    if (buttonState.action === "approve-a" && buildResult?.approvalA) {
      await approvalA.sendApproval(buildResult.approvalA);
      const freshBuild = await buildTransaction(
        quote.amountA,
        quote.amountB,
        address,
        slippage,
      );
      if (freshBuild && !freshBuild.approvalB) {
        await sendAddLiquidity(freshBuild);
      }
    } else if (buttonState.action === "approve-b" && buildResult?.approvalB) {
      await approvalB.sendApproval(buildResult.approvalB);
      const freshBuild = await buildTransaction(
        quote.amountA,
        quote.amountB,
        address,
        slippage,
      );
      if (freshBuild) await sendAddLiquidity(freshBuild);
    } else if (buttonState.action === "add" && buildResult) {
      await sendAddLiquidity(buildResult);
    }
  };

  // === Preview calculations ===

  const estimatedLP = formatLP(quote?.liquidity);
  const sharePercent = calcPoolShare(quote?.liquidity, quote?.totalSupply);
  const zapEstimatedLP = formatLP(zapQuote?.expectedLiquidity);
  const zapSharePercent = calcPoolShare(
    zapQuote?.expectedLiquidity,
    zapQuote?.totalSupply,
  );

  // Amount presets for single-token mode
  const handleAmountPreset = (preset: "0.1" | "1" | "all") => {
    if (preset === "all") {
      setZapAmount(formattedZapBalance);
    } else {
      const pct = Number(preset) / 100;
      const bal = parseFloat(formattedZapBalance);
      if (bal > 0) {
        setZapAmount((bal * pct).toString());
      }
    }
  };

  return (
    <div className="min-h-0 flex flex-1 flex-col">
      <div className="gap-6 px-6 pt-6 min-h-0 flex flex-1 flex-col overflow-y-auto">
        {/* Deposit mode toggle */}
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

        {mode === "balanced" ? (
          <>
            <TokenAmountInput
              token={pool.token0}
              balance={formattedToken0Balance}
              amount={token0Amount}
              onChange={handleToken0Change}
              onMax={handleMax0}
              insufficient={insufficientToken0}
            />
            <TokenAmountInput
              token={pool.token1}
              balance={formattedToken1Balance}
              amount={token1Amount}
              onChange={handleToken1Change}
              onMax={handleMax1}
              insufficient={insufficientToken1}
            />

            {/* Info text */}
            <p className="text-xs text-muted-foreground">
              Amounts are based on the current pool ratio.
            </p>

            <LPPreview estimatedLP={estimatedLP} sharePercent={sharePercent} />
          </>
        ) : (
          <>
            {/* How it works */}
            <div className="gap-2 p-3 flex flex-col rounded-md border border-border bg-muted/30">
              <div className="gap-1.5 text-sm font-medium flex items-center">
                <Info className="h-4 w-4" />
                How it works
              </div>
              <ul className="gap-1 ml-5 text-xs flex list-disc flex-col text-muted-foreground">
                <li>
                  A portion of your input will be swapped to balance the pool
                </li>
                <li>Both tokens will then be added as liquidity</li>
                <li>Swap uses current pool price and fees</li>
              </ul>
            </div>

            {/* Token selector + input */}
            <div className="gap-2 flex flex-col">
              <div className="gap-2 flex items-center justify-between">
                <div className="gap-2 flex items-center">
                  <TokenIcon
                    token={{
                      address: zapToken.address,
                      symbol: zapToken.symbol,
                    }}
                    size={24}
                    className="rounded-full"
                  />
                  <select
                    value={zapTokenIn}
                    onChange={(e) => {
                      setZapTokenIn(e.target.value);
                      setZapAmount("");
                    }}
                    className="font-medium pr-4 cursor-pointer appearance-none border-none bg-transparent outline-none"
                  >
                    <option value={pool.token0.address}>
                      {pool.token0.symbol}
                    </option>
                    <option value={pool.token1.address}>
                      {pool.token1.symbol}
                    </option>
                  </select>
                  <ChevronDown className="h-3 w-3 -ml-3 pointer-events-none text-muted-foreground" />
                </div>
                <div className="text-sm text-muted-foreground">
                  Balance: {formatBalance(formattedZapBalance)}{" "}
                  <button
                    className="font-medium cursor-pointer text-primary hover:underline"
                    onClick={() => setZapAmount(formattedZapBalance)}
                  >
                    MAX
                  </button>
                </div>
              </div>
              <Input
                type="text"
                inputMode="decimal"
                value={zapAmount}
                onChange={(e) => setZapAmount(e.target.value)}
                placeholder="0"
                className={`h-12 text-base ${insufficientZap ? "border-destructive" : ""}`}
              />
              {insufficientZap && (
                <p className="text-xs text-destructive">
                  Insufficient {zapToken.symbol} balance
                </p>
              )}
            </div>

            {/* Amount presets */}
            <div className="gap-2 flex">
              <button
                onClick={() => handleAmountPreset("0.1")}
                className="px-3 py-1.5 text-xs font-medium cursor-pointer rounded-md border border-border bg-background transition-colors hover:bg-muted/50"
              >
                0.1%
              </button>
              <button
                onClick={() => handleAmountPreset("1")}
                className="px-3 py-1.5 text-xs font-medium cursor-pointer rounded-md border border-border bg-background transition-colors hover:bg-muted/50"
              >
                1%
              </button>
              <button
                disabled
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-background text-muted-foreground"
              >
                Custom
              </button>
              <button
                onClick={() => handleAmountPreset("all")}
                className="px-3 py-1.5 text-xs font-medium cursor-pointer rounded-md border border-border bg-background transition-colors hover:bg-muted/50"
              >
                All
              </button>
            </div>

            {/* Warning */}
            <div className="gap-2 p-3 border-yellow-500/20 bg-yellow-50/50 text-xs text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400 flex items-start rounded-md border">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Single-token liquidity uses an automatic swap and may result in
                slightly higher fees than providing both tokens.
              </span>
            </div>

            <LPPreview
              estimatedLP={zapEstimatedLP}
              sharePercent={zapSharePercent}
            />
          </>
        )}

        {/* Slippage tolerance */}
        <div className="gap-2 flex flex-col">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Slippage tolerance</label>
            <Popover open={slippageOpen} onOpenChange={setSlippageOpen}>
              <PopoverTrigger asChild>
                <button className="gap-2 px-3 py-1.5 text-sm font-medium flex cursor-pointer items-center rounded-md border border-border bg-background transition-colors hover:bg-muted/50">
                  {slippage}%
                  <ChevronDown className="h-3 w-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="p-1 w-auto">
                <div className="flex flex-col">
                  {SLIPPAGE_OPTIONS.map((option) => (
                    <button
                      key={option}
                      onClick={() => {
                        setSlippage(option);
                        setSlippageOpen(false);
                      }}
                      className="gap-2 px-3 py-1.5 text-sm flex cursor-pointer items-center rounded-sm transition-colors hover:bg-muted"
                    >
                      {option === slippage && <Check className="h-3 w-3" />}
                      <span
                        className={option === slippage ? "font-medium" : ""}
                      >
                        {option}%
                      </span>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <p className="text-xs text-muted-foreground">
            Used to set minimum amounts for liquidity mint/burn.
          </p>
        </div>
      </div>

      {/* Bottom section */}
      <div className="gap-4 px-6 pb-6 pt-4 mt-auto flex shrink-0 flex-col">
        <Button
          size="lg"
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
