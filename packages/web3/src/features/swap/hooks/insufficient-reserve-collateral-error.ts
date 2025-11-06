/**
 * Custom error class for insufficient reserve collateral
 * Contains all information needed to display a user-friendly error message
 */
export class InsufficientReserveCollateralError extends Error {
  constructor(
    public readonly tokenSymbol: string,
    public readonly isZeroBalance: boolean,
    public readonly maxSwapAmount?: string,
    public readonly celoscanUrl?: string,
  ) {
    const message = isZeroBalance
      ? `The Reserve is currently out of ${tokenSymbol} and will be refilled soon.`
      : `Insufficient reserve collateral for ${tokenSymbol}`;
    super(message);
    this.name = "InsufficientReserveCollateralError";
  }
}
