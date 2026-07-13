import type { V2ReserveResponse } from "@/lib/types";

export type Protocol =
  | "AAVE"
  | "Uniswap V3"
  | "Mento FPMM"
  | "Mento Liquity V2";

export const PROTOCOL_LOGO: Record<Protocol, string> = {
  AAVE: "/protocols/aave.svg",
  "Uniswap V3": "/protocols/uniswap.svg",
  "Mento FPMM": "/protocols/mento.svg",
  "Mento Liquity V2": "/protocols/mento-liquity.svg",
};

export const PROTOCOL_BORDER: Record<Protocol, string> = {
  AAVE: "border-[#9391F7]/60",
  "Uniswap V3": "border-[#FF007A]/60",
  "Mento FPMM": "border-[#7005fc]/60",
  "Mento Liquity V2": "border-[#405AE5]/60",
};

export const PROTOCOL_ORDER: Protocol[] = [
  "Mento FPMM",
  "AAVE",
  "Uniswap V3",
  "Mento Liquity V2",
];

export type Token = {
  symbol: string;
  amount: number;
  usdValue: number;
  isMentoStable: boolean;
};

export type LiquidityPosition = {
  protocol: Protocol;
  positionName: string;
  tokens: Token[];
  holder: string;
  holderAddress: string;
  chain: string;
};

export type AddressDescriptionMap = Map<string, string>;

export type HoldingEntry =
  V2ReserveResponse["positions"]["wallet_balances"][number];
export type ActiveTrove = V2ReserveResponse["cdp_troves"]["troves"][number];

type OpAssetRow = {
  kind: "opAsset";
  symbol: string;
  balance: number;
  usd: number;
  pct: number;
};

type OpCustodyRow = {
  kind: "opCustody";
  chain: string;
  label: string;
  address: string;
  description?: string;
  balance: string;
  usd: number;
};

type OpTotalRow = {
  kind: "opTotal";
  usd: number;
};

export type OpRow = OpAssetRow | OpCustodyRow | OpTotalRow;

type ProtocolTotalRowData = {
  kind: "protoTotal";
  protocol: Protocol;
  mentoUsd: number;
  collateralUsd: number;
  positionCount: number;
};

type PositionRowData = {
  kind: "position";
  protocol: Protocol;
  name: string;
  chain: string;
  holder: string;
  holderAddress: string;
  holderDescription?: string;
  mentoTokens: Token[];
  collateralTokens: Token[];
};

type ProtocolSubtotalsRowData = {
  kind: "protoSubtotals";
  protocol: Protocol;
  mentoTokens: Token[];
  collateralTokens: Token[];
};

type GrandLiquidityTotalRowData = {
  kind: "grandLiquidityTotal";
  mentoUsd: number;
  collateralUsd: number;
};

export type LiquidityRow =
  | ProtocolTotalRowData
  | PositionRowData
  | ProtocolSubtotalsRowData
  | GrandLiquidityTotalRowData;
