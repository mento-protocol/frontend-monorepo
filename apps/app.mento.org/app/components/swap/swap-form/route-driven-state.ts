export type RouteDrivenFormState = {
  amount: string;
  tokenInSymbol: string;
  tokenOutSymbol: string;
};

export type LastChangedToken = "from" | "to" | null;

export function hasRouteDrivenFormStateChanged(
  previousRouteState: RouteDrivenFormState | null,
  routeDrivenFormState: RouteDrivenFormState,
): boolean {
  return (
    !previousRouteState ||
    previousRouteState.amount !== routeDrivenFormState.amount ||
    previousRouteState.tokenInSymbol !== routeDrivenFormState.tokenInSymbol ||
    previousRouteState.tokenOutSymbol !== routeDrivenFormState.tokenOutSymbol
  );
}

export function getRouteChangedTokenSide(
  previousRouteState: RouteDrivenFormState | null,
  routeDrivenFormState: RouteDrivenFormState,
): LastChangedToken {
  if (!previousRouteState) {
    if (routeDrivenFormState.tokenInSymbol) return "from";
    if (routeDrivenFormState.tokenOutSymbol) return "to";
    return null;
  }

  if (previousRouteState.tokenInSymbol !== routeDrivenFormState.tokenInSymbol) {
    return "from";
  }

  if (
    previousRouteState.tokenOutSymbol !== routeDrivenFormState.tokenOutSymbol
  ) {
    return "to";
  }

  return routeDrivenFormState.tokenInSymbol &&
    routeDrivenFormState.tokenOutSymbol
    ? "from"
    : null;
}
