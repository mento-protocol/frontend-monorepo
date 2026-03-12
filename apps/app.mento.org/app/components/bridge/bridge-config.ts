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
    formBackground: isDark ? "#2D1F47" : "#FFFFFF",
    formBorder: isDark ? "#3D2B5C" : "#E5E2ED",
    input: isDark ? "#3D2B5C" : "#F7F5FA",
    primary: "#7C3AED",
    secondary: isDark ? "#3D2B5C" : "#E5E2ED",
    text: isDark ? "#F5F0FF" : "#1A0E2E",
    textSecondary: "#9B8FB8",
    error: isDark ? "#E5484D" : "#DC3545",
    success: "#46A758",
    font: '"AspektaVF", "Geist Sans", sans-serif',
  };
}

const nttConfig: NttRoute.Config = {
  tokens: {
    USDm: [
      {
        chain: "Celo",
        manager: "0xa4096343485a44c0F8d05AE6dA311c18D63e38bC",
        token: "0x765de816845861e75a25fca122bb6898b8b1282a",
        transceiver: [
          {
            address: "0x40f8650ACd6cA771a822b6d8Da71B46b0bDe4C1B",
            type: "wormhole",
          },
        ],
        eta: 1_200_000, // ~20 min for Celo → Monad
      },
      {
        chain: "Monad",
        manager: "0xa4096343485a44c0F8d05AE6dA311c18D63e38bC",
        token: "0xBC69212B8E4d445b2307C9D32dD68E2A4Df00115",
        transceiver: [
          {
            address: "0x40f8650ACd6cA771a822b6d8Da71B46b0bDe4C1B",
            type: "wormhole",
          },
        ],
      },
    ],
    GBPm: [
      {
        chain: "Celo",
        manager: "0x7895D03FfDeb14a57eF79c21C3eA14dADf2a7c3f",
        token: "0xCCF663b1fF11028f0b19058d0f7B674004a40746",
        transceiver: [
          {
            address: "0xcB55fE41C5437Ad6449C2978B061958C1EC1AB5f",
            type: "wormhole",
          },
        ],
        eta: 1_200_000, // ~20 min for Celo → Monad
      },
      {
        chain: "Monad",
        manager: "0x7895D03FfDeb14a57eF79c21C3eA14dADf2a7c3f",
        token: "0x39bb4E0a204412bB98e821d25e7d955e69d40Fd1",
        transceiver: [
          {
            address: "0xcB55fE41C5437Ad6449C2978B061958C1EC1AB5f",
            type: "wormhole",
          },
        ],
      },
    ],
  },
};

export const bridgeConfig: config.WormholeConnectConfig = {
  network: "Mainnet",
  chains: ["Celo", "Monad"],
  tokens: ["USDm", "GBPm"],
  tokensConfig: {
    USDm_celo: {
      symbol: "USDm",
      decimals: 18,
      icon: "/tokens/USDm.svg",
      tokenId: {
        chain: "Celo",
        address: "0x765de816845861e75a25fca122bb6898b8b1282a",
      },
    },
    USDm_monad: {
      symbol: "USDm",
      decimals: 18,
      icon: "/tokens/USDm.svg",
      tokenId: {
        chain: "Monad",
        address: "0xBC69212B8E4d445b2307C9D32dD68E2A4Df00115",
      },
    },
    GBPm_celo: {
      symbol: "GBPm",
      decimals: 18,
      icon: "/tokens/GBPm.svg",
      tokenId: {
        chain: "Celo",
        address: "0xCCF663b1fF11028f0b19058d0f7B674004a40746",
      },
    },
    GBPm_monad: {
      symbol: "GBPm",
      decimals: 18,
      icon: "/tokens/GBPm.svg",
      tokenId: {
        chain: "Monad",
        address: "0x39bb4E0a204412bB98e821d25e7d955e69d40Fd1",
      },
    },
  },
  routes: [...nttRoutes(nttConfig)],
  rpcs: {
    Celo: "https://forno.celo.org",
    Monad: "https://rpc3.monad.xyz",
  },
  ui: {
    title: "Bridge",
    defaultInputs: {
      source: { chain: "Celo" },
      destination: { chain: "Monad" },
    },
    showFooter: true,
  },
};
