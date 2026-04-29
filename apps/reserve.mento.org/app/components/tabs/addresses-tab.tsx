"use client";

import Image from "next/image";
import type { Chain, ReserveAddress } from "@/lib/types";
import { CHAIN_ICON, chainLabel } from "@/lib/chains";
import { CUSTODY_META, CUSTODY_ORDER, type CustodyType } from "@/lib/custody";
import { useV2Query } from "@/lib/use-v2-query";
import { AddressLabel } from "../address-label";
import { TabSkeleton } from "../tab-skeleton";

const OTHER_KEY = "other" as const;
type GroupKey = CustodyType | typeof OTHER_KEY;

const KNOWN_CUSTODY_TYPES: ReadonlySet<CustodyType> = new Set(CUSTODY_ORDER);

function groupKeyFor(addr: ReserveAddress): GroupKey {
  // Route addresses without a custodian_type *or* with an unknown value
  // (e.g. a future "warm" tier the frontend doesn't know about yet) into
  // the OTHER bucket so nothing is silently dropped from the UI.
  if (addr.custodian_type && KNOWN_CUSTODY_TYPES.has(addr.custodian_type)) {
    return addr.custodian_type;
  }
  return OTHER_KEY;
}

export function AddressesTab() {
  const { data: addresses } = useV2Query("addresses");

  if (!addresses) return <TabSkeleton />;

  const byCustody = new Map<GroupKey, ReserveAddress[]>();
  for (const addr of addresses.reserve) {
    const key = groupKeyFor(addr);
    if (!byCustody.has(key)) byCustody.set(key, []);
    byCustody.get(key)!.push(addr);
  }

  const groups: Array<{ key: GroupKey; items: ReserveAddress[] }> = [
    ...CUSTODY_ORDER.map((c) => ({
      key: c as GroupKey,
      items: byCustody.get(c) ?? [],
    })),
    { key: OTHER_KEY, items: byCustody.get(OTHER_KEY) ?? [] },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="gap-8 md:gap-12 flex h-full flex-col">
      <h2 className="text-2xl font-medium md:block hidden">
        Reserve Addresses
      </h2>

      <div className="gap-8 flex flex-col">
        {groups.map((group) => (
          <AddressGroup
            key={group.key}
            groupKey={group.key}
            items={group.items}
          />
        ))}
      </div>
    </div>
  );
}

function AddressGroup({
  groupKey,
  items,
}: {
  groupKey: GroupKey;
  items: ReserveAddress[];
}) {
  const heading =
    groupKey === OTHER_KEY
      ? "Other"
      : `${CUSTODY_META[groupKey].label} Custody`;
  const accent = groupKey === OTHER_KEY ? "" : CUSTODY_META[groupKey].accent;

  return (
    <section className="gap-4 flex flex-col">
      <h3 className="text-lg font-medium">{heading}</h3>
      <div className="md:grid-cols-2 xl:grid-cols-3 gap-2 grid grid-cols-1">
        {items.map((addr) => (
          <AddressCard key={addr.address} address={addr} accent={accent} />
        ))}
      </div>
    </section>
  );
}

function AddressCard({
  address,
  accent,
}: {
  address: ReserveAddress;
  accent: string;
}) {
  return (
    <div className={`p-4 md:p-6 gap-3 flex flex-col bg-[#15111b] ${accent}`}>
      <div className="gap-3 flex items-start justify-between">
        <span className="text-base font-medium leading-tight text-[#f7f6fa]">
          {address.label}
        </span>
        <ChainIconRow chains={address.chains} address={address.address} />
      </div>

      <AddressLabel
        variant="compact"
        address={address.address}
        context="addresses_tab"
      />

      {address.description && (
        <p className="text-sm leading-snug text-muted-foreground">
          {address.description}
        </p>
      )}
    </div>
  );
}

function ChainIconRow({
  chains,
  address,
}: {
  chains: Chain[];
  address: string;
}) {
  return (
    <div className="gap-1.5 flex shrink-0 items-center">
      {chains.map((chain) => (
        <ChainIconLink key={chain} chain={chain} address={address} />
      ))}
    </div>
  );
}

function ChainIconLink({ chain, address }: { chain: string; address: string }) {
  const url =
    chain === "bitcoin"
      ? `https://blockstream.info/address/${address}`
      : `https://debank.com/profile/${address}`;
  const icon = CHAIN_ICON[chain];
  if (!icon) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`View on ${chainLabel(chain)}`}
      className="opacity-70 transition-opacity hover:opacity-100"
    >
      <Image
        src={icon}
        alt={chainLabel(chain)}
        width={18}
        height={18}
        className="h-[18px] w-[18px]"
      />
    </a>
  );
}
