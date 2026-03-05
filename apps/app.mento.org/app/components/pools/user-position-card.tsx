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
  return (
    <div className="mx-6 mt-4 mb-2 px-3.5 py-3.5 rounded-xl border border-border bg-muted/30">
      <div className="flex items-start justify-between">
        {/* Left: position label + value */}
        <div className="flex flex-col justify-center">
          <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Your Position
          </span>
          <span className="mt-1.5 text-2xl font-bold font-mono text-foreground tabular-nums">
            {position.totalUsdValue !== null
              ? formatUsd(position.totalUsdValue)
              : "--"}
          </span>
          <div className="mt-1 gap-1.5 flex items-baseline">
            <span className="text-xs text-muted-foreground">Pool share</span>
            <span className="text-sm font-semibold font-mono text-foreground tabular-nums">
              {formatPercent(position.poolSharePercent)}
            </span>
          </div>
        </div>

        {/* Right: token breakdown */}
        <div className="space-y-0">
          {[
            { token: pool.token0, data: position.token0 },
            { token: pool.token1, data: position.token1 },
          ].map(({ token, data }) => (
            <div
              key={token.address}
              className="px-1.5 py-1 text-xs gap-2 flex items-center justify-end rounded-lg transition-colors hover:bg-muted/50"
            >
              <TokenIcon
                token={{ address: token.address, symbol: token.symbol }}
                size={22}
                className="rounded-full"
              />
              <span className="font-medium font-mono tabular-nums">
                {formatTokenAmount(data.amount)}
              </span>
              <span className="font-medium">{token.symbol}</span>
              {data.price !== null && (
                <span className="font-mono text-muted-foreground tabular-nums">
                  @ {formatPrice(data.price)}
                </span>
              )}
              {data.usdValue !== null && (
                <span className="font-mono min-w-13 text-right text-muted-foreground tabular-nums">
                  {formatUsd(data.usdValue)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
