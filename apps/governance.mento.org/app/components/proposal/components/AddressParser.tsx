"use client";

import { useMemo, useEffect } from "react";
import { isAddress } from "viem";
import { Transaction, DecodedTransaction } from "../types/transaction";
import {
  useAllContractMappings,
  getContractInfo,
} from "../hooks/useContractRegistry";

interface AddressReplacement {
  match: string;
  address: string;
  start: number;
  end: number;
}

interface AddressParserProps {
  text: string;
  transaction?: Transaction;
  decodedTransaction?: DecodedTransaction;
  onAddressFound: (replacements: AddressReplacement[]) => void;
}

/**
 * Component that identifies addresses and friendly names in text for linking
 */
export function AddressParser({
  text,
  transaction,
  decodedTransaction,
  onAddressFound,
}: AddressParserProps) {
  const contractMappings = useAllContractMappings();

  const allReplacements = useMemo(() => {
    const fullAddresses = findFullAddresses(text);
    const truncatedAddresses = findTruncatedAddresses(
      text,
      transaction,
      decodedTransaction,
    );
    const friendlyNames = findFriendlyNameMatches(
      text,
      contractMappings,
      transaction,
    );
    // Combine all replacements and sort by position
    const combined = [
      ...fullAddresses,
      ...truncatedAddresses,
      ...friendlyNames,
    ];

    // Remove overlaps (prioritize earlier matches)
    const finalReplacements: AddressReplacement[] = [];

    combined.forEach((replacement) => {
      if (!hasOverlap(replacement.start, replacement.end, finalReplacements)) {
        finalReplacements.push(replacement);
      }
    });

    return finalReplacements.sort((a, b) => a.start - b.start);
  }, [text, transaction, contractMappings]);

  // Notify parent of all replacements
  useEffect(() => {
    onAddressFound(allReplacements);
  }, [allReplacements, onAddressFound]);

  return null; // This is a utility component that doesn't render
}

/**
 * Find friendly name matches in text
 */
