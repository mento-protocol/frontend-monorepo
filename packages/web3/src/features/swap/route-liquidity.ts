import { SWAP_INSUFFICIENT_LIQUIDITY_LABEL } from "@/features/swap/error-handlers";
import { type ReadContractReturnType } from "viem";
import {
  ROUTER_ABI,
  type Route,
  encodeRoutePath,
  type Mento,
} from "@mento-protocol/mento-sdk";

function isSameAddress(addressA: string, addressB: string): boolean {
  return addressA.toLowerCase() === addressB.toLowerCase();
}

export async function validateRouteLiquidity(params: {
  mento: Mento;
  route: Route;
  amounts: ReadContractReturnType<typeof ROUTER_ABI, "getAmountsOut">;
  routerRoutes: ReturnType<typeof encodeRoutePath>;
}) {
  const { mento, route, amounts, routerRoutes } = params;

  if (routerRoutes.length === 0) return;
  if (amounts.length !== routerRoutes.length + 1) {
    throw new Error("Unable to validate swap liquidity.");
  }

  const poolDetailsByAddr = new Map(
    await Promise.all(
      route.path.map(
        async (pool) =>
          [
            pool.poolAddr.toLowerCase(),
            await mento.pools.getPoolDetails(pool.poolAddr),
          ] as const,
      ),
    ),
  );

  // routerRoutes is the authoritative, direction-aware order of hops; route.path
  // is only consulted to resolve (factory, {from,to}) → poolAddr.
  const remainingPools = [...route.path];

  for (const [hopIndex, hop] of routerRoutes.entries()) {
    const poolIdx = remainingPools.findIndex(
      (p) =>
        isSameAddress(p.factoryAddr, hop.factory) &&
        ((isSameAddress(p.token0, hop.from) &&
          isSameAddress(p.token1, hop.to)) ||
          (isSameAddress(p.token1, hop.from) &&
            isSameAddress(p.token0, hop.to))),
    );
    const pool = poolIdx === -1 ? undefined : remainingPools[poolIdx];
    if (!pool) {
      throw new Error("Unable to validate swap liquidity.");
    }
    remainingPools.splice(poolIdx, 1);

    const details = poolDetailsByAddr.get(pool.poolAddr.toLowerCase());
    const hopAmountOut = amounts[hopIndex + 1];
    if (!details || hopAmountOut == null) {
      throw new Error("Unable to validate swap liquidity.");
    }

    const reserveOut = isSameAddress(hop.to, pool.token0)
      ? details.reserve0
      : isSameAddress(hop.to, pool.token1)
        ? details.reserve1
        : null;

    if (reserveOut == null) {
      throw new Error("Unable to validate swap liquidity.");
    }

    // Router swaps require output strictly below available reserve.
    if (hopAmountOut >= reserveOut) {
      throw new Error(SWAP_INSUFFICIENT_LIQUIDITY_LABEL);
    }
  }
}
