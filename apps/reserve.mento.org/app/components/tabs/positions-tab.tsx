"use client";

import { useV2Query } from "@/lib/use-v2-query";
import { TabSkeleton } from "../tab-skeleton";
import { CdpTrovesSection } from "./positions/cdp-troves-section";
import {
  buildAddressDescriptionMap,
  buildPriceMap,
  normalizePositions,
} from "./positions/normalize";
import { LiquidityPositionsSection } from "./positions/liquidity-positions-section";
import { OperationalHoldingsSection } from "./positions/operational-holdings-section";
import { ReserveHeldSummary } from "./positions/reserve-held-summary";

export function PositionsTab() {
  const { data: reserve } = useV2Query("reserve");
  const { data: stablecoins } = useV2Query("stablecoins");
  const { data: addresses } = useV2Query("addresses");

  if (!reserve || !stablecoins) return <TabSkeleton />;

  const priceMap = buildPriceMap(reserve, stablecoins);
  const mentoSymbols = new Set(
    stablecoins.stablecoins.map((coin) => coin.symbol),
  );
  const descriptionMap = buildAddressDescriptionMap(addresses);
  const stableHoldings = reserve.positions.wallet_balances.filter(
    (balance) =>
      (balance.is_mento_stable || mentoSymbols.has(balance.token)) &&
      parseFloat(balance.balance) > 0,
  );
  const liquidityPositions = normalizePositions(
    reserve,
    mentoSymbols,
    priceMap,
  ).filter((position) => position.tokens.some((token) => token.amount > 0));
  const bySource = new Map(
    reserve.reserve_held_supply.by_source.map((source) => [
      source.type,
      source.usd_value,
    ]),
  );

  return (
    <div className="gap-12 flex flex-col">
      <ReserveHeldSummary
        total={reserve.reserve_held_supply.total_usd}
        operational={bySource.get("wallet") ?? 0}
        liquidity={
          (bySource.get("aave") ?? 0) +
          (bySource.get("lp") ?? 0) +
          (bySource.get("stability_pool") ?? 0)
        }
        troveOverhead={bySource.get("cdp_overhead") ?? 0}
      />
      {stableHoldings.length > 0 && (
        <OperationalHoldingsSection
          holdings={stableHoldings}
          descriptionMap={descriptionMap}
        />
      )}
      <LiquidityPositionsSection
        positions={liquidityPositions}
        descriptionMap={descriptionMap}
      />
      <CdpTrovesSection troves={reserve.cdp_troves.troves} />
    </div>
  );
}