function findFriendlyNameMatches(
  text: string,
  contractMappings: Array<{
    name: string;
    address: string;
    friendlyName?: string;
    symbol?: string;
  }>,
  transaction?: Transaction,
): AddressReplacement[] {
  const friendlyNameMapping = buildFriendlyNameMapping(
    contractMappings,
    transaction,
  );

  // Sort by length (longest first) to avoid partial matches
  const sortedNames = Object.keys(friendlyNameMapping).sort(
    (a, b) => b.length - a.length,
  );

  const replacements: AddressReplacement[] = [];

  sortedNames.forEach((friendlyName) => {
    const regex = new RegExp(
      `\\b${friendlyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "g",
    );

    const matches = findAllMatches(text, regex);

    matches.forEach((match) => {
      const start = match.index;
      const end = start + match[0].length;

      // Skip if it overlaps with existing replacements
      if (hasOverlap(start, end, replacements)) {
        return;
      }

      // Skip if it's part of a rate feed name
      if (isPartOfRateFeed(text, match)) {
        return;
      }

      const address = friendlyNameMapping[friendlyName];
      if (address) {
        replacements.push(createReplacement(match, address));
      }
    });
  });

  return replacements;
}

/**
 * Find full Ethereum addresses in text
 */
function findFullAddresses(text: string): AddressReplacement[] {
  const potentialAddressRegex = /0x[a-fA-F0-9]{4,40}/g;
  const matches = findAllMatches(text, potentialAddressRegex);

  return matches
    .filter((match) => {
      const address = match[0];
      return address.length === 42 && isAddress(address);
    })
    .map((match) => createReplacement(match, match[0]));
}

/**
 * Find truncated addresses and resolve them using transaction context and decoded arguments
 */
function findTruncatedAddresses(
  text: string,
  transaction?: Transaction,
  decodedTransaction?: DecodedTransaction,
): AddressReplacement[] {
  if (!transaction) return [];

  const truncatedAddressRegex = /0x[a-fA-F0-9]{4,6}\.\.\.[a-fA-F0-9]{4}/g;
  const matches = findAllMatches(text, truncatedAddressRegex);

  const addressMapping: Record<string, string> = {};

  // Add transaction address mapping
  const contractTruncated = `${transaction.address.slice(0, 6)}...${transaction.address.slice(-4)}`;
  addressMapping[contractTruncated] = transaction.address;

  // Add oracle addresses from decoded transaction arguments
  if (decodedTransaction?.args) {
    decodedTransaction.args.forEach((arg) => {
      if (
        typeof arg.value === "string" &&
        arg.value.startsWith("0x") &&
        arg.value.length === 42
      ) {
        const fullAddress = arg.value;
        const truncated = `${fullAddress.slice(0, 6)}...${fullAddress.slice(-4)}`;
        addressMapping[truncated] = fullAddress;
      }
    });
  }

  // Fallback: Try to find oracle addresses in the text
  // This is a heuristic approach - we look for full addresses in the text
  // and try to match them with truncated addresses
  const fullAddressRegex = /0x[a-fA-F0-9]{40}/g;
  const fullAddressMatches = findAllMatches(text, fullAddressRegex);

  fullAddressMatches.forEach((fullMatch) => {
    const fullAddress = fullMatch[0];
    const truncated = `${fullAddress.slice(0, 6)}...${fullAddress.slice(-4)}`;
    addressMapping[truncated] = fullAddress;
  });

  return matches
    .filter((match) => {
      const truncatedAddr = match[0];
      return addressMapping[truncatedAddr];
    })
    .map((match) => createReplacement(match, addressMapping[match[0]]!));
}

/**
 * Utility function to check if a replacement overlaps with existing replacements
 */
function hasOverlap(
  start: number,
  end: number,
  existingReplacements: AddressReplacement[],
): boolean {
  return existingReplacements.some(
    (existing) => start < end && existing.start < existing.end,
  );
}

/**
 * Utility function to find all matches for a regex pattern
 */
function findAllMatches(text: string, regex: RegExp): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push(match);
  }
  return matches;
}

/**
 * Utility function to create a replacement from a regex match
 */
function createReplacement(
  match: RegExpExecArray,
  address: string,
): AddressReplacement {
  return {
    match: match[0],
    address,
    start: match.index,
    end: match.index + match[0].length,
  };
}

/**
 * Build friendly name to address mapping from contract registry
 */
function buildFriendlyNameMapping(
  contractMappings: Array<{
    name: string;
    address: string;
    friendlyName?: string;
    symbol?: string;
  }>,
  transaction?: Transaction,
): Record<string, string> {
  const mapping: Record<string, string> = {};

  contractMappings.forEach(({ name, address, friendlyName, symbol }) => {
    // Add main name for non-token contracts, but exclude rate feed IDs
    if (name && !name.includes("Token") && !isRateFeedId(name)) {
      mapping[name] = address;
    }

    // Add friendly name if it meets criteria
    if (
      friendlyName &&
      !isRateFeedId(friendlyName) &&
      friendlyName.length > 5 &&
      !friendlyName.includes("MENTO")
    ) {
      mapping[friendlyName] = address;
    }

    // Add symbols for tokens
    if (symbol && !symbol.includes("/") && symbol.length >= 3) {
      if (name?.includes("Token") || friendlyName?.includes("Token")) {
        mapping[symbol] = address;
      } else if (!["MENTO", "CELO", "veMENTO"].includes(symbol)) {
        mapping[symbol] = address;
      }
    }
  });

  // Add contract names from transaction context
  if (transaction) {
    const contractInfo = getContractInfo(transaction.address);
    if (contractInfo?.name && !isRateFeedId(contractInfo.name)) {
      mapping[contractInfo.name] = transaction.address;
    }
    if (
      contractInfo?.friendlyName &&
      !isRateFeedId(contractInfo.friendlyName)
    ) {
      mapping[contractInfo.friendlyName] = transaction.address;
    }
  }

  return mapping;
}

/**
 * Check if a name is a rate feed ID (should not be linked)
 * Rate feed IDs are descriptive names like "CELO/ETH rate feed"
 * Contract names like "SortedOracles" should still be linked
 */
function isRateFeedId(name: string): boolean {
  // Rate feed IDs typically contain "rate feed" and have a pattern like "TOKEN1/TOKEN2 rate feed"
  return (
    name.includes("rate feed") &&
    /^[A-Z]{3,4}\/[A-Z]{3,4}\s+rate\s+feed$/i.test(name)
  );
}

/**
 * Check if a friendly name match is part of a rate feed name
 */
function isPartOfRateFeed(text: string, match: RegExpExecArray): boolean {
  const beforeText = text.substring(Math.max(0, match.index - 20), match.index);
  const afterText = text.substring(
    match.index + match[0].length,
    Math.min(text.length, match.index + match[0].length + 20),
  );

  // Allow linking in pause/unpause contexts
  if (
    beforeText.match(/(pause|resume).*for\s*$/i) ||
    afterText.match(/^\s*(token|transfers)/i)
  ) {
    return false;
  }

  // Check if this appears to be part of a rate feed name
  // Look for patterns like "CELO/ETH rate feed", "rate feed", etc.
  return (
    Boolean(afterText.match(/^\/[A-Z]{3,4}(\s+rate\s+feed)?/i)) ||
    Boolean(beforeText.match(/rate\s+feed.*$/i)) ||
    Boolean(afterText.match(/^\s+rate\s+feed/i)) ||
    Boolean(beforeText.match(/[A-Z]{3,4}\/[A-Z]{3,4}\s+rate\s+feed.*$/i)) ||
    Boolean(afterText.match(/^[A-Z]{3,4}\/[A-Z]{3,4}\s+rate\s+feed/i))
  );
}
