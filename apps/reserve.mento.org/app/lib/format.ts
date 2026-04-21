export function formatUsd(value: number, compact = false): string {
  if (compact && value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function formatNumber(value: number | string, decimals = 0): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(num)) return "0";
  return num.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

export function formatPercent(value: number): string {
  if (value >= 1) return `${value.toFixed(1)}%`;
  return `${value.toFixed(2)}%`;
}

export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function getBlockExplorerUrl(chain: string, address: string): string {
  switch (chain) {
    case "ethereum":
      return `https://etherscan.io/address/${address}`;
    case "bitcoin":
      return `https://blockstream.info/address/${address}`;
    case "monad":
      return `https://explorer.monad.xyz/address/${address}`;
    default:
      return `https://celoscan.io/address/${address}`;
  }
}
