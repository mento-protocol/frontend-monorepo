import { ApolloLink } from "@apollo/client";
import { catchError, mergeMap, of, throwError } from "rxjs";
import { isPrimaryUnavailable } from "./graph-gateway";

// Context key the fallback link sets on the retried operation. Downstream
// links (endpoint resolution, auth) read it to pick the fallback URL.
export const SUBGRAPH_FALLBACK_CONTEXT_KEY = "subgraphFallback";

interface SubgraphFallbackLinkOptions {
  /** `apiName` context values that have a fallback configured. */
  apiNames: ReadonlyArray<string>;
  /** Unset disables the link entirely; operations pass straight through. */
  enabled: boolean;
}

/**
 * Retries an eligible operation exactly once against the fallback endpoint
 * when the primary is unavailable. Sits *upstream* of the auth and HTTP
 * links, so the retry re-runs them with the fallback context set — the
 * endpoint resolver picks the fallback URL and the auth link, keying off
 * that URL's host, withholds the gateway key from a Studio destination.
 *
 * At most one retry per operation: if the fallback also fails, its result
 * (or error) is what the caller sees.
 */
export function createSubgraphFallbackLink({
  apiNames,
  enabled,
}: SubgraphFallbackLinkOptions): ApolloLink {
  return new ApolloLink((operation, forward) => {
    const context = operation.getContext();
    const eligible =
      enabled &&
      !context[SUBGRAPH_FALLBACK_CONTEXT_KEY] &&
      apiNames.includes(context.apiName);

    const primary$ = forward(operation);
    if (!eligible) return primary$;

    let retried = false;
    const retryOnFallback = () => {
      if (retried) return null;
      retried = true;
      operation.setContext({ [SUBGRAPH_FALLBACK_CONTEXT_KEY]: true });
      return forward(operation);
    };

    return primary$.pipe(
      // Transport failure on the primary (5xx, DNS, reset).
      catchError(
        (error: unknown) => retryOnFallback() ?? throwError(() => error),
      ),
      // "Successful" response that carries only an unavailability error.
      mergeMap((result) =>
        isPrimaryUnavailable(result)
          ? (retryOnFallback() ?? of(result))
          : of(result),
      ),
    );
  });
}
