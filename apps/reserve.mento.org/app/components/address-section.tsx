import { AddressGroup } from "./address-group";
import type { ReserveAddressesResponse } from "../lib/types";

interface AddressSectionProps {
  groups: ReserveAddressesResponse["addresses"];
  getDebankUrl?: (address: string, network: string) => string;
  handleCopyAddress: (
    address: string,
    category: string,
    network: string,
  ) => Promise<void>;
  copiedAddresses: Set<string>;
}

export function AddressSection({
  groups,
  getDebankUrl,
  handleCopyAddress,
  copiedAddresses,
}: AddressSectionProps) {
  return (
    <>
      <div className="gap-2 md:flex-row flex flex-col">
        {groups.map((group, index) => {
          const titleOverride =
            group.category === "Mento Reserve" ? "Mento Reserve on" : undefined;
          return (
            <AddressGroup
              key={`${group.network}-${group.category}-${index}`}
              group={group}
              index={index}
              titleOverride={titleOverride}
              getDebankUrl={getDebankUrl}
              handleCopyAddress={handleCopyAddress}
              copiedAddresses={copiedAddresses}
            />
          );
        })}
      </div>
    </>
  );
}
