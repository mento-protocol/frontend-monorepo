import { TokenIcon } from "@repo/ui";
import type { PoolDisplay, UserPosition } from "@repo/web3";

interface UserPositionCardProps {
  pool: PoolDisplay;
  position: UserPosition;
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

export function UserPositionCard({ pool, position }: UserPositionCardProps) {
  const token0 = { token: pool.token0, data: position.token0 };
  const token1 = { token: pool.token1, data: position.token1 };

  return (
    <div className="mx-6 mt-3 mb-1.5 rounded-xl border border-border bg-muted/30">
      <div className="px-5 py-4">
        <div className="gap-5 flex items-stretch">
          {/* Left: YOUR POSITION + token columns */}
          <div className="flex flex-1 flex-col">
            <span className="mb-3 text-sm font-semibold text-foreground">
              Your Position
            </span>

            <div className="flex flex-1 items-center justify-evenly">
              {/* Token 0 */}
              <div className="flex flex-col items-center">
                <TokenIcon
                  token={{
                    address: token0.token.address,
                    symbol: token0.token.symbol,
                  }}
                  size={36}
                  className="rounded-full"
                />
                <span className="mt-1.5 text-lg font-bold font-mono tabular-nums">
                  {formatTokenAmount(token0.data.amount)}
                </span>
                <span className="text-xs font-medium text-muted-foreground">
                  {token0.token.symbol}
                </span>
                <span className="mt-1 text-[10px] text-muted-foreground">
                  {token0.data.price !== null && (
                    <>@ {formatPrice(token0.data.price)}</>
                  )}
                  {token0.data.price !== null &&
                    token0.data.usdValue !== null &&
                    " · "}
                  {token0.data.usdValue !== null &&
                    formatUsd(token0.data.usdValue)}
                </span>
              </div>

              {/* Token 1 */}
              <div className="flex flex-col items-center">
                <TokenIcon
                  token={{
                    address: token1.token.address,
                    symbol: token1.token.symbol,
                  }}
                  size={36}
                  className="rounded-full"
                />
                <span className="mt-1.5 text-lg font-bold font-mono tabular-nums">
                  {formatTokenAmount(token1.data.amount)}
                </span>
                <span className="text-xs font-medium text-muted-foreground">
                  {token1.token.symbol}
                </span>
                <span className="mt-1 text-[10px] text-muted-foreground">
                  {token1.data.price !== null && (
                    <>@ {formatPrice(token1.data.price)}</>
                  )}
                  {token1.data.price !== null &&
                    token1.data.usdValue !== null &&
                    " · "}
                  {token1.data.usdValue !== null &&
                    formatUsd(token1.data.usdValue)}
                </span>
              </div>
            </div>
          </div>

          {/* Right: Total position value card */}
          <div className="px-6 py-4 flex flex-col items-center justify-center rounded-lg border border-primary/40 bg-muted/40">
            <span className="text-sm font-semibold text-foreground">
              Total Position Value
            </span>
            <span className="mt-1 text-2xl font-bold font-mono text-foreground tabular-nums">
              {position.totalUsdValue !== null
                ? formatUsd(position.totalUsdValue)
                : "--"}
            </span>
            <div className="mt-2 gap-1 flex flex-col items-center">
              <div className="gap-1.5 flex items-baseline">
                <span className="text-xs text-muted-foreground">
                  Pool Share
                </span>
                <span className="text-sm font-semibold font-mono text-foreground tabular-nums">
                  {formatPercent(position.poolSharePercent)}
                </span>
              </div>
              <div className="h-1 w-24 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${Math.min(100, position.poolSharePercent)}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
