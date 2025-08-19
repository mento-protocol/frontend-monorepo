/* global process */
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /*
   * Serverside Environment variables, not available on the client.
   * Will throw if you access these variables on the client.
   */
  server: {},
  /*
   * Environment variables available on the client (and server).
   *
   * 💡 You'll get type errors if these are not prefixed with NEXT_PUBLIC_.
   */
  client: {
    NEXT_PUBLIC_STORAGE_URL: z.string().url(),
    NEXT_PUBLIC_CELO_EXPLORER_API_URL: z.string().url(),
    NEXT_PUBLIC_CELO_EXPLORER_API_URL_ALFAJORES: z.string().url(),
    NEXT_PUBLIC_SUBGRAPH_URL: z.string().url(),
    NEXT_PUBLIC_SUBGRAPH_URL_ALFAJORES: z.string().url(),
    NEXT_PUBLIC_VERCEL_ENV: z.string(),
    NEXT_PUBLIC_WALLET_CONNECT_ID: z.string(),
    NEXT_PUBLIC_GRAPH_API_KEY: z.string(),
    NEXT_PUBLIC_GRAPH_API_KEY_ALFAJORES: z.string(),
    NEXT_PUBLIC_SENTRY_DSN: z.string(),
  },
  /*
   * Due to how Next.js bundles environment variables on Edge and Client,
   * we need to manually destructure them to make sure all are included in bundle.
   *
   * 💡 You'll get type errors if not all variables from `server` & `client` are included here.
   */
  runtimeEnv: {
    NEXT_PUBLIC_STORAGE_URL: process.env.NEXT_PUBLIC_STORAGE_URL,
    NEXT_PUBLIC_CELO_EXPLORER_API_URL:
      process.env.NEXT_PUBLIC_CELO_EXPLORER_API_URL,
    NEXT_PUBLIC_CELO_EXPLORER_API_URL_ALFAJORES:
      process.env.NEXT_PUBLIC_CELO_EXPLORER_API_URL_ALFAJORES,
    NEXT_PUBLIC_SUBGRAPH_URL: process.env.NEXT_PUBLIC_SUBGRAPH_URL,
    NEXT_PUBLIC_SUBGRAPH_URL_ALFAJORES:
      process.env.NEXT_PUBLIC_SUBGRAPH_URL_ALFAJORES,
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
    NEXT_PUBLIC_WALLET_CONNECT_ID: process.env.NEXT_PUBLIC_WALLET_CONNECT_ID,
    NEXT_PUBLIC_GRAPH_API_KEY: process.env.NEXT_PUBLIC_GRAPH_API_KEY,
    NEXT_PUBLIC_GRAPH_API_KEY_ALFAJORES:
      process.env.NEXT_PUBLIC_GRAPH_API_KEY_ALFAJORES,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  },
});
