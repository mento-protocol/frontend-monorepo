import type { WormholeConnectTheme } from "@wormhole-foundation/wormhole-connect";
import type { config } from "@wormhole-foundation/wormhole-connect";
import {
  nttRoutes,
  type NttRoute,
} from "@wormhole-foundation/wormhole-connect/ntt";

export function getBridgeTheme(mode: "dark" | "light"): WormholeConnectTheme {
  const isDark = mode === "dark";
  return {
    mode,
    background: "transparent",
    formBackground: isDark ? "#161322" : "#FFFFFF",
    formBorder: "transparent",
    input: isDark ? "#2C2936" : "#F3F1F7",
    inputFillTreatment: true,
    primary: "#6D28D9",
    secondary: isDark ? "#2C2936" : "#E5E2ED",
    text: isDark ? "#F5F0FF" : "#1A0E2E",
    textSecondary: isDark ? "#8A8594" : "#9B8FB8",
    error: isDark ? "#E5484D" : "#DC3545",
    success: "#46A758",
    font: '"AspektaVF", "Geist Sans", sans-serif',
  };
}

const WORMHOLE_TEST_USD_ADDRESS = "0xd7CeC29119b8aA3B8718bD07Eb334d3a0c6f5d75";
const WORMHOLE_TEST_GBP_ADDRESS = "0x8c4E9828eb5a796Be7C1eBCBc20fC7554FAcB9d7";
const USD_NTT_MANAGER_ADDRESS = "0x20b815C6dF47B22332a7434A0C54116BE6d77117";
const USD_TRANSCEIVER_ADDRESS = "0xDF6B7D0521229D5BF21Fd69301d7eb0764dB632E";
const GBP_NTT_MANAGER_ADDRESS = "0x5850A656E4d3E44eBF635A66d7f1D14ac46849de";
const GBP_TRANSCEIVER_ADDRESS = "0x11aBC939306a02A60594C85e0f6dCFCBFac06178";

const nttConfig: NttRoute.Config = {
  tokens: {
    WormholeTestUSD: [
      {
        chain: "Celo",
        manager: USD_NTT_MANAGER_ADDRESS,
        token: WORMHOLE_TEST_USD_ADDRESS,
        transceiver: [{ address: USD_TRANSCEIVER_ADDRESS, type: "wormhole" }],
        eta: 1_200_000,
      },
      {
        chain: "Monad",
        manager: USD_NTT_MANAGER_ADDRESS,
        token: WORMHOLE_TEST_USD_ADDRESS,
        transceiver: [{ address: USD_TRANSCEIVER_ADDRESS, type: "wormhole" }],
        eta: 1_200_000,
      },
      {
        chain: "Polygon",
        manager: USD_NTT_MANAGER_ADDRESS,
        token: WORMHOLE_TEST_USD_ADDRESS,
        transceiver: [{ address: USD_TRANSCEIVER_ADDRESS, type: "wormhole" }],
        eta: 1_200_000,
      },
    ],
    WormholeTestGBP: [
      {
        chain: "Celo",
        manager: GBP_NTT_MANAGER_ADDRESS,
        token: WORMHOLE_TEST_GBP_ADDRESS,
        transceiver: [{ address: GBP_TRANSCEIVER_ADDRESS, type: "wormhole" }],
        eta: 1_200_000,
      },
      {
        chain: "Monad",
        manager: GBP_NTT_MANAGER_ADDRESS,
        token: WORMHOLE_TEST_GBP_ADDRESS,
        transceiver: [{ address: GBP_TRANSCEIVER_ADDRESS, type: "wormhole" }],
        eta: 1_200_000,
      },
      {
        chain: "Polygon",
        manager: GBP_NTT_MANAGER_ADDRESS,
        token: WORMHOLE_TEST_GBP_ADDRESS,
        transceiver: [{ address: GBP_TRANSCEIVER_ADDRESS, type: "wormhole" }],
        eta: 1_200_000,
      },
    ],
  },
};

export const bridgeConfig: config.WormholeConnectConfig = {
  network: "Mainnet",
  cacheNamespace: "mento-wormhole-test-v3",
  chains: ["Celo", "Monad", "Polygon"],
  tokensConfig: {
    WormholeTestUSD_celo: {
      symbol: "WormholeTestUSD",
      decimals: 18,
      icon: "/tokens/USDm.svg",
      tokenId: {
        chain: "Celo",
        address: WORMHOLE_TEST_USD_ADDRESS,
      },
    },
    WormholeTestUSD_monad: {
      symbol: "WormholeTestUSD",
      decimals: 18,
      icon: "/tokens/USDm.svg",
      tokenId: {
        chain: "Monad",
        address: WORMHOLE_TEST_USD_ADDRESS,
      },
    },
    WormholeTestUSD_polygon: {
      symbol: "WormholeTestUSD",
      decimals: 18,
      icon: "/tokens/USDm.svg",
      tokenId: {
        chain: "Polygon",
        address: WORMHOLE_TEST_USD_ADDRESS,
      },
    },
    WormholeTestGBP_celo: {
      symbol: "WormholeTestGBP",
      decimals: 18,
      icon: "/tokens/GBPm.svg",
      tokenId: {
        chain: "Celo",
        address: WORMHOLE_TEST_GBP_ADDRESS,
      },
    },
    WormholeTestGBP_monad: {
      symbol: "WormholeTestGBP",
      decimals: 18,
      icon: "/tokens/GBPm.svg",
      tokenId: {
        chain: "Monad",
        address: WORMHOLE_TEST_GBP_ADDRESS,
      },
    },
    WormholeTestGBP_polygon: {
      symbol: "WormholeTestGBP",
      decimals: 18,
      icon: "/tokens/GBPm.svg",
      tokenId: {
        chain: "Polygon",
        address: WORMHOLE_TEST_GBP_ADDRESS,
      },
    },
  },
  routes: [...nttRoutes(nttConfig)],
  rpcs: {
    Celo: "https://forno.celo.org",
    Monad: "https://rpc3.monad.xyz",
    Polygon: "https://polygon.drpc.org",
  },
  ui: {
    title: " ",
    defaultInputs: {
      source: { chain: "Celo", token: "WormholeTestUSD" },
      destination: { chain: "Monad", token: "WormholeTestUSD" },
    },
    showFooter: true,
  },
};
