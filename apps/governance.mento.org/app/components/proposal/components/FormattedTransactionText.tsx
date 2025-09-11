"use client";

import React, { useMemo, useState } from "react";
import { Transaction } from "../types/transaction";
import { useExplorerUrl } from "../utils/address-utils";
import { AddressParser } from "./AddressParser";
import { CodeStyler } from "./CodeStyler";

interface AddressReplacement {
  match: string;
  address: string;
  start: number;
  end: number;
}

interface FormattedTransactionTextProps {
  text: string;
  transaction?: Transaction;
}

/**
 * Component that parses text and:
 * 1. Converts addresses (both raw 0x... and friendly names) to clickable links
 * 2. Styles function names as code
 */
export function FormattedTransactionText({
  text,
  transaction,
}: FormattedTransactionTextProps) {
  const explorerUrl = useExplorerUrl();
  const [addressReplacements, setAddressReplacements] = useState<
    AddressReplacement[]
  >([]);

  const formattedElements = useMemo(() => {
    if (!text) return null;

    const elements: React.ReactNode[] = [];
    let keyCounter = 0;
    let lastEnd = 0;

    // Sort replacements by start position
    const sortedReplacements = [...addressReplacements].sort(
      (a, b) => a.start - b.start,
    );

    sortedReplacements.forEach((replacement) => {
      // Add text before this replacement (with code styling)
      if (replacement.start > lastEnd) {
        const beforeText = text.substring(lastEnd, replacement.start);
        elements.push(
          <CodeStyler
            key={`styled-${keyCounter++}`}
            text={beforeText}
            baseKey={keyCounter}
          />,
        );
      }

      // Add the clickable link
      elements.push(
        <a
          key={`link-${keyCounter++}`}
          href={`${explorerUrl}/address/${replacement.address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-bold underline-offset-4 hover:underline"
        >
          {replacement.match}
        </a>,
      );

      lastEnd = replacement.end;
    });

    // Add any remaining text (with code styling)
    if (lastEnd < text.length) {
      const remainingText = text.substring(lastEnd);
      elements.push(
        <CodeStyler
          key={`styled-${keyCounter++}`}
          text={remainingText}
          baseKey={keyCounter}
        />,
      );
    }

    return elements;
  }, [text, addressReplacements, explorerUrl]);

  return (
    <>
      <AddressParser
        text={text}
        transaction={transaction}
        onAddressFound={setAddressReplacements}
      />
      {formattedElements}
    </>
  );
}
