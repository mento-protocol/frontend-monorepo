"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, useDisconnect } from "@repo/web3/wagmi";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { toast } from "@repo/ui";
import { createLocalStore } from "@/lib/utils/local-store";

const isTestMode =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SANCTIONS_TEST_MODE === "true";

export function useSanctionsCheck() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const disconnectedAddress = useRef<string | null>(null);
  const blockedAddressStore = useMemo(
    () => createLocalStore<string | null>(null),
    [],
  );
  const blockedAddress = useSyncExternalStore(
    blockedAddressStore.subscribe,
    blockedAddressStore.getSnapshot,
    blockedAddressStore.getSnapshot,
  );

  const { data, isLoading, isError } = useQuery({
    queryKey: ["sanctions", address],
    queryFn: async () => {
      if (!address) throw new Error("No address");
      if (isTestMode) return { isSanctioned: true };
      const response = await fetch(
        `/api/sanctions?address=${encodeURIComponent(address)}`,
      );
      if (!response.ok) {
        throw new Error(`Sanctions check failed: ${response.status}`);
      }
      const result = await response.json();
      if (typeof result?.isSanctioned !== "boolean") {
        throw new Error("Sanctions check returned invalid response");
      }
      return result as { isSanctioned: boolean };
    },
    enabled: !!address && isConnected,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  // Sanctioned if: query says so, OR we're still showing the blocked screen
  // for the address that was just disconnected
  const isSanctioned =
    data?.isSanctioned === true ||
    (blockedAddress !== null && (!address || address === blockedAddress));
  const checkFailed = isError && !isLoading;
  const isChecking = isLoading && isConnected && !!address;

  useEffect(() => {
    if (
      data?.isSanctioned === true &&
      address &&
      disconnectedAddress.current !== address
    ) {
      disconnectedAddress.current = address;
      blockedAddressStore.set(address);
      disconnect();
      toast.error(
        "This address cannot use this application due to sanctions compliance.",
        { duration: Infinity },
      );
    }
  }, [address, blockedAddressStore, data?.isSanctioned, disconnect]);

  useEffect(() => {
    if (address && blockedAddress && address !== blockedAddress) {
      blockedAddressStore.set(null);
    }
  }, [address, blockedAddress, blockedAddressStore]);

  return { isSanctioned, isChecking, checkFailed };
}
