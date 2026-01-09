import { Check, ClipboardCopy } from "lucide-react";

interface AddressItemProps {
  address: {
    address: string;
    label: string;
  };
  group: {
    network: string;
    category: string;
  };
  addressIndex: number;
  getDebankUrl?: (address: string, network: string) => string;
  handleCopyAddress: (
    address: string,
    category: string,
    network: string,
  ) => Promise<void>;
  copiedAddresses: Set<string>;
}

export function AddressItem({
  address,
  group,
  addressIndex,
  getDebankUrl,
  handleCopyAddress,
  copiedAddresses,
}: AddressItemProps) {
  return (
    <div
      key={`${address.address}-${addressIndex}`}
      className="gap-0 flex flex-col"
    >
      {address.label && (
        <span className="text-sm font-medium text-muted-foreground">
          {address.label}
        </span>
      )}
      <div className="gap-3 flex items-center">
        <a
          href={
            getDebankUrl ? getDebankUrl(address.address, group.network) : "#"
          }
          target="_blank"
          rel="noopener noreferrer"
          className="text-base leading-relaxed break-all text-[#8c35fd] underline transition-colors hover:text-[#a855f7]"
          title="View DeFi portfolio and positions on DeBank"
        >
          {address.address}
        </a>
        <button
          onClick={() =>
            handleCopyAddress(address.address, group.category, group.network)
          }
          aria-label={`Copy address ${address.address}`}
          className="h-4 w-4 shrink-0 cursor-copy opacity-60 hover:opacity-100"
        >
          {copiedAddresses.has(
            `${group.category}-${group.network}-${address.address}`,
          ) ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <ClipboardCopy className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
