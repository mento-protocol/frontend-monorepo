import { TokenIcon } from "@repo/ui";
import type { PoolDisplay, UserPosition } from "@repo/web3";
import { formatUnits } from "viem";

interface UserPositionCardProps {
  pool: PoolDisplay;
  position: UserPosition;
  lpBalance?: bigint;
}

function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return "<$0.01";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatTokenAmount(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 1 ? 6 : value < 100 ? 4 : 3,
  });
}

function formatPrice(value: number): string {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: number): string {
  return (
    value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + "%"
  );
}

function formatLpBalance(balance: bigint): string {
  const num = Number(formatUnits(balance, 18));
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: num < 1 ? 6 : 0,
  });
}

export function UserPositionCard({
  pool,
  position,
  lpBalance,
}: UserPositionCardProps) {
  const token0 = { token: pool.token0, data: position.token0 };
  const token1 = { token: pool.token1, data: position.token1 };

  return (
    <div className="p-6 rounded-xl border border-border bg-card">
      {/* Header row */}
      <div className="mb-5">
        <div className="gap-2.5 flex items-center">
          <span className="text-sm font-semibold text-muted-foreground">
            Your Position
          </span>
          <span className="h-1.5 w-1.5 bg-green-500 rounded-full shadow-[0_0_6px_rgba(34,197,94,0.5)]" />
        </div>
      </div>

      {/* Three-column layout */}
      <div className="gap-6 grid grid-cols-3">
        {/* Total position value */}
        <div>
          <div className="font-bold tracking-tight text-3xl tabular-nums">
            {position.totalUsdValue !== null
              ? formatUsd(position.totalUsdValue)
              : "--"}
          </div>
          {lpBalance !== undefined && lpBalance > 0n && (
            <div className="mt-1 text-xs font-mono text-muted-foreground/50">
              {formatLpBalance(lpBalance)} LP tokens
            </div>
          )}
          <div className="mt-2">
            <span className="px-2.5 py-1 font-semibold font-mono tracking-wider bg-green-500/10 text-green-600 dark:text-green-400 inline-flex rounded-md text-[11px]">
              {formatPercent(position.poolSharePercent)} POOL SHARE
            </span>
          </div>
        </div>

        {/* Token 0 */}
        <div className="gap-3.5 flex items-start">
          <TokenIcon
            token={{
              address: token0.token.address,
              symbol: token0.token.symbol,
            }}
            size={36}
            className="mt-0.5 shrink-0 rounded-full"
          />
          <div>
            <div className="text-xl font-bold tracking-tight tabular-nums">
              {formatTokenAmount(token0.data.amount)}
            </div>
            <div className="mt-0.5 text-xs font-mono text-muted-foreground">
              {token0.token.symbol}
              {token0.data.price !== null && (
                <span className="text-muted-foreground/60">
                  {" "}
                  @ {formatPrice(token0.data.price)}
                </span>
              )}
            </div>
            {token0.data.usdValue !== null && (
              <div className="text-xs font-mono text-muted-foreground/50">
                {formatUsd(token0.data.usdValue)}
              </div>
            )}
          </div>
        </div>

        {/* Token 1 */}
        <div className="gap-3.5 flex items-start">
          <TokenIcon
            token={{
              address: token1.token.address,
              symbol: token1.token.symbol,
            }}
            size={36}
            className="mt-0.5 shrink-0 rounded-full"
          />
          <div>
            <div className="text-xl font-bold tracking-tight tabular-nums">
              {formatTokenAmount(token1.data.amount)}
            </div>
            <div className="mt-0.5 text-xs font-mono text-muted-foreground">
              {token1.token.symbol}
              {token1.data.price !== null && (
                <span className="text-muted-foreground/60">
                  {" "}
                  @ {formatPrice(token1.data.price)}
                </span>
              )}
            </div>
            {token1.data.usdValue !== null && (
              <div className="text-xs font-mono text-muted-foreground/50">
                {formatUsd(token1.data.usdValue)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
