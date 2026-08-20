import {
  encodeRoutePath,
  type Pool,
  type Route,
} from "@mento-protocol/mento-sdk";

export function isSameAddress(addressA: string, addressB: string): boolean {
  return addressA.toLowerCase() === addressB.toLowerCase();
}

export interface ResolvedRouteHop {
  hop: ReturnType<typeof encodeRoutePath>[number];
  hopIndex: number;
  pool: Pool;
}

export function resolveRouteHops(
  route: Route,
  routerRoutes: ReturnType<typeof encodeRoutePath>,
): ResolvedRouteHop[] | null {
  if (route.path.length !== routerRoutes.length) return null;

  const matches = (pool: Pool, hop: (typeof routerRoutes)[number]) =>
    isSameAddress(pool.factoryAddr, hop.factory) &&
    ((isSameAddress(pool.token0, hop.from) &&
      isSameAddress(pool.token1, hop.to)) ||
      (isSameAddress(pool.token1, hop.from) &&
        isSameAddress(pool.token0, hop.to)));
  const forwardPools = route.path;
  const reversePools = [...route.path].reverse();
  const orderedPools = forwardPools.every((pool, index) =>
    matches(pool, routerRoutes[index]!),
  )
    ? forwardPools
    : reversePools.every((pool, index) => matches(pool, routerRoutes[index]!))
      ? reversePools
      : null;

  if (!orderedPools) return null;
  return routerRoutes.map((hop, hopIndex) => ({
    hop,
    hopIndex,
    pool: orderedPools[hopIndex]!,
  }));
}
