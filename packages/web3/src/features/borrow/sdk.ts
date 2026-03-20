import { BorrowService } from "@mento-protocol/mento-sdk";
import type { PublicClient } from "viem";

const cache = new Map<string, BorrowService>();

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
