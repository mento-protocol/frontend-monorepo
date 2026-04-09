"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, useDisconnect } from "wagmi";
import { useEffect, useRef } from "react";
import { toast } from "@repo/ui";

export function useSanctionsCheck() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const hasDisconnected = useRef(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["sanctions", address],
    queryFn: async () => {
      if (!address) throw new Error("No address");
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

  const isSanctioned = data?.isSanctioned === true;
  const checkFailed = isError && !isLoading;
  const isChecking = isLoading && isConnected && !!address;

  useEffect(() => {
    if (isSanctioned && !hasDisconnected.current) {
      hasDisconnected.current = true;
      disconnect();
      toast.error(
        "This address cannot use this application due to sanctions compliance.",
        { duration: Infinity },
      );
    }
  }, [isSanctioned, disconnect]);

  useEffect(() => {
    if (!isConnected && !isSanctioned) {
      hasDisconnected.current = false;
    }
  }, [isConnected, isSanctioned]);

  return { isSanctioned, isChecking, checkFailed };
}
