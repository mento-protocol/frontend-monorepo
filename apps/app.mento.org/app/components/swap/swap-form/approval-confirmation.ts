export function isCurrentSwapQuote({
  amountInWei,
  formQuote,
  formattedQuote,
  isFetching,
  quote,
  quotedAmountInWei,
}: {
  amountInWei: string;
  formQuote: string;
  formattedQuote: string;
  isFetching: boolean;
  quote: string;
  quotedAmountInWei: string;
}) {
  const numericQuote = Number(quote);

  return (
    !isFetching &&
    quotedAmountInWei === amountInWei &&
    Number.isFinite(numericQuote) &&
    numericQuote > 0 &&
    formQuote === formattedQuote
  );
}
