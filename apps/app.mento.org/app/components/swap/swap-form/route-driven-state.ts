export type RouteDrivenFormState = {
  amount: string;
  tokenInSymbol: string;
  tokenOutSymbol: string;
};

export type LastChangedToken = "from" | "to" | null;

type RouteDrivenFormValues = {
  amount: string;
  quote: string;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  slippage?: string;
};

export type RouteDrivenFormStateSyncPlan =
  | { shouldReset: false }
  | {
      shouldReset: true;
      resetValues: RouteDrivenFormValues;
      routeChangedTokenSide: LastChangedToken;
    };

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

export function getRouteDrivenFormStateSyncPlan({
  currentValues,
  formValuesSlippage,
  previousRouteState,
  routeDrivenFormState,
}: {
  currentValues: RouteDrivenFormValues;
  formValuesSlippage?: string;
  previousRouteState: RouteDrivenFormState | null;
  routeDrivenFormState: RouteDrivenFormState;
}): RouteDrivenFormStateSyncPlan {
  const routeStateChanged = hasRouteDrivenFormStateChanged(
    previousRouteState,
    routeDrivenFormState,
  );

  if (!routeStateChanged) {
    return { shouldReset: false };
  }

  const formAlreadyMatchesRoute =
    currentValues.amount === routeDrivenFormState.amount &&
    currentValues.tokenInSymbol === routeDrivenFormState.tokenInSymbol &&
    currentValues.tokenOutSymbol === routeDrivenFormState.tokenOutSymbol;

  if (formAlreadyMatchesRoute) {
    return { shouldReset: false };
  }

  return {
    shouldReset: true,
    resetValues: {
      ...currentValues,
      amount: routeDrivenFormState.amount,
      quote: "",
      tokenInSymbol: routeDrivenFormState.tokenInSymbol,
      tokenOutSymbol: routeDrivenFormState.tokenOutSymbol,
      slippage: currentValues.slippage || formValuesSlippage || "0.3",
    },
    routeChangedTokenSide: getRouteChangedTokenSide(
      previousRouteState,
      routeDrivenFormState,
    ),
  };
}
