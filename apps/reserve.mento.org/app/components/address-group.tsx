import { AddressItem } from "./address-item";

interface AddressGroupProps {
  group: {
    network: string;
    category: string;
    addresses: {
      address: string;
      label: string;
    }[];
  };
  index: number;
  titleOverride?: string;
  getDebankUrl?: (address: string, network: string) => string;
  handleCopyAddress: (
    address: string,
    category: string,
    network: string,
  ) => Promise<void>;
  copiedAddresses: Set<string>;
}

export function AddressGroup({
  group,
  index,
  titleOverride,
  getDebankUrl,
  handleCopyAddress,
  copiedAddresses,
}: AddressGroupProps) {
  return (
    <div
      key={`${group.network}-${group.category}-${index}`}
      className="p-4 md:p-8 flex-1 bg-[#15111b]"
    >
      <h3 className="mb-6 text-xl font-medium leading-tight md:mb-8 md:text-2xl text-[#f7f6fa]">
        {titleOverride || `${group.category} on`}{" "}
        {group.network === "celo" ? "Celo" : "Ethereum"}
      </h3>
      <div className="gap-6 flex flex-col">
        {group.addresses.map((address, addressIndex) => (
          <AddressItem
            key={`${address.address}-${addressIndex}`}
            address={address}
            group={group}
            addressIndex={addressIndex}
            getDebankUrl={getDebankUrl}
            handleCopyAddress={handleCopyAddress}
            copiedAddresses={copiedAddresses}
          />
        ))}
      </div>
    </div>
  );
}
