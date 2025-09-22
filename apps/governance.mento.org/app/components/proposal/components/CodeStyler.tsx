"use client";

import React from "react";

interface CodeStylerProps {
  text: string;
  baseKey: number;
}

/**
 * Component that identifies and styles code patterns in text
 */
export function CodeStyler({
  text,
  baseKey,
}: CodeStylerProps): React.ReactNode {
  // Function names (word followed by parentheses or after "Call"/"Execute")
  const codeRegex = /\b[a-zA-Z_]\w*(?=\()|(?<=Call )\w+|(?<=Execute )\w+/g;

  let match;
  const elements: React.ReactNode[] = [];
  let lastEnd = 0;
  let keyCounter = 0;

  while ((match = codeRegex.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastEnd) {
      elements.push(text.substring(lastEnd, match.index));
    }

    // Add the styled code
    elements.push(
      <code
        key={`code-${baseKey}-${keyCounter++}`}
        className="bg-muted rounded px-1 py-0.5 font-mono text-sm"
      >
        {match[0]}
      </code>,
    );

    lastEnd = match.index + match[0].length;
  }

  // Add any remaining text
  if (lastEnd < text.length) {
    elements.push(text.substring(lastEnd));
  }

  return elements.length === 1 && typeof elements[0] === "string"
    ? elements[0]
    : elements;
}
