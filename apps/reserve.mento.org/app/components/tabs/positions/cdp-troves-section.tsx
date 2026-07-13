"use client";

import Image from "next/image";
import { chainLabel } from "@/lib/chains";
import { formatNumber, formatUsd, getBlockExplorerUrl } from "@/lib/format";
import { InfoTooltip } from "../../info-tooltip";
import type { ActiveTrove } from "./types";

export function CdpTrovesSection({ troves }: { troves: ActiveTrove[] }) {
  const activeTroves = troves.filter((trove) => trove.status === "active");
  const totalCollateral = activeTroves.reduce(
    (sum, trove) => sum + trove.collateral_usd,
    0,
  );
  const totalDebt = activeTroves.reduce(
    (sum, trove) => sum + trove.debt_usd,
    0,
  );
  const totalOverhead = activeTroves.reduce(
    (sum, trove) => sum + (trove.overhead?.usd ?? 0),
    0,
  );

  return (
    <div>
      <h2 className="mb-2 text-2xl font-medium">CDP Trove Positions</h2>
      <p className="mb-6 max-w-xl text-sm text-muted-foreground">
        Active collateralized debt positions. Collateral deposited in CDPs backs
        the minted stablecoins. The overhead is the excess collateral that is
        left after reserving enough capital to repay the debt plus a wiggle-room
        buffer, and is not counted as a reserve liability.
      </p>

      <div className="overflow-x-auto">
        <table className="text-base w-full min-w-[900px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">Trove</th>
              <th className="px-4 py-3 font-medium">Owner</th>
              <th className="px-4 py-3 font-medium text-right">Collateral</th>
              <th className="px-4 py-3 font-medium text-right">Debt</th>
              <th className="px-4 py-3 font-medium text-right">Ratio</th>
              <th className="px-4 py-3 font-medium text-right">Interest</th>
              <th className="px-4 py-3 font-medium text-right">
                <div className="gap-1 flex items-center justify-end">
                  Overhead
                  <InfoTooltip>
                    The portion of CDP collateral left after reserving enough
                    capital to repay the debt plus a wiggle-room buffer. Counted
                    as reserve-held, not a liability.
                  </InfoTooltip>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {activeTroves.map((trove) => (
              <TroveRow key={trove.trove_id} trove={trove} />
            ))}
            <tr className="border-t-2 border-[var(--border)] bg-card">
              <td colSpan={2} className="px-4 py-3 font-medium">
                {activeTroves.length} active troves
              </td>
              <td className="px-4 py-3 font-medium text-right tabular-nums">
                {formatUsd(totalCollateral)}
              </td>
              <td className="px-4 py-3 font-medium text-right tabular-nums">
                {formatUsd(totalDebt)}
              </td>
              <td className="px-4 py-3" />
              <td className="px-4 py-3" />
              <td className="px-4 py-3 font-medium text-right tabular-nums">
                {formatUsd(totalOverhead)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TroveRow({ trove }: { trove: ActiveTrove }) {
  return (
    <tr className="border-b border-[var(--border)] hover:bg-accent">
      <td className="px-4 py-3">
        <div className="gap-3 flex items-center">
          <Image
            src={`/tokens/${trove.stablecoin}.svg`}
            alt={trove.stablecoin}
            width={28}
            height={28}
            className="h-7 w-7"
            onError={(event) => {
              event.currentTarget.src = "/tokens/CELO.svg";
            }}
          />
          <div className="gap-2 flex items-center">
            <span className="font-medium">{trove.stablecoin}</span>
            <span className="rounded px-1.5 py-0.5 font-medium bg-muted text-[10px] text-muted-foreground">
              {chainLabel(trove.chain)}
            </span>
            <a
              href={getBlockExplorerUrl(trove.chain, trove.contract_address)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#8c35fd] underline transition-colors hover:text-[#a855f7]"
            >
              View
            </a>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {trove.owner_label}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        <div>{formatUsd(trove.collateral_usd)}</div>
        <div className="text-xs text-muted-foreground">
          {formatNumber(trove.collateral_amount, 2)} {trove.collateral_token}
        </div>
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        <div>{formatUsd(trove.debt_usd)}</div>
        <div className="text-xs text-muted-foreground">
          {formatNumber(trove.debt_amount, 2)} {trove.stablecoin}
        </div>
      </td>
      <td className="px-4 py-3 text-green-400 text-right tabular-nums">
        {trove.ratio.toFixed(2)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {(trove.annual_interest_rate * 100).toFixed(1)}%
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {trove.overhead ? (
          <div className="gap-1 inline-flex items-center">
            {formatUsd(trove.overhead.usd)}
            <InfoTooltip>
              max(0, {formatUsd(trove.collateral_usd)} − (
              {formatUsd(trove.debt_usd)}× (1 + {trove.overhead.wiggleroom_pct}
              %))) = {formatUsd(trove.overhead.usd)}
            </InfoTooltip>
          </div>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}
