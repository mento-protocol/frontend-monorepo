"use client";

import { useState, useEffect, useRef } from "react";
import * as Sentry from "@sentry/nextjs";
import { Check, ClipboardCopy } from "lucide-react";
import type { V2AddressesResponse } from "@/lib/types";
import { chainLabel } from "@/lib/chains";

function getAddressUrl(chain: string, address: string): string {
  // DeBank only indexes EVM chains; send native Bitcoin addresses to a
  // Bitcoin block explorer instead of a dead DeBank profile URL.
  if (chain === "bitcoin") {
    return `https://blockstream.info/address/${address}`;
  }
  return `https://debank.com/profile/${address}`;
}

function getAddressLinkTitle(chain: string): string {
  if (chain === "bitcoin") return "View address on Blockstream";
  return "View DeFi portfolio and positions on DeBank";
}

export function AddressesTab({
  addresses,
}: {
  addresses: V2AddressesResponse;
}) {
  const [copiedAddresses, setCopiedAddresses] = useState<Set<string>>(
    new Set(),
  );
  const copyTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  useEffect(() => {
    const timeouts = copyTimeoutsRef.current;
    return () => {
      timeouts.forEach((timeout) => clearTimeout(timeout));
      timeouts.clear();
    };
  }, []);

  const handleCopyAddress = async (
    address: string,
    key: string,
    context: { chain: string; category: string },
  ) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddresses((prev) => new Set(prev).add(key));

      const existingTimeout = copyTimeoutsRef.current.get(key);
      if (existingTimeout) clearTimeout(existingTimeout);

      const timeoutId = setTimeout(() => {
        setCopiedAddresses((prev) => {
          const newSet = new Set(prev);
          newSet.delete(key);
          return newSet;
        });
        copyTimeoutsRef.current.delete(key);
      }, 500);

      copyTimeoutsRef.current.set(key, timeoutId);
    } catch (error) {
      Sentry.captureException(error, {
        tags: {
          feature: "reserve_addresses_copy",
          chain: context.chain,
        },
        extra: {
          address,
          category: context.category,
        },
      });
    }
  };

  return (
    <div className="gap-4 md:gap-8 flex h-full flex-col">
      <h2 className="text-2xl font-medium md:block hidden">
        Reserve Addresses
      </h2>

      <div className="gap-2 flex flex-col">
        {addresses.networks.map((network) => (
          <div key={network.chain} className="gap-2 md:flex-row flex flex-col">
            {network.categories.map((cat, catIndex) => (
              <div
                key={`${network.chain}-${cat.category}-${catIndex}`}
                className="p-4 md:p-8 flex-1 bg-[#15111b]"
              >
                <h3 className="mb-6 text-xl font-medium leading-tight md:mb-8 md:text-2xl text-[#f7f6fa]">
                  {cat.category} on {chainLabel(network.chain)}
                </h3>
                <div className="gap-6 flex flex-col">
                  {cat.addresses.map((addr, addrIndex) => {
                    const uniqueKey = `${network.chain}-${cat.category}-${addr.address}`;
                    return (
                      <div
                        key={`${addr.address}-${addrIndex}`}
                        className="gap-0 flex flex-col"
                      >
                        {addr.label && (
                          <span className="text-sm font-medium text-muted-foreground">
                            {addr.label}
                          </span>
                        )}
                        <div className="gap-3 flex items-center">
                          <a
                            href={getAddressUrl(network.chain, addr.address)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-base leading-relaxed break-all text-[#8c35fd] underline transition-colors hover:text-[#a855f7]"
                            title={getAddressLinkTitle(network.chain)}
                          >
                            {addr.address}
                          </a>
                          <button
                            onClick={() =>
                              handleCopyAddress(addr.address, uniqueKey, {
                                chain: network.chain,
                                category: cat.category,
                              })
                            }
                            aria-label={`Copy address ${addr.address}`}
                            className="h-4 w-4 shrink-0 cursor-copy opacity-60 hover:opacity-100"
                          >
                            {copiedAddresses.has(uniqueKey) ? (
                              <Check className="h-4 w-4 text-green-500" />
                            ) : (
                              <ClipboardCopy className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                        {addr.description && (
                          <span className="text-xs text-muted-foreground">
                            {addr.description}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
