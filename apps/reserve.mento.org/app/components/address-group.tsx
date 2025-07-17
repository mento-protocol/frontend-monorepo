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
  getBlockExplorerUrl: (address: string, network: string) => string;
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
  getBlockExplorerUrl,
  handleCopyAddress,
  copiedAddresses,
}: AddressGroupProps) {
  return (
    <div
      key={`${group.network}-${group.category}-${index}`}
      className="flex-1 bg-[#15111b] p-4 md:p-8"
    >
      <h3 className="mb-6 text-xl font-medium leading-tight text-[#f7f6fa] md:mb-8 md:text-2xl">
        {titleOverride || `${group.category} on`}{" "}
        {group.network === "celo" ? "Celo" : "Ethereum"}
      </h3>
      <div className="flex flex-col gap-6">
        {group.addresses.map((address, addressIndex) => (
          <AddressItem
            key={`${address.address}-${addressIndex}`}
            address={address}
            group={group}
            addressIndex={addressIndex}
            getBlockExplorerUrl={getBlockExplorerUrl}
            handleCopyAddress={handleCopyAddress}
            copiedAddresses={copiedAddresses}
          />
        ))}
      </div>
    </div>
  );
}
