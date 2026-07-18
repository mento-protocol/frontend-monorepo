import type { Config } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { ChainId } from "@/config/chains";

type TransactionFeeOverrides = {
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
};

const POLYGON_PRIORITY_FEE = 30_000_000_000n;
const POLYGON_MIN_MAX_FEE = 60_000_000_000n;

const POLYGON_CHAIN_IDS: readonly ChainId[] = [
  ChainId.Polygon,
  ChainId.PolygonAmoy,
];

/**
 * Polygon chains (mainnet and Amoy) reject transactions below their
 * validator-enforced fee floor. Some wallets/RPCs currently estimate
 * ~1.5 gwei, so pin explicit EIP-1559 caps for wallet-submitted
 * transactions on these chains.
 */
export async function getTransactionFeeOverrides(
  wagmiConfig: Config,
  chainId?: number,
): Promise<TransactionFeeOverrides> {
  if (!POLYGON_CHAIN_IDS.includes(chainId as ChainId)) {
    return {};
  }

  const publicClient = getPublicClient(wagmiConfig, { chainId });
  const block = publicClient
    ? await publicClient.getBlock().catch(() => null)
    : null;
  const baseFeePerGas = block?.baseFeePerGas ?? 0n;
  const maxFeePerGas = maxBigInt(
    baseFeePerGas * 2n + POLYGON_PRIORITY_FEE,
    POLYGON_MIN_MAX_FEE,
  );

  return {
    maxFeePerGas,
    maxPriorityFeePerGas: POLYGON_PRIORITY_FEE,
  };
}

function maxBigInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
