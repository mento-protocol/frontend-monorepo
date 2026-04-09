"use client";

import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, TokenIcon } from "@repo/ui";
import {
  ConnectButton,
  formatCollateralAmount,
  getDebtTokenConfig,
  type BorrowPosition,
  type DebtTokenConfig,
  useClaimCollateral,
  useCollateralPrice,
  useSurplusCollateral,
  useUserTroves,
} from "@repo/web3";
import { useAccount, useChainId, useConfig } from "@repo/web3/wagmi";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";
import { ArrowUpRight, Clock, Plus, Settings, Wallet } from "lucide-react";
import { getSupportedDebtTokens } from "@/lib/stability-route";
import { TroveList, type TroveListItem } from "./trove-list";

interface TokenTroveState {
  troves: BorrowPosition[];
  isLoading: boolean;
  error: Error | null;
}

interface TokenSurplusState {
  amount: bigint;
  isLoading: boolean;
}

interface TokenPriceState {
  price: bigint | null;
  isLoading: boolean;
  error: Error | null;
}

export function BorrowDashboard() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const wagmiConfig = useConfig();
  const chainId = useChainId();
  const supportedDebtTokens = useMemo(
    () => getSupportedDebtTokens(chainId),
    [chainId],
  );
  const [troveStates, setTroveStates] = useState<
    Record<string, TokenTroveState>
  >({});
  const [surplusStates, setSurplusStates] = useState<
    Record<string, TokenSurplusState>
  >({});
  const [priceStates, setPriceStates] = useState<
    Record<string, TokenPriceState>
  >({});
  const claimCollateral = useClaimCollateral();

  useEffect(() => {
    setTroveStates({});
    setSurplusStates({});
    setPriceStates({});
  }, [chainId]);

  const troves = useMemo<TroveListItem[]>(
    () =>
      supportedDebtTokens
        .flatMap((token) =>
          (troveStates[token.symbol]?.troves ?? []).map((position) => ({
            position,
            debtToken: token,
          })),
        )
        .sort(
          (a, b) =>
            a.debtToken.symbol.localeCompare(b.debtToken.symbol) ||
            a.position.troveId.localeCompare(b.position.troveId),
        ),
    [supportedDebtTokens, troveStates],
  );

  const troveLoading = supportedDebtTokens.some(
    (token) =>
      troveStates[token.symbol] == null || troveStates[token.symbol]!.isLoading,
  );
  const troveError = supportedDebtTokens
    .map((token) => troveStates[token.symbol]?.error)
    .find((error): error is Error => error instanceof Error);

  const surplusTokens = supportedDebtTokens.filter(
    (token) => (surplusStates[token.symbol]?.amount ?? 0n) > 0n,
  );
  const hasSurplus = surplusTokens.length > 0;

  if (!isConnected) {
    return (
      <EmptyState
        isConnected={false}
        debtToken={supportedDebtTokens[0] ?? getDebtTokenConfig("GBPm")}
      />
    );
  }

  if (troveError) {
    return (
      <div className="p-6 bg-card text-center">
        <p className="text-destructive">
          Failed to load positions. Please check your connection and try again.
        </p>
        <p className="mt-2 text-xs break-all text-muted-foreground">
          {troveError.message}
        </p>
      </div>
    );
  }

  if (!troveLoading && troves.length === 0 && !hasSurplus) {
    return (
      <EmptyState
        isConnected
        debtToken={supportedDebtTokens[0] ?? getDebtTokenConfig("GBPm")}
        onOpenTrove={() => router.push("/borrow/open")}
      />
    );
  }

  return (
    <div className="space-y-6">
      {supportedDebtTokens.map((token) => (
        <TokenTrovesObserver
          key={`troves:${token.symbol}`}
          token={token}
          setTroveStates={setTroveStates}
        />
      ))}
      {supportedDebtTokens.map((token) => (
        <TokenSurplusObserver
          key={`surplus:${token.symbol}`}
          token={token}
          setSurplusStates={setSurplusStates}
        />
      ))}
      {supportedDebtTokens.map((token) => (
        <TokenPriceObserver
          key={`price:${token.symbol}`}
          token={token}
          setPriceStates={setPriceStates}
        />
      ))}

      {surplusTokens.map((token) => {
        const amount = surplusStates[token.symbol]?.amount ?? 0n;
        return (
          <div
            key={`banner:${token.symbol}`}
            className="p-4 flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5"
          >
            <div>
              <p className="font-medium">Surplus Collateral Available</p>
              <p className="text-sm text-muted-foreground">
                You have{" "}
                {formatCollateralAmount(amount, token.collateralSymbol)}{" "}
                available to claim from a liquidated {token.symbol} position.
              </p>
            </div>
            <Button
              onClick={() =>
                claimCollateral.mutate({
                  symbol: token.symbol,
                  wagmiConfig,
                  account: address!,
                  successHref: "/borrow",
                })
              }
              disabled={claimCollateral.isPending}
            >
              {claimCollateral.isPending ? "Claiming..." : "Claim Collateral"}
            </Button>
          </div>
        );
      })}

      <PortfolioSummary
        troves={troves}
        priceStates={priceStates}
        isLoading={troveLoading}
      />

      <Button onClick={() => router.push("/borrow/open")} className="gap-2">
        <Plus className="h-4 w-4" />
        Open New Trove
      </Button>

      <div className="flex items-center justify-between">
        <h3 className="font-mono font-semibold tracking-widest text-[11px] text-muted-foreground uppercase">
          Your Troves
        </h3>
        {troves.length > 0 && (
          <span className="font-mono text-xs text-muted-foreground/50">
            {troves.length} position{troves.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <TroveList troves={troves} isLoading={troveLoading} />
    </div>
  );
}

function TokenTrovesObserver({
  token,
  setTroveStates,
}: {
  token: DebtTokenConfig;
  setTroveStates: Dispatch<SetStateAction<Record<string, TokenTroveState>>>;
}) {
  const { data, isLoading, error } = useUserTroves(token.symbol);

  useEffect(() => {
    setTroveStates((prev) => ({
      ...prev,
      [token.symbol]: {
        troves: data ?? [],
        isLoading,
        error: error instanceof Error ? error : null,
      },
    }));
  }, [data, error, isLoading, setTroveStates, token.symbol]);

  return null;
}

function TokenSurplusObserver({
  token,
  setSurplusStates,
}: {
  token: DebtTokenConfig;
  setSurplusStates: Dispatch<SetStateAction<Record<string, TokenSurplusState>>>;
}) {
  const { data, isLoading } = useSurplusCollateral(token.symbol);

  useEffect(() => {
    setSurplusStates((prev) => ({
      ...prev,
      [token.symbol]: {
        amount: data ?? 0n,
        isLoading,
      },
    }));
  }, [data, isLoading, setSurplusStates, token.symbol]);

  return null;
}

function TokenPriceObserver({
  token,
  setPriceStates,
}: {
  token: DebtTokenConfig;
  setPriceStates: Dispatch<SetStateAction<Record<string, TokenPriceState>>>;
}) {
  const { data, isLoading, error } = useCollateralPrice(token.symbol);

  useEffect(() => {
    setPriceStates((prev) => ({
      ...prev,
      [token.symbol]: {
        price: data ?? null,
        isLoading,
        error: error instanceof Error ? error : null,
      },
    }));
  }, [data, error, isLoading, setPriceStates, token.symbol]);

  return null;
}

function getRiskInfo(ltv: number) {
  if (ltv < 40) return { label: "Healthy", color: "#00E599" };
  if (ltv < 60) return { label: "Moderate", color: "#FBBF24" };
  if (ltv < 80) return { label: "At Risk", color: "#F97316" };
  return { label: "Critical", color: "#EF4444" };
}

function formatUSD(value: bigint): string {
  const num = Number(value) / 1e18;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(num);
}

function formatCompact(amount: bigint): string {
  const num = Number(amount) / 1e18;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
  return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function PortfolioSummary({
  troves,
  priceStates,
  isLoading,
}: {
  troves: TroveListItem[];
  priceStates: Record<string, TokenPriceState>;
  isLoading: boolean;
}) {
  const {
    totalCollateral,
    totalDebtUSD,
    avgLTV,
    uniqueMarkets,
    debtSubtitle,
    pricesLoading,
    priceWarning,
  } = useMemo(() => {
    if (troves.length === 0) {
      return {
        totalCollateral: 0n,
        totalDebtUSD: null,
        avgLTV: null,
        uniqueMarkets: 0,
        debtSubtitle: null,
        pricesLoading: false,
        priceWarning: false,
      };
    }

    let totalCollateral = 0n;
    let totalDebtUSD = 0n;
    const debtByToken: Record<string, bigint> = {};
    const activeSymbols = new Set<string>();

    for (const { position, debtToken } of troves) {
      totalCollateral += position.collateral;
      activeSymbols.add(debtToken.symbol);
      debtByToken[debtToken.symbol] =
        (debtByToken[debtToken.symbol] ?? 0n) + position.debt;
    }

    const requiredPrices = Array.from(activeSymbols).map(
      (symbol) => priceStates[symbol],
    );
    const pricesLoading = requiredPrices.some(
      (state) =>
        state == null ||
        state.isLoading ||
        (state.price == null && state.error == null),
    );
    const priceWarning = requiredPrices.some((state) => state?.error != null);

    if (!pricesLoading && !priceWarning) {
      for (const { position, debtToken } of troves) {
        const price = priceStates[debtToken.symbol]?.price;
        if (!price || price <= 0n) {
          continue;
        }
        totalDebtUSD += (position.debt * 10n ** 18n) / price;
      }
    }

    const avgLTV =
      !pricesLoading && !priceWarning && totalCollateral > 0n
        ? Number((totalDebtUSD * 10000n) / totalCollateral) / 100
        : null;

    const breakdown = Object.entries(debtByToken);
    const debtSubtitle =
      breakdown.length === 1
        ? `${formatCompact(breakdown[0]![1])} ${breakdown[0]![0]}`
        : breakdown
            .map(([sym, amt]) => `${formatCompact(amt)} ${sym}`)
            .join(" + ");

    return {
      totalCollateral,
      totalDebtUSD: pricesLoading || priceWarning ? null : totalDebtUSD,
      avgLTV,
      uniqueMarkets: breakdown.length,
      debtSubtitle,
      pricesLoading,
      priceWarning,
    };
  }, [troves, priceStates]);

  const riskInfo = avgLTV != null ? getRiskInfo(avgLTV) : null;
  const summaryLoading = isLoading || pricesLoading;

  return (
    <div className="space-y-2">
      {priceWarning && (
        <div className="border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300 rounded-lg border">
          Portfolio risk metrics are temporarily unavailable because one or more
          market prices failed to load.
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr 1fr",
          gap: 1,
          background: "rgba(255,255,255,0.06)",
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <StatCell
          label="Total Collateral"
          value={summaryLoading ? "..." : formatUSD(totalCollateral)}
        />
        <StatCell
          label="Total Debt"
          value={
            summaryLoading
              ? "..."
              : totalDebtUSD != null
                ? formatUSD(totalDebtUSD)
                : "Unavailable"
          }
          subtitle={
            !summaryLoading && totalDebtUSD != null ? debtSubtitle : null
          }
        />
        <StatCell
          label="Avg LTV"
          value={
            summaryLoading
              ? "..."
              : avgLTV != null
                ? `${avgLTV.toFixed(1)}%`
                : "Unavailable"
          }
          valueColor={riskInfo?.color}
          badge={riskInfo?.label}
          badgeColor={riskInfo?.color}
        />
        <StatCell
          label="Open Troves"
          value={isLoading ? "..." : troves.length.toString()}
          subtitle={
            !isLoading && uniqueMarkets > 0
              ? `across ${uniqueMarkets} market${uniqueMarkets !== 1 ? "s" : ""}`
              : null
          }
        />
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  subtitle,
  valueColor,
  badge,
  badgeColor,
}: {
  label: string;
  value: string;
  subtitle?: string | null;
  valueColor?: string;
  badge?: string;
  badgeColor?: string;
}) {
  return (
    <div style={{ background: "#12131A", padding: "18px 20px" }}>
      <div
        style={{
          fontFamily: "monospace",
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: "0.08em",
          color: "rgba(255,255,255,0.3)",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: valueColor ?? "white",
            lineHeight: 1,
          }}
        >
          {value}
        </span>
        {badge && badgeColor && (
          <span
            style={{
              fontFamily: "monospace",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: badgeColor,
              background: `${badgeColor}1A`,
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            {badge}
          </span>
        )}
      </div>
      {subtitle && (
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 12,
            color: "rgba(255,255,255,0.25)",
            marginTop: 4,
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}

function EmptyState({
  isConnected,
  debtToken,
  onOpenTrove,
}: {
  isConnected: boolean;
  debtToken: DebtTokenConfig;
  onOpenTrove?: () => void;
}) {
  const chainId = useChainId();
  const collateralSymbol = debtToken.collateralSymbol;

  const collateralAddress = (() => {
    try {
      return getTokenAddress(
        chainId,
        collateralSymbol as TokenSymbol,
      ) as `0x${string}`;
    } catch {
      return undefined;
    }
  })();

  const debtTokenAddress = (() => {
    try {
      return getTokenAddress(
        chainId,
        debtToken.symbol as TokenSymbol,
      ) as `0x${string}`;
    } catch {
      return undefined;
    }
  })();

  const stats = [
    { label: "Min. collateral ratio", value: "110%" },
    { label: "Min. debt", value: `1,000 ${debtToken.symbol}` },
    { label: "Interest rates from", value: "0.5%" },
  ];

  const steps = [
    {
      icon: <Wallet className="h-5 w-5" />,
      title: "Deposit collateral",
      desc: `Lock ${collateralSymbol} as collateral to secure your loan. The more you deposit, the more you can borrow.`,
    },
    {
      icon: <Clock className="h-5 w-5" />,
      title: `Borrow ${debtToken.symbol}`,
      desc: `Mint ${debtToken.symbol} stablecoins against your collateral at your chosen interest rate. No fixed repayment schedule.`,
    },
    {
      icon: <Settings className="h-5 w-5" />,
      title: "Manage anytime",
      desc: "Add or remove collateral, repay debt, or adjust your interest rate. Close your position whenever you want.",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h3 className="mb-4 font-mono font-semibold tracking-widest text-[11px] text-muted-foreground uppercase">
          How borrowing works
        </h3>
        <div className="gap-4 md:grid-cols-3 grid grid-cols-1">
          {steps.map((step, i) => (
            <Card
              key={i}
              className="!gap-0 !py-0 transition-colors hover:bg-accent/50"
            >
              <CardContent className="p-6">
                <div className="mb-3.5 gap-3 flex items-center">
                  <div className="h-10 w-10 flex items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {step.icon}
                  </div>
                  <span className="font-mono font-semibold text-[11px] text-muted-foreground/25">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <h4 className="mb-1.5 font-semibold text-[15px]">
                  {step.title}
                </h4>
                <p className="leading-relaxed text-[13px] text-muted-foreground/60">
                  {step.desc}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="gap-4 md:grid-cols-3 grid grid-cols-1">
        {stats.map((stat) => (
          <Card key={stat.label} className="!gap-0 !py-0">
            <CardContent className="!px-4 py-4">
              <span className="font-mono font-medium tracking-widest text-[11px] text-muted-foreground uppercase">
                {stat.label}
              </span>
              <div className="mt-1 text-xl font-semibold tracking-tight">
                {stat.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="px-6 py-4 flex items-center justify-between border-b border-border">
          <div className="gap-3 flex items-center">
            <div className="h-8 w-11 relative">
              {collateralAddress && (
                <TokenIcon
                  token={{
                    address: collateralAddress,
                    symbol: collateralSymbol,
                  }}
                  size={32}
                  className="left-0 top-0 absolute z-10 rounded-full ring-2 ring-card"
                />
              )}
              {debtTokenAddress && (
                <TokenIcon
                  token={{
                    address: debtTokenAddress,
                    symbol: debtToken.symbol,
                  }}
                  size={32}
                  className="top-0 absolute left-[18px] rounded-full ring-2 ring-card"
                />
              )}
            </div>
            <div>
              <div className="font-semibold">
                {collateralSymbol} / {debtToken.symbol}
              </div>
              <div className="text-xs text-muted-foreground">
                Open a borrow position to deposit {collateralSymbol} collateral
                and borrow {debtToken.symbol}.
              </div>
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground/50" />
        </div>

        <div className="p-6">
          {isConnected ? (
            <Button onClick={onOpenTrove} className="gap-2">
              <Plus className="h-4 w-4" />
              Open New Trove
            </Button>
          ) : (
            <ConnectButton />
          )}
        </div>
      </div>
    </div>
  );
}
