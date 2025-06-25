"use client";

import { TroveCard } from "./trove-card";
import { useV3Troves } from "@/features/v3/hooks/use-v3-troves";
import { USDm, EURm } from "@/lib/config/tokens";
import { useAccount } from "wagmi";

export function YourTroves() {
  const { address } = useAccount();
  const { data: troves, isLoading, error } = useV3Troves();

  if (!address) {
    return (
      <section>
        <h2 className="mb-4 text-2xl font-semibold text-slate-800">
          Your Troves
        </h2>
        <div className="rounded-lg border-2 border-dashed py-12 text-center">
          <p className="text-slate-500">
            Connect your wallet to view your Troves.
          </p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section>
        <h2 className="mb-4 text-2xl font-semibold text-slate-800">
          Your Troves
        </h2>
        <div className="rounded-lg border-2 border-dashed py-12 text-center">
          <p className="text-red-500">
            Error loading troves. V3 might not be deployed on this network.
          </p>
        </div>
      </section>
    );
  }

  const displayTroves =
    troves?.map((trove) => ({
      name: `Trove ${trove.id.substring(0, 8)}...`,
      pair: { collateral: USDm, debt: EURm },
      collateral: `${parseFloat(trove.collateral).toFixed(2)} ${USDm.symbol}`,
      debt: `${parseFloat(trove.debt).toFixed(2)} ${EURm.symbol}`,
      interestRate: `${parseFloat(trove.interestRate).toFixed(2)}%`,
      liquidationPrice: `$${trove.liquidationPrice}`,
      collateralizationRatio: `${trove.collateralizationRatio}%`,
      collateralizationValue: trove.collateralizationValue,
    })) || [];

  return (
    <section>
      <h2 className="mb-4 text-2xl font-semibold text-slate-800">
        Your Troves
      </h2>
      {isLoading ? (
        <div className="rounded-lg border-2 border-dashed py-12 text-center">
          <p className="text-slate-500">Loading your troves...</p>
        </div>
      ) : displayTroves.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2">
          {displayTroves.map((trove) => (
            <TroveCard key={trove.name} trove={trove} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border-2 border-dashed py-12 text-center">
          <p className="text-slate-500">You have no open Troves.</p>
        </div>
      )}
    </section>
  );
}
