"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAtomValue } from "jotai";
import { chainIdToSlug, formValuesAtom, type ChainId } from "@repo/web3";
import { useChainId } from "@repo/web3/wagmi";

/**
 * Keeps the swap URL in sync with form state and wallet chain.
 * - Updates query params (from, to, amount) when form values change
 * - Navigates to new chain slug only when user actively switches chains
 *   (not on initial page load — respects deep link URLs)
 */
export function useSwapUrlSync(urlChainId: ChainId) {
  const router = useRouter();
  const pathname = usePathname();
  const walletChainId = useChainId();
  const formValues = useAtomValue(formValuesAtom);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevFormRef = useRef<{
    tokenInSymbol?: string;
    tokenOutSymbol?: string;
    amount?: string;
  }>({});

  // Track previous wallet chain to detect active chain switches vs initial mismatch
  const prevWalletChainRef = useRef<number>(walletChainId);

  // Sync form values → URL query params
  useEffect(() => {
    if (!pathname.startsWith("/swap/")) return;

    const tokenIn = formValues?.tokenInSymbol || "";
    const tokenOut = formValues?.tokenOutSymbol || "";
    const amount = formValues?.amount || "";

    const prev = prevFormRef.current;
    const tokensChanged =
      prev.tokenInSymbol !== tokenIn || prev.tokenOutSymbol !== tokenOut;
    const amountChanged = prev.amount !== amount;

    if (!tokensChanged && !amountChanged) return;

    prevFormRef.current = {
      tokenInSymbol: tokenIn,
      tokenOutSymbol: tokenOut,
      amount,
    };

    const buildUrl = () => {
      const chainSlug = chainIdToSlug(urlChainId) || "celo";
      const params = new URLSearchParams();
      if (tokenIn) params.set("from", tokenIn);
      if (tokenOut) params.set("to", tokenOut);
      if (amount && amount !== "0") params.set("amount", amount);

      const query = params.toString();
      return `/swap/${chainSlug}${query ? `?${query}` : ""}`;
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

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [
    formValues?.tokenInSymbol,
    formValues?.tokenOutSymbol,
    formValues?.amount,
    urlChainId,
    pathname,
    router,
  ]);

  // Navigate to new chain slug only when user actively switches wallet chain
  useEffect(() => {
    if (!pathname.startsWith("/swap/")) return;

    const prevWalletChain = prevWalletChainRef.current;
    prevWalletChainRef.current = walletChainId;

    // Only navigate if the wallet chain actually changed (user switched chains),
    // not on initial load where wallet and URL chain may differ (deep link)
    if (prevWalletChain === walletChainId) return;

    const newSlug = chainIdToSlug(walletChainId);
    if (!newSlug) return;

    const tokenIn = formValues?.tokenInSymbol || "";
    const tokenOut = formValues?.tokenOutSymbol || "";
    const params = new URLSearchParams();
    if (tokenIn) params.set("from", tokenIn);
    if (tokenOut) params.set("to", tokenOut);

    const query = params.toString();
    router.replace(`/swap/${newSlug}${query ? `?${query}` : ""}`);
  }, [
    walletChainId,
    pathname,
    router,
    formValues?.tokenInSymbol,
    formValues?.tokenOutSymbol,
  ]);
}
