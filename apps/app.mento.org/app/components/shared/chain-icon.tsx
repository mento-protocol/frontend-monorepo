import Image from "next/image";
import { chainIdToChain, type ChainId } from "@repo/web3";

interface ChainIconProps {
  chainId: ChainId;
  size?: number;
  className?: string;
  /** Add a `title` attribute to the underlying image (native tooltip). */
  withTitle?: boolean;
  /** Wrap the image in a `<span title aria-label>` instead. */
  wrapper?: boolean;
}

export function ChainIcon({
  chainId,
  size = 16,
  className = "h-4 w-4 rounded-full",
  withTitle = false,
  wrapper = false,
}: ChainIconProps) {
  const chain = chainIdToChain[chainId];
  const iconUrl = chain?.iconUrl;

  if (!iconUrl) return null;

  const image = (
    <Image
      src={iconUrl}
      alt={chain?.name ?? ""}
      width={size}
      height={size}
      className={className}
      title={withTitle ? chain?.name : undefined}
      unoptimized
    />
  );

  if (!wrapper) return image;

  return (
    <span
      title={chain?.name ?? ""}
      aria-label={chain?.name ?? ""}
      className="inline-flex"
    >
      {image}
    </span>
  );
}
