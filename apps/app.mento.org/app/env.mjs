/* global process */
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /*
   * Serverside Environment variables, not available on the client.
   * Will throw if you access these variables on the client.
   */
  server: {
    SENTRY_AUTH_TOKEN: z.string().optional(),
    CHAINALYSIS_API_KEY: z.string().optional(),
  },
  /*
   * Environment variables available on the client (and server).
   *
   * 💡 You'll get type errors if these are not prefixed with NEXT_PUBLIC_.
   */
  client: {
    NEXT_PUBLIC_STORAGE_URL: z.string().url(),
    NEXT_PUBLIC_WALLET_CONNECT_ID: z.string(),
    NEXT_PUBLIC_SENTRY_DSN_SWAP: z.string(),
    NEXT_PUBLIC_ENABLE_DEBUG: z
      .enum(["true", "false"])
      .optional()
      .default("false"),
    NEXT_PUBLIC_USE_FORK: z.enum(["true", "false"]).optional().default("false"),
    NEXT_PUBLIC_E2E_TEST: z.enum(["true", "false"]).optional().default("false"),
    NEXT_PUBLIC_SANCTIONS_TEST_MODE: z
      .enum(["true", "false"])
      .optional()
      .default("false"),
    NEXT_PUBLIC_BANNER_TEXT: z.string().optional().default(""),
    NEXT_PUBLIC_BANNER_LINK: z.preprocess(
      (val) => (val === "" ? undefined : val),
      z.string().url().optional(),
    ),
    NEXT_PUBLIC_RPC_URL: z.preprocess(
      (val) => (val === "" ? undefined : val),
      z.string().url().optional(),
    ),
    NEXT_PUBLIC_CELO_RPC_URL: z.preprocess(
      (val) => (val === "" ? undefined : val),
      z.string().url().optional(),
    ),
    NEXT_PUBLIC_CELO_SEPOLIA_RPC_URL: z.preprocess(
      (val) => (val === "" ? undefined : val),
      z.string().url().optional(),
    ),
    NEXT_PUBLIC_MONAD_RPC_URL: z.preprocess(
      (val) => (val === "" ? undefined : val),
      z.string().url().optional(),
    ),
    NEXT_PUBLIC_MONAD_TESTNET_RPC_URL: z.preprocess(
      (val) => (val === "" ? undefined : val),
      z.string().url().optional(),
    ),
    // Trove-history subgraph endpoints. Optional: @repo/web3 falls back to the
    // currently-deployed Studio URLs when unset. Set these to re-point at a new
    // Studio version label after a subgraph redeploy, or at the decentralized
    // network gateway once the mainnet subgraph is published.
    NEXT_PUBLIC_TROVES_SUBGRAPH_URL: z.preprocess(
      (val) => (val === "" ? undefined : val),
      z.string().url().optional(),
    ),
    NEXT_PUBLIC_TROVES_SUBGRAPH_URL_CELO_SEPOLIA: z.preprocess(
      (val) => (val === "" ? undefined : val),
      z.string().url().optional(),
    ),
    // Required only when a troves subgraph URL points at
    // gateway.thegraph.com; Studio endpoints are unauthenticated.
    NEXT_PUBLIC_GRAPH_API_KEY: z.string().optional(),
  },
  /*
   * Due to how Next.js bundles environment variables on Edge and Client,
   * we need to manually destructure them to make sure all are included in bundle.
   *
   * 💡 You'll get type errors if not all variables from `server` & `client` are included here.
   */
  runtimeEnv: {
    NEXT_PUBLIC_STORAGE_URL: process.env.NEXT_PUBLIC_STORAGE_URL,
    NEXT_PUBLIC_WALLET_CONNECT_ID: process.env.NEXT_PUBLIC_WALLET_CONNECT_ID,
    SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
    CHAINALYSIS_API_KEY: process.env.CHAINALYSIS_API_KEY,
    NEXT_PUBLIC_SENTRY_DSN_SWAP: process.env.NEXT_PUBLIC_SENTRY_DSN_SWAP,
    NEXT_PUBLIC_ENABLE_DEBUG: process.env.NEXT_PUBLIC_ENABLE_DEBUG,
    NEXT_PUBLIC_USE_FORK: process.env.NEXT_PUBLIC_USE_FORK,
    NEXT_PUBLIC_E2E_TEST: process.env.NEXT_PUBLIC_E2E_TEST,
    NEXT_PUBLIC_SANCTIONS_TEST_MODE:
      process.env.NEXT_PUBLIC_SANCTIONS_TEST_MODE,
    NEXT_PUBLIC_BANNER_TEXT: process.env.NEXT_PUBLIC_BANNER_TEXT,
    NEXT_PUBLIC_BANNER_LINK: process.env.NEXT_PUBLIC_BANNER_LINK,
    NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
    NEXT_PUBLIC_CELO_RPC_URL: process.env.NEXT_PUBLIC_CELO_RPC_URL,
    NEXT_PUBLIC_CELO_SEPOLIA_RPC_URL:
      process.env.NEXT_PUBLIC_CELO_SEPOLIA_RPC_URL,
    NEXT_PUBLIC_MONAD_RPC_URL: process.env.NEXT_PUBLIC_MONAD_RPC_URL,
    NEXT_PUBLIC_MONAD_TESTNET_RPC_URL:
      process.env.NEXT_PUBLIC_MONAD_TESTNET_RPC_URL,
    NEXT_PUBLIC_TROVES_SUBGRAPH_URL:
      process.env.NEXT_PUBLIC_TROVES_SUBGRAPH_URL,
    NEXT_PUBLIC_TROVES_SUBGRAPH_URL_CELO_SEPOLIA:
      process.env.NEXT_PUBLIC_TROVES_SUBGRAPH_URL_CELO_SEPOLIA,
    NEXT_PUBLIC_GRAPH_API_KEY: process.env.NEXT_PUBLIC_GRAPH_API_KEY,
  },
});
