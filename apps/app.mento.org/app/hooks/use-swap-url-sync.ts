"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  ChainId,
  chainIdToSlug,
  getPreferredVisibleChain,
  useTestnetMode,
  type ChainId as AppChainId,
} from "@repo/web3";
import { useChainId } from "@repo/web3/wagmi";

/**
 * Keeps the swap URL in sync with form state and wallet chain.
 * - Updates query params (from, to, amount) when form values change
 * - Navigates to new chain slug only when user actively switches chains
 *   (not on initial page load — respects deep link URLs)
 */
export function useSwapUrlSync({
  amount,
  tokenInSymbol,
  tokenOutSymbol,
  urlChainId,
}: {
  amount?: string;
  tokenInSymbol?: string;
  tokenOutSymbol?: string;
  urlChainId: AppChainId;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const walletChainId = useChainId();
  const [testnetMode] = useTestnetMode();

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInitializedRef = useRef(false);
  const prevFormRef = useRef<{
    tokenInSymbol?: string;
    tokenOutSymbol?: string;
    amount?: string;
  }>({
    tokenInSymbol: searchParams.get("from") || "",
    tokenOutSymbol: searchParams.get("to") || "",
    amount: searchParams.get("amount") || "",
  });

  // Track previous wallet chain to detect active chain switches vs initial mismatch
  const prevWalletChainRef = useRef<number>(walletChainId);

  // Sync form values → URL query params
  useEffect(() => {
    if (!pathname.startsWith("/swap/")) return;
    if (
      typeof tokenInSymbol === "undefined" &&
      typeof tokenOutSymbol === "undefined" &&
      typeof amount === "undefined"
    ) {
      return;
    }

    const tokenIn = tokenInSymbol || "";
    const tokenOut = tokenOutSymbol || "";
    const nextAmount = amount || "";

    const buildUrl = () => {
      const chainSlug = chainIdToSlug(urlChainId) || "celo";
      const params = new URLSearchParams();
      if (tokenIn) params.set("from", tokenIn);
      if (tokenOut) params.set("to", tokenOut);
      if (nextAmount && nextAmount !== "0") params.set("amount", nextAmount);

      const query = params.toString();
      return `/swap/${chainSlug}${query ? `?${query}` : ""}`;
    };

    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      prevFormRef.current = {
        tokenInSymbol: tokenIn,
        tokenOutSymbol: tokenOut,
        amount: nextAmount,
      };

      const urlTokenIn = searchParams.get("from") || "";
      const urlTokenOut = searchParams.get("to") || "";
      const urlAmount = searchParams.get("amount") || "";
      const hasIncomingQuery = !!(urlTokenIn || urlTokenOut || urlAmount);
      const urlMatchesForm =
        urlTokenIn === tokenIn &&
        urlTokenOut === tokenOut &&
        urlAmount === nextAmount;

      if (!hasIncomingQuery || urlMatchesForm) return;

      router.replace(buildUrl());
      return;
    }

    const prev = prevFormRef.current;
    const tokensChanged =
      prev.tokenInSymbol !== tokenIn || prev.tokenOutSymbol !== tokenOut;
    const amountChanged = prev.amount !== nextAmount;

    if (!tokensChanged && !amountChanged) return;

    prevFormRef.current = {
      tokenInSymbol: tokenIn,
      tokenOutSymbol: tokenOut,
      amount: nextAmount,
    };

    if (tokensChanged) {
      // Token changes update immediately
      if (debounceRef.current) clearTimeout(debounceRef.current);
      router.replace(buildUrl());
    } else if (amountChanged) {
      // Amount changes are debounced to avoid URL thrashing while typing
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        router.replace(buildUrl());
      }, 300);
    }
  }, [
    tokenInSymbol,
    tokenOutSymbol,
    amount,
    urlChainId,
    pathname,
    router,
    searchParams,
  ]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Navigate to new chain slug only when user actively switches wallet chain
  useEffect(() => {
    if (!pathname.startsWith("/swap/")) return;

    const prevWalletChain = prevWalletChainRef.current;
    prevWalletChainRef.current = walletChainId;

    // Only navigate if the wallet chain actually changed (user switched chains),
    // not on initial load where wallet and URL chain may differ (deep link)
    if (prevWalletChain === walletChainId) return;

    const routeChainId = getPreferredVisibleChain({
      chainId: walletChainId,
      feature: "swap",
      testnetMode,
      fallbackChainId: ChainId.Celo,
    });
    const newSlug = chainIdToSlug(routeChainId);
    if (!newSlug) return;

    const tokenIn = tokenInSymbol || "";
    const tokenOut = tokenOutSymbol || "";
    const nextAmount = amount || "";
    const params = new URLSearchParams();
    if (tokenIn) params.set("from", tokenIn);
    if (tokenOut) params.set("to", tokenOut);
    if (nextAmount && nextAmount !== "0") params.set("amount", nextAmount);

    const query = params.toString();
    router.replace(`/swap/${newSlug}${query ? `?${query}` : ""}`);
  }, [
    walletChainId,
    pathname,
    router,
    tokenInSymbol,
    tokenOutSymbol,
    amount,
    testnetMode,
  ]);
}
