import { Button, TokenIcon, Input } from "@repo/ui";
import type { PoolDisplay } from "@repo/web3";
import { useAccount, useReadContract } from "@repo/web3/wagmi";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

interface AddLiquidityFormProps {
  pool: PoolDisplay;
}

export function AddLiquidityForm({ pool }: AddLiquidityFormProps) {
  const { address } = useAccount();
  const [depositMode, setDepositMode] = useState<"balanced" | "single">(
    "balanced",
  );
  const [token0Amount, setToken0Amount] = useState("");
  const [token1Amount, setToken1Amount] = useState("");

  // Fetch token0 balance
  const { data: token0Balance } = useReadContract({
    address: pool.token0.address as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  // Fetch token1 balance
  const { data: token1Balance } = useReadContract({
    address: pool.token1.address as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  // Format balances with proper decimals
  const formattedToken0Balance = token0Balance
    ? formatUnits(token0Balance, pool.token0.decimals)
    : "0";
  const formattedToken1Balance = token1Balance
    ? formatUnits(token1Balance, pool.token1.decimals)
    : "0";

  // Format for display (with K/M suffix if large)
  const formatBalance = (balance: string) => {
    const num = parseFloat(balance);
    if (num >= 1000000) {
      return (num / 1000000).toFixed(2) + "M";
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(2) + "K";
    }
    return num.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  };

  return (
    <div className="p-6 flex flex-1 flex-col">
      {/* Main content section */}
      <div className="gap-6 flex flex-1 flex-col">
        {/* Deposit mode toggle */}
        <div className="gap-2 grid grid-cols-2">
          <button
            onClick={() => setDepositMode("balanced")}
            className={`px-4 py-2.5 text-sm font-medium cursor-pointer rounded-md transition-colors ${
              depositMode === "balanced"
                ? "shadow-sm border border-border bg-background text-foreground"
                : "bg-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Balanced (2 tokens)
          </button>
          <button
            onClick={() => setDepositMode("single")}
            className={`px-4 py-2.5 text-sm font-medium cursor-pointer rounded-md transition-colors ${
              depositMode === "single"
                ? "shadow-sm border border-border bg-background text-foreground"
                : "bg-transparent text-muted-foreground hover:text-foreground"
            }`}
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
                onClick={() => setToken0Amount(formattedToken0Balance)}
              >
                MAX
              </button>
            </div>
          </div>
          <Input
            type="text"
            value={token0Amount}
            onChange={(e) => setToken0Amount(e.target.value)}
            placeholder="0"
            className="h-12 text-base"
          />
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
                onClick={() => setToken1Amount(formattedToken1Balance)}
              >
                MAX
              </button>
            </div>
          </div>
          <Input
            type="text"
            value={token1Amount}
            onChange={(e) => setToken1Amount(e.target.value)}
            placeholder="0"
            className="h-12 text-base"
          />
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
              <span className="font-medium">0.00 LP</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                Approx share of pool
              </span>
              <span className="font-medium">0.00%</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Fees</span>
              <span className="font-medium">
                LP {pool.fees.lp.toFixed(2)}% + Proto{" "}
                {pool.fees.protocol.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>

        {/* Slippage tolerance */}
        <div className="gap-2 flex flex-col">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Slippage tolerance</label>
            <button className="gap-2 px-3 py-1.5 text-sm font-medium flex cursor-pointer items-center rounded-md border border-border bg-background transition-colors hover:bg-muted/50">
              0.3%
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Used to set minimum amounts for zap swaps and liquidity mint/burn.
          </p>
        </div>
      </div>

      {/* Bottom section - fixed at bottom */}
      <div className="gap-4 mt-auto flex flex-col">
        {/* Add liquidity button */}
        <Button size="lg" className="w-full">
          Add liquidity
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
