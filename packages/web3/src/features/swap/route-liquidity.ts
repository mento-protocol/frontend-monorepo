import { SWAP_INSUFFICIENT_LIQUIDITY_LABEL } from "@/features/swap/error-handlers";
import { type ReadContractReturnType } from "viem";
import {
  ROUTER_ABI,
  type Route,
  encodeRoutePath,
  type Mento,
} from "@mento-protocol/mento-sdk";
import { isSameAddress, resolveRouteHops } from "./route-hops";

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

  // routerRoutes is the authoritative, direction-aware order of hops. Each
  // matching route.path pool can resolve at most one hop.
  const resolvedHops = resolveRouteHops(route, routerRoutes);
  if (!resolvedHops) {
    throw new Error("Unable to validate swap liquidity.");
  }

  for (const { hop, hopIndex, pool } of resolvedHops) {
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
