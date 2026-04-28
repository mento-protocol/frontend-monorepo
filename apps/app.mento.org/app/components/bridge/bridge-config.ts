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
    EURm: [
      {
        chain: "Celo",
        manager: "0x5F8a1e50F83f53951B89Fc73Ead80b27045C67fd",
        token: "0xd8763cba276a3738e6de85b4b3bf5fded6d6ca73",
        transceiver: [
          {
            address: "0x6467cfCA82184657F32F1195F9a26b5578399479",
            type: "wormhole",
          },
        ],
        eta: 1_200_000, // ~20 min for Celo → Monad
      },
      {
        chain: "Monad",
        manager: "0x5F8a1e50F83f53951B89Fc73Ead80b27045C67fd",
        token: "0x4D502d735B4C574B487Ed641ae87cEaE884731C7",
        transceiver: [
          {
            address: "0x6467cfCA82184657F32F1195F9a26b5578399479",
            type: "wormhole",
          },
        ],
      },
    ],
    JPYm: [
      {
        chain: "Celo",
        manager: "0x7431419FE761e7da37587245c55a35E5a356c91B",
        token: "0xc45eCF20f3CD864B32D9794d6f76814aE8892e20",
        transceiver: [
          {
            address: "0x01C9d280150F932D4a2fe11f40b0d72BFfBCd339",
            type: "wormhole",
          },
        ],
        eta: 1_200_000, // ~20 min for Celo → Monad
      },
      {
        chain: "Monad",
        manager: "0x7431419FE761e7da37587245c55a35E5a356c91B",
        token: "0x22f6A6752800eAB67b84748FeFc3cC658384aF72",
        transceiver: [
          {
            address: "0x01C9d280150F932D4a2fe11f40b0d72BFfBCd339",
            type: "wormhole",
          },
        ],
      },
    ],
    CHFm: [
      {
        chain: "Celo",
        manager: "0xbbFBE2791722E93f27c5cE80e3725c8DD8d09697",
        token: "0xb55a79F398E759E43C95b979163f30eC87Ee131D",
        transceiver: [
          {
            address: "0x0D05cf3F8d39Dc988E69CC1bF37f972eadBdC093",
            type: "wormhole",
          },
        ],
        eta: 1_200_000, // ~20 min for Celo → Monad
      },
      {
        chain: "Monad",
        manager: "0xbbFBE2791722E93f27c5cE80e3725c8DD8d09697",
        token: "0xF64e91fFEf7ef43aA314F0Bc2AC39f770797990C",
        transceiver: [
          {
            address: "0x0D05cf3F8d39Dc988E69CC1bF37f972eadBdC093",
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
  tokens: ["USDm", "GBPm", "EURm", "JPYm", "CHFm"],
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
    EURm_celo: {
      symbol: "EURm",
      decimals: 18,
      icon: "/tokens/EURm.svg",
      tokenId: {
        chain: "Celo",
        address: "0xd8763cba276a3738e6de85b4b3bf5fded6d6ca73",
      },
    },
    EURm_monad: {
      symbol: "EURm",
      decimals: 18,
      icon: "/tokens/EURm.svg",
      tokenId: {
        chain: "Monad",
        address: "0x4D502d735B4C574B487Ed641ae87cEaE884731C7",
      },
    },
    JPYm_celo: {
      symbol: "JPYm",
      decimals: 18,
      icon: "/tokens/JPYm.svg",
      tokenId: {
        chain: "Celo",
        address: "0xc45eCF20f3CD864B32D9794d6f76814aE8892e20",
      },
    },
    JPYm_monad: {
      symbol: "JPYm",
      decimals: 18,
      icon: "/tokens/JPYm.svg",
      tokenId: {
        chain: "Monad",
        address: "0x22f6A6752800eAB67b84748FeFc3cC658384aF72",
      },
    },
    CHFm_celo: {
      symbol: "CHFm",
      decimals: 18,
      icon: "/tokens/CHFm.svg",
      tokenId: {
        chain: "Celo",
        address: "0xb55a79F398E759E43C95b979163f30eC87Ee131D",
      },
    },
    CHFm_monad: {
      symbol: "CHFm",
      decimals: 18,
      icon: "/tokens/CHFm.svg",
      tokenId: {
        chain: "Monad",
        address: "0xF64e91fFEf7ef43aA314F0Bc2AC39f770797990C",
      },
    },
  },
  routes: [...nttRoutes(nttConfig)],
  rpcs: {
    Celo: "https://forno.celo.org",
    Monad: "https://rpc3.monad.xyz",
  },
  ui: {
    title: " ",
    defaultInputs: {
      source: { chain: "Celo", token: "USDm" },
      destination: { chain: "Monad", token: "USDm" },
    },
    showFooter: true,
  },
};
