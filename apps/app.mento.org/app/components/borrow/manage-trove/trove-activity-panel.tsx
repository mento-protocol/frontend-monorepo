"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Card, CardContent, Skeleton } from "@repo/ui";
import {
  formatCollateralAmount,
  formatDebtAmount,
  formatInterestRate,
  shortenAddress,
  useExplorerUrl,
  useTroveOperations,
  type DebtTokenConfig,
  type TroveOperation,
} from "@repo/web3";
import {
  AlertOctagon,
  ArrowDownToLine,
  Clock,
  ExternalLink,
  Filter,
  MinusCircle,
  Percent,
  PlusCircle,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Event taxonomy — visual layer; maps subgraph rows to row presentation.
// Lifted verbatim from `mento-trove-history-wireframe.jsx`'s EVENT_KIND but
// re-expressed as Tailwind class tokens so it picks up the app theme.
// ---------------------------------------------------------------------------

type EventKindId =
  | "redemption"
  | "liquidation"
  | "liquidation_part"
  | "coll_add"
  | "coll_remove"
  | "debt_borrow"
  | "debt_repay"
  | "rate_change"
  | "interest_applied";

type FilterId =
  | "all"
  | "redemption"
  | "liquidation"
  | "coll"
  | "debt"
  | "rate"
  | "interest";

interface EventKindConfig {
  label: string;
  Icon: typeof ArrowDownToLine;
  iconClass: string;
  iconBgClass: string;
  group: FilterId;
}

const EVENT_KIND: Record<EventKindId, EventKindConfig> = {
  redemption: {
    label: "Redeemed against",
    Icon: ArrowDownToLine,
    iconClass: "text-amber-400",
    iconBgClass: "bg-amber-400/15",
    group: "redemption",
  },
  liquidation: {
    label: "Liquidated",
    Icon: AlertOctagon,
    iconClass: "text-red-500",
    iconBgClass: "bg-red-500/15",
    group: "liquidation",
  },
  liquidation_part: {
    label: "Partially liquidated",
    Icon: AlertOctagon,
    iconClass: "text-red-500",
    iconBgClass: "bg-red-500/15",
    group: "liquidation",
  },
  coll_add: {
    label: "Collateral added",
    Icon: PlusCircle,
    iconClass: "text-green-500",
    iconBgClass: "bg-green-500/15",
    group: "coll",
  },
  coll_remove: {
    label: "Collateral removed",
    Icon: MinusCircle,
    iconClass: "text-green-500",
    iconBgClass: "bg-green-500/15",
    group: "coll",
  },
  debt_borrow: {
    label: "Borrowed more",
    Icon: TrendingUp,
    iconClass: "text-primary",
    iconBgClass: "bg-primary/15",
    group: "debt",
  },
  debt_repay: {
    label: "Repaid debt",
    Icon: TrendingDown,
    iconClass: "text-primary",
    iconBgClass: "bg-primary/15",
    group: "debt",
  },
  rate_change: {
    label: "Interest rate changed",
    Icon: Percent,
    iconClass: "text-blue-400",
    iconBgClass: "bg-blue-400/15",
    group: "rate",
  },
  interest_applied: {
    label: "Interest applied",
    Icon: Clock,
    iconClass: "text-muted-foreground",
    iconBgClass: "bg-muted/40",
    group: "interest",
  },
};

const FILTERS: ReadonlyArray<{ id: FilterId; label: string }> = [
  { id: "all", label: "All" },
  { id: "redemption", label: "Redemptions" },
  { id: "liquidation", label: "Liquidations" },
  { id: "coll", label: "Collateral" },
  { id: "debt", label: "Debt" },
  { id: "rate", label: "Rate" },
  { id: "interest", label: "Interest" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Map a subgraph TroveOperation row to the visual kind. adjustTrove can carry
// both coll and debt deltas; prefer the coll classification because that's the
// LTV-impacting change users notice first. Both deltas are still shown in the
// row's Coll Δ / Debt Δ columns regardless of kind.
function eventKindForRow(op: TroveOperation): EventKindId {
  switch (op.operation) {
    case "redeemCollateral":
      return "redemption";
    case "liquidate":
      return op.newDebt === 0n ? "liquidation" : "liquidation_part";
    case "adjustTroveInterestRate":
      return "rate_change";
    case "applyPendingDebt":
      return "interest_applied";
    case "adjustTrove":
      if (op.collateralDelta !== 0n) {
        return op.collateralDelta > 0n ? "coll_add" : "coll_remove";
      }
      return op.debtDelta > 0n ? "debt_borrow" : "debt_repay";
    default:
      // Hidden kinds (openTrove/closeTrove/batch joins) are filtered out at
      // the query layer; this branch is unreachable in practice.
      return "coll_add";
  }
}

function formatRelativeTime(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return "Just now";
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `${m}m ago`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `${h}h ago`;
  }
  if (diff < 86400 * 2) return "Yesterday";
  if (diff < 86400 * 30) {
    const d = Math.floor(diff / 86400);
    return `${d}d ago`;
  }
  if (diff < 86400 * 365) {
    const mo = Math.floor(diff / (86400 * 30));
    return `${mo}mo ago`;
  }
  const y = Math.floor(diff / (86400 * 365));
  return `${y}y ago`;
}

function shortenHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

function AddressLink({
  address,
  explorerUrl,
}: {
  address: string;
  explorerUrl: string;
}) {
  return (
    <a
      href={`${explorerUrl}/address/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-foreground underline underline-offset-2 hover:text-primary"
    >
      {shortenAddress(address, false)}
    </a>
  );
}

function formatCollDelta(delta: bigint, symbol: string): string {
  if (delta === 0n) return "—";
  const abs = delta < 0n ? -delta : delta;
  const prefix = delta > 0n ? "+" : "−";
  return `${prefix}${formatCollateralAmount(abs, symbol)}`;
}

function formatDebtDelta(delta: bigint, debtToken: DebtTokenConfig): string {
  if (delta === 0n) return "—";
  const abs = delta < 0n ? -delta : delta;
  const prefix = delta > 0n ? "+" : "−";
  return `${prefix}${formatDebtAmount(abs, debtToken)}`;
}

// Pretty-prints an 18-decimal price as a fixed-precision number (e.g. 0.7409).
function formatPriceDecimal(price: bigint, fractionDigits = 4): string {
  const divisor = 10n ** 18n;
  const whole = price / divisor;
  const fraction = price % divisor;
  const num = Number(whole) + Number(fraction) / Number(divisor);
  return num.toFixed(fractionDigits);
}

// ---------------------------------------------------------------------------
// EventRow
// ---------------------------------------------------------------------------

interface EventRowProps {
  op: TroveOperation;
  debtToken: DebtTokenConfig;
  collateralSymbol: string;
  explorerUrl: string;
}

function EventRow({
  op,
  debtToken,
  collateralSymbol,
  explorerUrl,
}: EventRowProps) {
  const kind = eventKindForRow(op);
  const cfg = EVENT_KIND[kind];
  const Icon = cfg.Icon;

  const collColor =
    op.collateralDelta > 0n
      ? "text-green-500"
      : op.collateralDelta < 0n
        ? "text-amber-400"
        : "text-muted-foreground";
  const debtColor =
    op.debtDelta > 0n
      ? "text-foreground"
      : op.debtDelta < 0n
        ? "text-green-500"
        : "text-muted-foreground";

  const desc = describeRow(op, kind, debtToken, collateralSymbol, explorerUrl);
  const extra = extraForRow(op, kind, debtToken);

  return (
    <div
      className="gap-3 py-3 grid items-center border-b border-border/60 last:border-b-0"
      style={{
        gridTemplateColumns:
          "36px minmax(0, 1.8fr) minmax(0, 1.1fr) minmax(0, 1.1fr) minmax(0, 0.9fr) 110px",
      }}
    >
      <div
        className={`h-9 w-9 ${cfg.iconBgClass} flex items-center justify-center rounded-full`}
      >
        <Icon size={16} className={cfg.iconClass} />
      </div>

      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{cfg.label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{desc}</div>
        {extra && (
          <div className="mt-0.5 text-xs text-muted-foreground">{extra}</div>
        )}
      </div>

      <div className="text-right tabular-nums">
        <div className="font-mono font-medium tracking-wider text-[10px] text-muted-foreground uppercase">
          Coll Δ
        </div>
        <div className={`text-sm font-medium ${collColor}`}>
          {formatCollDelta(op.collateralDelta, collateralSymbol)}
        </div>
      </div>

      <div className="text-right tabular-nums">
        <div className="font-mono font-medium tracking-wider text-[10px] text-muted-foreground uppercase">
          Debt Δ
        </div>
        <div className={`text-sm font-medium ${debtColor}`}>
          {formatDebtDelta(op.debtDelta, debtToken)}
        </div>
      </div>

      <div className="text-right whitespace-nowrap">
        <div className="text-xs text-muted-foreground">
          {formatRelativeTime(op.timestamp)}
        </div>
        <div className="font-mono text-xs text-muted-foreground">
          #{op.blockNumber.toString()}
        </div>
      </div>

      <a
        href={`${explorerUrl}/tx/${op.transactionHash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="gap-1.5 text-xs flex items-center justify-end whitespace-nowrap text-muted-foreground hover:text-foreground"
      >
        <span className="font-mono">{shortenHash(op.transactionHash)}</span>
        <ExternalLink size={12} />
      </a>
    </div>
  );
}

function describeRow(
  op: TroveOperation,
  kind: EventKindId,
  debtToken: DebtTokenConfig,
  collateralSymbol: string,
  explorerUrl: string,
): ReactNode {
  switch (kind) {
    case "redemption":
      return (
        <>
          Redeemed by{" "}
          <AddressLink address={op.initiator} explorerUrl={explorerUrl} />
        </>
      );
    case "liquidation":
    case "liquidation_part":
      return (
        <>
          Liquidated by{" "}
          <AddressLink address={op.initiator} explorerUrl={explorerUrl} />
        </>
      );
    case "coll_add":
      return `Added ${collateralSymbol} collateral`;
    case "coll_remove":
      return `Withdrew ${collateralSymbol}`;
    case "debt_borrow":
      return `Borrowed more ${debtToken.symbol}`;
    case "debt_repay":
      return `Repaid ${debtToken.symbol}`;
    case "rate_change":
      return `New rate: ${formatInterestRate(op.newInterestRate)}`;
    case "interest_applied":
      return "Permissionless interest accrual";
  }
}

function extraForRow(
  op: TroveOperation,
  kind: EventKindId,
  debtToken: DebtTokenConfig,
): string | null {
  switch (kind) {
    case "redemption":
      if (op.redemptionPrice == null) return null;
      return `Redemption price: ${formatPriceDecimal(op.redemptionPrice)} ${debtToken.symbol}/USDm`;
    case "liquidation":
    case "liquidation_part":
      if (op.liquidationPrice == null) return null;
      return `Liquidation price: ${formatPriceDecimal(op.liquidationPrice)} ${debtToken.symbol}/USDm`;
    case "debt_borrow":
      if (op.upfrontFee === 0n) return null;
      return `Upfront fee: ${formatDebtAmount(op.upfrontFee, debtToken)}`;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// TroveActivityPanel
// ---------------------------------------------------------------------------

interface TroveActivityPanelProps {
  troveId: string;
  debtToken: DebtTokenConfig;
  collateralSymbol: string;
}

export function TroveActivityPanel({
  troveId,
  debtToken,
  collateralSymbol,
}: TroveActivityPanelProps) {
  const [filter, setFilter] = useState<FilterId>("all");
  const explorerUrl = useExplorerUrl();
  const query = useTroveOperations(troveId, debtToken.symbol);

  const operations = useMemo(
    () => query.data?.pages.flat() ?? [],
    [query.data],
  );
  const filtered = useMemo(
    () =>
      filter === "all"
        ? operations
        : operations.filter(
            (op) => EVENT_KIND[eventKindForRow(op)].group === filter,
          ),
    [operations, filter],
  );

  return (
    <Card className="!gap-0 !py-0">
      <CardContent className="!px-6 py-5">
        <div className="gap-3 pb-4 flex flex-wrap items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              Trove Activity
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Every on-chain event that has touched this trove.
            </p>
          </div>
        </div>

        <div className="gap-3 pb-3 flex flex-wrap items-center justify-between">
          <div className="gap-2 flex items-center">
            <Filter size={14} className="text-muted-foreground" />
            <div
              className="gap-1.5 flex flex-wrap"
              role="group"
              aria-label="Filter trove activity by type"
            >
              {FILTERS.map((f) => {
                const active = f.id === filter;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFilter(f.id)}
                    aria-pressed={active}
                    aria-label={`${f.label} filter`}
                    className={`px-3 py-1 text-xs font-medium cursor-pointer border transition-colors ${
                      active
                        ? "border-primary/35 bg-primary/15 text-foreground"
                        : "border-border bg-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>
          {!query.isLoading && !query.isUnsupportedChain && !query.isError && (
            <div className="text-xs text-muted-foreground">
              {filtered.length} event{filtered.length === 1 ? "" : "s"}
            </div>
          )}
        </div>

        {query.isUnsupportedChain ? (
          <div className="py-12 text-sm text-center text-muted-foreground">
            Trove history isn’t indexed on this network yet.
          </div>
        ) : query.isLoading ? (
          <div className="space-y-3 pt-1">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : query.isError ? (
          <div className="py-12 text-sm text-center text-destructive">
            Could not load trove history. Please retry in a moment.
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-sm text-center text-muted-foreground">
            {operations.length === 0
              ? "No on-chain activity yet for this trove."
              : "No matching events for the selected filter."}
          </div>
        ) : (
          <div>
            {filtered.map((op) => (
              <EventRow
                key={op.id}
                op={op}
                debtToken={debtToken}
                collateralSymbol={collateralSymbol}
                explorerUrl={explorerUrl}
              />
            ))}
          </div>
        )}

        {query.hasNextPage && (
          <div className="pt-5 text-center">
            <button
              type="button"
              onClick={() => query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
              className="px-4 py-2 text-xs font-medium cursor-pointer rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {query.isFetchingNextPage ? "Loading…" : "Load earlier events"}
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
