import { BorrowService } from "@mento-protocol/mento-sdk";
import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  parseAbiParameters,
  type PublicClient,
} from "viem";

const cache = new Map<string, BorrowService>();
const TROVE_ID_PARAMETERS = parseAbiParameters(
  "address opener, address owner, uint256 ownerIndex",
);

export function getBorrowService(
  publicClient: PublicClient,
  chainId: number,
): BorrowService {
  const key = `${chainId}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const service = new BorrowService(publicClient, chainId);
  cache.set(key, service);
  return service;
}

export function deriveBorrowTroveId(
  opener: string,
  owner: string,
  ownerIndex: number,
): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(TROVE_ID_PARAMETERS, [
        getAddress(opener),
        getAddress(owner),
        BigInt(ownerIndex),
      ]),
    ),
  );
}
