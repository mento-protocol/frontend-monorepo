"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, useDisconnect } from "wagmi";
import { useEffect, useRef, useState } from "react";
import { toast } from "@repo/ui";

export function useSanctionsCheck() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const disconnectedAddress = useRef<string | null>(null);
  const [blocked, setBlocked] = useState(false);

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

  const isSanctioned = data?.isSanctioned === true || blocked;
  const checkFailed = isError && !isLoading;
  const isChecking = isLoading && isConnected && !!address;

  useEffect(() => {
    if (
      data?.isSanctioned === true &&
      address &&
      disconnectedAddress.current !== address
    ) {
      disconnectedAddress.current = address;
      setBlocked(true);
      disconnect();
      toast.error(
        "This address cannot use this application due to sanctions compliance.",
        { duration: Infinity },
      );
    }
  }, [data?.isSanctioned, address, disconnect]);

  return { isSanctioned, isChecking, checkFailed };
}
