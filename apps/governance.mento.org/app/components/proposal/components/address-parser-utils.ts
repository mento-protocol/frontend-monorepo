/**
 * Check if a friendly name is part of a slash-separated pair or rate feed.
 */
export function isPartOfTokenPairOrRateFeed(
  text: string,
  match: RegExpExecArray,
): boolean {
  const beforeText = text.substring(Math.max(0, match.index - 20), match.index);
  const afterText = text.substring(
    match.index + match[0].length,
    Math.min(text.length, match.index + match[0].length + 20),
  );

  const isPartOfTokenPair =
    Boolean(afterText.match(/^\/[A-Z]{3,4}(\s+rate\s+feed)?/i)) ||
    Boolean(beforeText.match(/[A-Z]{3,4}\/$/i));

  if (isPartOfTokenPair) {
    return true;
  }

  // Allow linking in pause/unpause contexts
  if (
    beforeText.match(/(pause|resume).*for\s*$/i) ||
    afterText.match(/^\s*(token|transfers)/i)
  ) {
    return false;
  }

  return (
    Boolean(beforeText.match(/rate\s+feed.*$/i)) ||
    Boolean(afterText.match(/^\s+rate\s+feed/i)) ||
    Boolean(beforeText.match(/[A-Z]{3,4}\/[A-Z]{3,4}\s+rate\s+feed.*$/i)) ||
    Boolean(afterText.match(/^[A-Z]{3,4}\/[A-Z]{3,4}\s+rate\s+feed/i))
  );
}
