const BRIDGE_CONNECT_ORIGINS = [
  "https://li.quest",
  "https://explorer-api.mayan.finance",
  "https://executor.labsapis.com",
];

const METAMASK_SDK_ORIGINS = [
  "https://metamask-sdk.api.cx.metamask.io",
  "wss://metamask-sdk.api.cx.metamask.io",
];

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Build the app's report-only CSP from reviewed product and environment
 * origins. Keep this app-local: the other Mento surfaces do not ship the
 * bridge, MetaMask SDK, or remote token imagery.
 *
 * @param {{
 *   reportUri?: string;
 *   rpcOverrideOrigins?: string[];
 *   storageHostname: string;
 * }} options
 * @returns {string}
 */
export function buildAppReportOnlyCsp({
  reportUri = "",
  rpcOverrideOrigins = [],
  storageHostname,
}) {
  const connectSrc = unique([
    "'self'",
    "https://forno.celo.org",
    "https://forno.celo-sepolia.celo-testnet.org",
    "https://rpc.monad.xyz",
    "https://testnet-rpc.monad.xyz",
    "https://rpc3.monad.xyz",
    "https://polygon.drpc.org",
    "https://polygon-amoy.drpc.org",
    "https://sepolia.base.org",
    "https://api.studio.thegraph.com",
    "https://gateway.thegraph.com",
    "https://api.coingecko.com",
    "https://api.wormholescan.io",
    "https://api.web3modal.org",
    ...BRIDGE_CONNECT_ORIGINS,
    ...METAMASK_SDK_ORIGINS,
    "https://*.walletconnect.com",
    "wss://*.walletconnect.com",
    "https://*.walletconnect.org",
    "wss://*.walletconnect.org",
    `https://${storageHostname}`,
    ...rpcOverrideOrigins,
  ]);

  return [
    "default-src 'self'",
    // 'unsafe-inline' 'unsafe-eval' are required by Next 15 + wagmi today.
    // Tightening target: replace with per-request nonces/hashes in production.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `img-src 'self' data: blob: https://${storageHostname} https://coin-images.coingecko.com`,
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src ${connectSrc.join(" ")}`,
    "frame-src 'self' https://verify.walletconnect.com https://verify.walletconnect.org",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(reportUri ? [`report-uri ${reportUri}`] : []),
  ].join("; ");
}
