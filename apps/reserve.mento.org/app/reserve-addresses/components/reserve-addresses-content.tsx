"use client";

import { useState, useEffect, useRef } from "react";
import { AddressSection } from "../../components/address-section";
import * as Sentry from "@sentry/nextjs";
import type { ReserveAddressesResponse } from "../../lib/types";

interface ReserveAddressesContentProps {
  reserveAddresses: ReserveAddressesResponse;
}

export function ReserveAddressesContent({
  reserveAddresses,
}: ReserveAddressesContentProps) {
  const [copiedAddresses, setCopiedAddresses] = useState<Set<string>>(
    new Set(),
  );

  // Track active timeouts to prevent memory leaks
  const copyTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Constants
  const CLIPBOARD_COPY_FEEDBACK_DURATION = 500;

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      copyTimeoutsRef.current.forEach((timeout) => {
        clearTimeout(timeout);
      });
      copyTimeoutsRef.current.clear();
    };
  }, []);

  // Function to get DeBank portfolio URL for any address
  const getDebankUrl = (address: string): string => {
    return `https://debank.com/profile/${address}`;
  };

  const handleCopyAddress = async (
    address: string,
    category: string,
    network: string,
  ) => {
    try {
      await navigator.clipboard.writeText(address);
      const uniqueKey = `${category}-${network}-${address}`;
      setCopiedAddresses((prev) => new Set(prev).add(uniqueKey));

      // Clear any existing timeout for this address
      const existingTimeout = copyTimeoutsRef.current.get(uniqueKey);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      // Remove the copied state after the feedback duration
      const timeoutId = setTimeout(() => {
        setCopiedAddresses((prev) => {
          const newSet = new Set(prev);
          newSet.delete(uniqueKey);
          return newSet;
        });
        // Clean up the timeout reference
        copyTimeoutsRef.current.delete(uniqueKey);
      }, CLIPBOARD_COPY_FEEDBACK_DURATION);

      // Store the timeout reference
      copyTimeoutsRef.current.set(uniqueKey, timeoutId);
    } catch (error) {
      Sentry.captureException(error, {
        tags: {
          operation: "clipboard_copy",
          category,
          network,
        },
        extra: {
          address,
        },
      });
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 md:gap-8">
      <div className="flex flex-col gap-2">
        <AddressSection
          groups={reserveAddresses.addresses.filter(
            (group) => group.category === "Mento Reserve",
          )}
          getDebankUrl={getDebankUrl}
          handleCopyAddress={handleCopyAddress}
          copiedAddresses={copiedAddresses}
        />

        <AddressSection
          groups={reserveAddresses.addresses.filter(
            (group) => group.category !== "Mento Reserve",
          )}
          getDebankUrl={getDebankUrl}
          handleCopyAddress={handleCopyAddress}
          copiedAddresses={copiedAddresses}
        />
      </div>
    </div>
  );
}
