"use client";

import { useMemo } from "react";
import { Transaction } from "../types/transaction";
import { useAllContractMappings } from "../hooks/useContractRegistry";
import { decodeTransaction } from "../lib/decoder-utils";

interface AddressReplacement {
  match: string;
  address: string;
  start: number;
  end: number;
}

interface AddressParserProps {
  text: string;
  transaction?: Transaction;
  onAddressFound: (replacements: AddressReplacement[]) => void;
}

/**
 * Component that identifies addresses and friendly names in text for linking
 */
export function AddressParser({
  text,
  transaction,
  onAddressFound,
}: AddressParserProps) {
  const contractMappings = useAllContractMappings();

  const addressReplacements = useMemo(() => {
    const replacements: AddressReplacement[] = [];

    // Find raw addresses (both full and truncated)
    const fullAddressRegex = /0x[a-fA-F0-9]{40}/g;
    const truncatedAddressRegex = /0x[a-fA-F0-9]{4,6}\.\.\.[a-fA-F0-9]{4}/g;

    let addressMatch;

    // Find full addresses
    while ((addressMatch = fullAddressRegex.exec(text)) !== null) {
      replacements.push({
        match: addressMatch[0],
        address: addressMatch[0],
        start: addressMatch.index,
        end: addressMatch.index + addressMatch[0].length,
      });
    }

    // Find truncated addresses and try to resolve them
    if (transaction) {
      const addressMapping: Record<string, string> = {};

      // Add the contract address
      const contractTruncated = `${transaction.address.slice(0, 6)}...${transaction.address.slice(-4)}`;
      addressMapping[contractTruncated] = transaction.address;

      // Decode the transaction to get all addresses used in the call
      const decoded = decodeTransaction(transaction);
      if (decoded?.args) {
        decoded.args.forEach((arg) => {
          if (
            arg.type === "address" &&
            typeof arg.value === "string" &&
            arg.value.startsWith("0x") &&
            arg.value.length === 42
          ) {
            const truncated = `${arg.value.slice(0, 6)}...${arg.value.slice(-4)}`;
            addressMapping[truncated] = arg.value;
          }
        });
      }

      // Now find truncated addresses in text and map them
      while ((addressMatch = truncatedAddressRegex.exec(text)) !== null) {
        const truncatedAddr = addressMatch[0];
        const fullAddress = addressMapping[truncatedAddr];

        if (fullAddress) {
          // Make sure it doesn't overlap with existing replacements
          const overlaps = replacements.some(
            (existing) =>
              (addressMatch!.index >= existing.start &&
                addressMatch!.index < existing.end) ||
              (addressMatch!.index + addressMatch![0].length > existing.start &&
                addressMatch!.index + addressMatch![0].length <= existing.end),
          );

          if (!overlaps) {
            replacements.push({
              match: truncatedAddr,
              address: fullAddress,
              start: addressMatch.index,
              end: addressMatch.index + addressMatch[0].length,
            });
          }
        }
      }
    }

    return replacements;
  }, [text, transaction]);

  const friendlyNameReplacements = useMemo(() => {
    const replacements: AddressReplacement[] = [];

    // Create friendly name to address mapping
    const friendlyNameToAddress: Record<string, string> = {};

    contractMappings.forEach(({ name, address, friendlyName, symbol }) => {
      // Add the main name only for non-token contracts
      if (name && !name.includes("Token")) {
        friendlyNameToAddress[name] = address;
      }

      // Add the friendly name if it exists and meets criteria
      if (
        friendlyName &&
        !friendlyName.includes("rate feed") &&
        friendlyName.length > 5 &&
        !friendlyName.includes("MENTO")
      ) {
        friendlyNameToAddress[friendlyName] = address;
      }

      // Add symbols for tokens
      if (symbol && !symbol.includes("/") && symbol.length >= 3) {
        if (name?.includes("Token") || friendlyName?.includes("Token")) {
          friendlyNameToAddress[symbol] = address;
        } else if (!["MENTO", "CELO", "veMENTO"].includes(symbol)) {
          friendlyNameToAddress[symbol] = address;
        }
      }
    });

    // Sort friendly names by length (longest first)
    const sortedFriendlyNames = Object.keys(friendlyNameToAddress).sort(
      (a, b) => b.length - a.length,
    );

    sortedFriendlyNames.forEach((friendlyName) => {
      const regex = new RegExp(
        `\\b${friendlyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "g",
      );
      let nameMatch;
      while ((nameMatch = regex.exec(text)) !== null) {
        // Check for overlaps with addresses
        const overlapsWithAddress = addressReplacements.some(
          (addr) =>
            (nameMatch!.index >= addr.start && nameMatch!.index < addr.end) ||
            (nameMatch!.index + nameMatch![0].length > addr.start &&
              nameMatch!.index + nameMatch![0].length <= addr.end),
        );

        // Check for overlaps with existing friendly names
        const overlapsWithFriendlyName = replacements.some(
          (existing) =>
            (nameMatch!.index >= existing.start &&
              nameMatch!.index < existing.end) ||
            (nameMatch!.index + nameMatch![0].length > existing.start &&
              nameMatch!.index + nameMatch![0].length <= existing.end),
        );

        // Check if this is part of a rate feed name
        const isPartOfRateFeed = () => {
          const beforeText = text.substring(
            Math.max(0, nameMatch!.index - 10),
            nameMatch!.index,
          );
          const afterText = text.substring(
            nameMatch!.index + nameMatch![0].length,
            Math.min(text.length, nameMatch!.index + nameMatch![0].length + 20),
          );

          // Allow linking in pause/unpause contexts
          if (
            beforeText.match(/(pause|resume).*for\s*$/i) ||
            afterText.match(/^\s*(token|transfers)/i)
          ) {
            return false;
          }

          // Check if this appears to be part of a rate feed name
          return (
            afterText.match(/^\/[A-Z]{3,4}(\s+rate\s+feed)?/) ||
            beforeText.match(/rate\s+feed.*$/)
          );
        };

        if (
          !overlapsWithAddress &&
          !overlapsWithFriendlyName &&
          !isPartOfRateFeed()
        ) {
          const address = friendlyNameToAddress[friendlyName];
          if (address) {
            replacements.push({
              match: nameMatch[0],
              address,
              start: nameMatch.index,
              end: nameMatch.index + nameMatch[0].length,
            });
          }
        }
      }
    });

    return replacements;
  }, [text, contractMappings, addressReplacements]);

  // Combine and notify parent of all replacements
  useMemo(() => {
    const combined = [...addressReplacements, ...friendlyNameReplacements].sort(
      (a, b) => a.start - b.start,
    );
    onAddressFound(combined);
    return combined;
  }, [addressReplacements, friendlyNameReplacements, onAddressFound]);

  return null; // This is a utility component that doesn't render
}
