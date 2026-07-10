import type {
  V2AddressesResponse,
  V2ReserveResponse,
  V2StablecoinsResponse,
} from "@/lib/types";
import type { AddressDescriptionMap, LiquidityPosition, Token } from "./types";

export function buildAddressDescriptionMap(
  addresses: V2AddressesResponse | undefined,
): AddressDescriptionMap {
  const map = new Map<string, string>();
  if (!addresses) return map;

  for (const address of addresses.reserve) {
    if (address.description) {
      map.set(address.address.toLowerCase(), address.description);
    }
  }

  return map;
}

export function lookupDescription(
  map: AddressDescriptionMap,
  address: string | undefined,
): string | undefined {
  if (!address) return undefined;
  return map.get(address.toLowerCase());
}

export function buildPriceMap(
  reserve: V2ReserveResponse,
  stablecoins: V2StablecoinsResponse,
): Map<string, number> {
  const map = new Map<string, number>();

  for (const coin of stablecoins.stablecoins) {
    const total = parseFloat(coin.supply.total);
    if (total > 0) {
      map.set(coin.symbol, coin.supply.total_usd / total);
    }
  }

  for (const asset of reserve.collateral.assets) {
    const balance = parseFloat(asset.balance);
    if (balance > 0 && asset.usd_value > 0 && !map.has(asset.symbol)) {
      map.set(asset.symbol, asset.usd_value / balance);
    }
  }

  for (const symbol of ["USDC", "USDT", "USDGLO", "AUSD", "DAI", "axlUSDC"]) {
    if (!map.has(symbol)) {
      map.set(symbol, 1);
    }
  }

  return map;
}

export function normalizePositions(
  reserve: V2ReserveResponse,
  mentoSymbols: Set<string>,
  priceMap: Map<string, number>,
): LiquidityPosition[] {
  const out: LiquidityPosition[] = [];

  for (const deposit of reserve.positions.aave_deposits) {
    const amount = parseFloat(deposit.balance);
    const usd =
      deposit.usd_value > 0
        ? deposit.usd_value
        : priceOf(deposit.token, amount, priceMap);
    out.push({
      protocol: "AAVE",
      positionName: `${deposit.token} Deposit`,
      tokens: [
        {
          symbol: deposit.token,
          amount,
          usdValue: usd,
          isMentoStable:
            deposit.is_mento_stable || mentoSymbols.has(deposit.token),
        },
      ],
      holder: deposit.label,
      holderAddress: deposit.address,
      chain: deposit.chain,
    });
  }

  for (const position of reserve.positions.fpmm_positions) {
    out.push({
      protocol: "Mento FPMM",
      positionName: position.pool_name,
      tokens: [
        normalizeToken(
          position.debt_token.symbol,
          position.debt_token.amount,
          mentoSymbols,
          priceMap,
        ),
        normalizeToken(
          position.collateral_token.symbol,
          position.collateral_token.amount,
          mentoSymbols,
          priceMap,
        ),
      ],
      holder: position.lp_holder_label,
      holderAddress: position.lp_holder,
      chain: position.chain,
    });
  }

  for (const position of reserve.positions.univ3_positions) {
    const amount0 = parseFloat(position.token0.amount);
    const amount1 = parseFloat(position.token1.amount);
    out.push({
      protocol: "Uniswap V3",
      positionName: `${position.token0.symbol} / ${position.token1.symbol}`,
      tokens: [
        normalizeToken(position.token0.symbol, amount0, mentoSymbols, priceMap),
        normalizeToken(position.token1.symbol, amount1, mentoSymbols, priceMap),
      ],
      holder: position.owner_label,
      holderAddress: position.owner,
      chain: position.chain,
    });
  }

  for (const deposit of reserve.positions.stability_pool_deposits) {
    const tokens: Token[] = [
      {
        symbol: deposit.deposit_token,
        amount: parseFloat(deposit.deposit_amount),
        usdValue: deposit.deposit_usd,
        isMentoStable: mentoSymbols.has(deposit.deposit_token),
      },
    ];
    const collateralAmount = parseFloat(deposit.collateral_gained);
    if (collateralAmount > 0) {
      tokens.push({
        symbol: deposit.collateral_gained_token,
        amount: collateralAmount,
        usdValue: deposit.collateral_gained_usd,
        isMentoStable: mentoSymbols.has(deposit.collateral_gained_token),
      });
    }

    out.push({
      protocol: "Mento Liquity V2",
      positionName: deposit.pool_label,
      tokens,
      holder: deposit.depositor_label,
      holderAddress: deposit.depositor,
      chain: deposit.chain,
    });
  }

  return out;
}

export function sumUsd(
  positions: LiquidityPosition[],
  predicate: (token: Token) => boolean,
): number {
  return positions.reduce(
    (sum, position) =>
      sum +
      position.tokens
        .filter(predicate)
        .reduce((tokenSum, token) => tokenSum + token.usdValue, 0),
    0,
  );
}

export function sortTokensBySymbol(tokens: Token[]): Token[] {
  return [...tokens].sort((left, right) =>
    left.symbol.toLowerCase().localeCompare(right.symbol.toLowerCase()),
  );
}

export function aggregateTokens(positions: LiquidityPosition[]): Token[] {
  const map = new Map<string, Token>();
  for (const position of positions) {
    for (const token of position.tokens) {
      if (token.amount === 0) continue;
      const existing = map.get(token.symbol);
      if (existing) {
        existing.amount += token.amount;
        existing.usdValue += token.usdValue;
      } else {
        map.set(token.symbol, { ...token });
      }
    }
  }
  return [...map.values()].sort(
    (left, right) => right.usdValue - left.usdValue,
  );
}

function normalizeToken(
  symbol: string,
  amount: number,
  mentoSymbols: Set<string>,
  priceMap: Map<string, number>,
): Token {
  return {
    symbol,
    amount,
    usdValue: priceOf(symbol, amount, priceMap),
    isMentoStable: mentoSymbols.has(symbol),
  };
}

function priceOf(
  symbol: string,
  amount: number,
  priceMap: Map<string, number>,
): number {
  const rate = priceMap.get(symbol);
  if (rate === undefined) return 0;
  return rate * amount;
}
