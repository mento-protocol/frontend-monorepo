"use client";

import { chainLabel } from "@/lib/chains";
import { useV2Query } from "@/lib/use-v2-query";
import { AddressLabel } from "../address-label";
import { TabSkeleton } from "../tab-skeleton";

export function AddressesTab() {
  const { data: addresses } = useV2Query("addresses");

  if (!addresses) return <TabSkeleton />;

  return (
    <div className="gap-4 md:gap-8 flex h-full flex-col">
      <h2 className="text-2xl font-medium md:block hidden">
        Reserve Addresses
      </h2>

      <div className="gap-2 flex flex-col">
        {addresses.networks.map((network) => (
          <div key={network.chain} className="gap-2 md:flex-row flex flex-col">
            {network.categories.map((cat, catIndex) => (
              <div
                key={`${network.chain}-${cat.category}-${catIndex}`}
                className="p-4 md:p-8 flex-1 bg-[#15111b]"
              >
                <h3 className="mb-6 text-xl font-medium leading-tight md:mb-8 md:text-2xl text-[#f7f6fa]">
                  {cat.category} on {chainLabel(network.chain)}
                </h3>
                <div className="gap-6 flex flex-col">
                  {cat.addresses.map((addr, addrIndex) => (
                    <AddressLabel
                      key={`${addr.address}-${addrIndex}`}
                      label={addr.label}
                      address={addr.address}
                      chain={network.chain}
                      description={addr.description}
                      context={`addresses_tab:${cat.category}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
