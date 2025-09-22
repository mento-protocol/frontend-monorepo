"use client";
import { Identicon } from "@/components/identicon";
import { CopyToClipboard } from "@repo/ui";
import { useCurrentChain } from "@repo/web3";
import { useMemo } from "react";
import { formatUnits } from "viem";
import { getAddressNameFromCache } from "../services/address-resolver-service";

function getAddressLabel(address: string): string {
  const contractName = getAddressNameFromCache(address);
  return contractName !== "Unknown"
    ? contractName
    : `${address.slice(0, 6)}...${address.slice(-4)}`;
}

type ParticipantListProps = {
  participants: Array<{ address: string; weight: bigint }>;
};

export function ParticipantList({ participants }: ParticipantListProps) {
  const totalWeight = useMemo(() => {
    if (participants.length === 0) return BigInt(0);
    return participants.reduce(
      (sum, participant) => sum + BigInt(participant.weight),
      BigInt(0),
    );
  }, [participants]);

  const formattedWeight = useMemo(() => {
    if (totalWeight === BigInt(0)) return "0";
    const weight = Number(formatUnits(totalWeight, 18));

    let formatted;
    if (weight >= 1_000_000) {
      formatted = `${(weight / 1_000_000).toFixed(2)}M`;
    } else if (weight >= 1_000) {
      formatted = `${(weight / 1_000).toFixed(2)}K`;
    } else {
      formatted = weight.toFixed(2);
    }

    return formatted;
  }, [totalWeight]);

  const currentChain = useCurrentChain();
  const explorerUrl = currentChain.blockExplorers?.default?.url;

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center justify-between py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">{formattedWeight} Votes</span>
        </div>
        <span className="text-muted-foreground text-sm">
          {participants.length} addresses
        </span>
      </div>
      {participants.length > 0 ? (
        [...participants]
          .sort((a, b) => Number(BigInt(b.weight) - BigInt(a.weight)))
          .map((participant) => (
            <div
              key={participant.address}
              className="group flex items-center justify-between border-b border-[var(--border)] py-4 last:border-0"
            >
              <div className="flex items-center gap-2">
                <Identicon address={participant.address} size={16} />
                <div className="h-auto !bg-transparent p-0">
                  <a
                    href={`${explorerUrl}/address/${participant.address}`}
                    className="flex items-center gap-1"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="hover:underline">
                      {getAddressLabel(participant.address)}
                    </span>
                    <CopyToClipboard
                      text={participant.address}
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </a>
                </div>
              </div>
              <span>
                {(() => {
                  const weight = Number(
                    formatUnits(BigInt(participant.weight), 18),
                  );
                  if (weight >= 1_000_000) {
                    return `${(weight / 1_000_000).toFixed(2)}M`;
                  } else if (weight >= 1_000) {
                    return `${(weight / 1_000).toFixed(2)}K`;
                  } else {
                    return weight.toFixed(2);
                  }
                })()}
              </span>
            </div>
          ))
      ) : (
        <p className="py-4 text-center text-sm text-[var(--muted-foreground)]">
          No votes yet
        </p>
      )}
    </div>
  );
}
