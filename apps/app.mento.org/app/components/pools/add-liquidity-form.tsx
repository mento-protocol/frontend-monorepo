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
} from "@repo/web3";
import { useAccount, useReadContract } from "@repo/web3/wagmi";
import { erc20Abi, formatUnits, parseUnits, type Address } from "viem";
import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronDown, Check } from "lucide-react";

interface AddLiquidityFormProps {
  pool: PoolDisplay;
}

export function AddLiquidityForm({ pool }: AddLiquidityFormProps) {
  const { address } = useAccount();
  const [token0Amount, setToken0Amount] = useState("");
  const [token1Amount, setToken1Amount] = useState("");
  const [lastEditedToken, setLastEditedToken] = useState<0 | 1>(0);
  const [slippage, setSlippage] = useState<SlippageOption>(0.3);
  const [slippageOpen, setSlippageOpen] = useState(false);

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

  // Quote hook
  const { data: quote, isFetching: isQuoting } = useLiquidityQuote({
    pool,
    token0Amount,
    token1Amount,
    lastEditedToken,
  });

  // Auto-fill proportional amount when quote returns
  useEffect(() => {
    if (!quote || isAutoFilling.current) return;
    const proportional = getProportionalAmount(quote, lastEditedToken, pool);
    if (!proportional) return;

    isAutoFilling.current = true;
    if (lastEditedToken === 0) {
      setToken1Amount(proportional);
    } else {
      setToken0Amount(proportional);
    }
    // Reset flag after React processes the state update
    requestAnimationFrame(() => {
      isAutoFilling.current = false;
    });
  }, [quote, lastEditedToken, pool]);

  // Transaction hooks
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
    if (!address || !quote || quote.amountA === 0n || quote.amountB === 0n)
      return;
    buildTransaction(quote.amountA, quote.amountB, address, slippage);
  }, [quote, address, slippage, buildTransaction]);

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

  // Input handlers
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

  // Balance validation
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

  // Button state
  const getButtonState = () => {
    if (!address) return { text: "Connect Wallet", disabled: true };
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

    // Approval A needed
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

    // Approval B needed
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
    if (!address || !quote) return;

    if (buttonState.action === "approve-a" && buildResult?.approvalA) {
      await approvalA.sendApproval(buildResult.approvalA);
      // Re-build to check if approval B is needed
      await buildTransaction(quote.amountA, quote.amountB, address, slippage);
    } else if (buttonState.action === "approve-b" && buildResult?.approvalB) {
      await approvalB.sendApproval(buildResult.approvalB);
      // Re-build to get fresh add-liquidity tx
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

  // Preview calculations
  const estimatedLP =
    quote?.liquidity && quote.liquidity > 0n
      ? Number(formatUnits(quote.liquidity, 18)).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 4,
        })
      : "0.00";

  const sharePercent =
    quote?.liquidity && quote.totalSupply && quote.totalSupply > 0n
      ? (
          (Number(quote.liquidity) /
            (Number(quote.totalSupply) + Number(quote.liquidity))) *
          100
        ).toFixed(4)
      : "0.00";

  const formatBalance = (balance: string) => {
    const num = parseFloat(balance);
    if (num >= 1000000) return (num / 1000000).toFixed(2) + "M";
    if (num >= 1000) return (num / 1000).toFixed(2) + "K";
    return num.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  };

  return (
    <div className="p-6 flex flex-1 flex-col">
      <div className="gap-6 flex flex-1 flex-col">
        {/* Deposit mode toggle */}
        <div className="gap-2 grid grid-cols-2">
          <button className="shadow-sm px-4 py-2.5 text-sm font-medium cursor-default rounded-md border border-border bg-background text-foreground">
            Balanced (2 tokens)
          </button>
          <button
            disabled
            className="px-4 py-2.5 text-sm font-medium cursor-not-allowed rounded-md bg-transparent text-muted-foreground/50"
            title="Coming soon"
          >
            Single token (auto-swap)
          </button>
        </div>

        {/* Token 0 input */}
        <div className="gap-2 flex flex-col">
          <div className="gap-2 flex items-center justify-between">
            <div className="gap-2 flex items-center">
              <TokenIcon
                token={{
                  address: pool.token0.address,
                  symbol: pool.token0.symbol,
                }}
                size={24}
                className="rounded-full"
              />
              <span className="font-medium">{pool.token0.symbol}</span>
            </div>
            <div className="text-sm text-muted-foreground">
              Balance: {formatBalance(formattedToken0Balance)}{" "}
              <button
                className="font-medium cursor-pointer text-primary hover:underline"
                onClick={handleMax0}
              >
                MAX
              </button>
            </div>
          </div>
          <Input
            type="text"
            inputMode="decimal"
            value={token0Amount}
            onChange={handleToken0Change}
            placeholder="0"
            className={`h-12 text-base ${insufficientToken0 ? "border-destructive" : ""}`}
          />
          {insufficientToken0 && (
            <p className="text-xs text-destructive">
              Insufficient {pool.token0.symbol} balance
            </p>
          )}
        </div>

        {/* Token 1 input */}
        <div className="gap-2 flex flex-col">
          <div className="gap-2 flex items-center justify-between">
            <div className="gap-2 flex items-center">
              <TokenIcon
                token={{
                  address: pool.token1.address,
                  symbol: pool.token1.symbol,
                }}
                size={24}
                className="rounded-full"
              />
              <span className="font-medium">{pool.token1.symbol}</span>
            </div>
            <div className="text-sm text-muted-foreground">
              Balance: {formatBalance(formattedToken1Balance)}{" "}
              <button
                className="font-medium cursor-pointer text-primary hover:underline"
                onClick={handleMax1}
              >
                MAX
              </button>
            </div>
          </div>
          <Input
            type="text"
            inputMode="decimal"
            value={token1Amount}
            onChange={handleToken1Change}
            placeholder="0"
            className={`h-12 text-base ${insufficientToken1 ? "border-destructive" : ""}`}
          />
          {insufficientToken1 && (
            <p className="text-xs text-destructive">
              Insufficient {pool.token1.symbol} balance
            </p>
          )}
        </div>

        {/* Info text */}
        <p className="text-xs text-muted-foreground">
          Amounts are based on the current pool ratio.
        </p>

        {/* Preview section */}
        <div className="gap-3 flex flex-col">
          <h3 className="font-semibold">Preview</h3>

          <div className="gap-2 text-sm flex flex-col">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Estimated LP tokens</span>
              <span className="font-medium">{estimatedLP} LP</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                Approx share of pool
              </span>
              <span className="font-medium">{sharePercent}%</span>
            </div>
          </div>
        </div>

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
      <div className="gap-4 mt-auto flex flex-col">
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
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
            View pool on explorer
          </a>
          <a
            href="https://docs.mento.org/mento/overview/core-concepts/fixed-price-market-makers-fpmms"
            target="_blank"
            rel="noopener noreferrer"
            className="gap-1 flex cursor-pointer items-center text-muted-foreground transition-colors hover:text-foreground"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
            Read FPMM mechanics
          </a>
        </div>
      </div>
    </div>
  );
}
