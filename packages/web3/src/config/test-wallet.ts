import type { Wallet } from "@rainbow-me/rainbowkit";
import { createConnector } from "wagmi";
import { mock } from "wagmi/connectors";

/** Exact string doubles as the prod-bundle leak marker checked in CI (#444). */
const E2E_TEST_WALLET_ID = "mento-e2e-mock";

const E2E_EAGER_CONNECT_STORAGE_KEY = "mento_e2e_eager_connect";

// anvil junk accounts 0-2 (public-by-design, mnemonic "test test ... junk").
// NEVER fund these on a real network.
const E2E_ACCOUNTS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
] as const;

const E2E_WALLET_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'%3E%3Crect width='28' height='28' rx='6' fill='%23FCFF52'/%3E%3Ctext x='14' y='18' font-family='sans-serif' font-size='10' font-weight='bold' text-anchor='middle'%3EE2E%3C/text%3E%3C/svg%3E";

function shouldEagerConnect(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem(E2E_EAGER_CONNECT_STORAGE_KEY) === "true"
    );
  } catch {
    return false;
  }
}

export const e2eTestWallet = (): Wallet => ({
  id: E2E_TEST_WALLET_ID,
  name: "E2E Test Wallet",
  iconUrl: E2E_WALLET_ICON,
  iconBackground: "#FCFF52",
  createConnector: (walletDetails) =>
    createConnector((config) => ({
      ...mock({
        accounts: E2E_ACCOUNTS,
        features: {
          defaultConnected: shouldEagerConnect(),
          reconnect: true,
        },
      })(config),
      ...walletDetails,
    })),
});
