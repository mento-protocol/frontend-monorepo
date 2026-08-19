import { type Route, encodeRoutePath } from "@mento-protocol/mento-sdk";
import { describe, expect, it } from "vitest";

import { resolveRouteHops } from "./route-hops";

const FACTORY = "0xffffffffffffffffffffffffffffffffffffffff";
const TOKEN_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TOKEN_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TOKEN_C = "0xcccccccccccccccccccccccccccccccccccccccc";
const POOL_1 = "0x1111111111111111111111111111111111111111";
const POOL_2 = "0x2222222222222222222222222222222222222222";

describe("resolveRouteHops", () => {
  const route = {
    path: [
      {
        factoryAddr: FACTORY,
        poolAddr: POOL_1,
        poolType: "FPMM",
        token0: TOKEN_A,
        token1: TOKEN_B,
      },
      {
        factoryAddr: FACTORY,
        poolAddr: POOL_2,
        poolType: "FPMM",
        token0: TOKEN_B,
        token1: TOKEN_C,
      },
    ],
  } as Route;

  it("preserves pool identities with forward Router hops", () => {
    const routerRoutes = [
      { factory: FACTORY, from: TOKEN_A, to: TOKEN_B },
      { factory: FACTORY, from: TOKEN_B, to: TOKEN_C },
    ] as ReturnType<typeof encodeRoutePath>;

    expect(
      resolveRouteHops(route, routerRoutes)?.map(({ pool }) => pool.poolAddr),
    ).toEqual([POOL_1, POOL_2]);
  });

  it("reverses distinct pool identities with reverse Router hops", () => {
    const routerRoutes = [
      { factory: FACTORY, from: TOKEN_C, to: TOKEN_B },
      { factory: FACTORY, from: TOKEN_B, to: TOKEN_A },
    ] as ReturnType<typeof encodeRoutePath>;

    expect(
      resolveRouteHops(route, routerRoutes)?.map(({ pool }) => pool.poolAddr),
    ).toEqual([POOL_2, POOL_1]);
  });

  it("returns null when no pool ordering matches the Router hops", () => {
    const routerRoutes = [
      { factory: FACTORY, from: TOKEN_A, to: TOKEN_C },
      { factory: FACTORY, from: TOKEN_C, to: TOKEN_B },
    ] as ReturnType<typeof encodeRoutePath>;

    expect(resolveRouteHops(route, routerRoutes)).toBeNull();
  });
});
