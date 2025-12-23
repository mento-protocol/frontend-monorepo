import { useSyncExternalStore } from "react";

// @public comment is to suppress invalid knip warning https://knip.dev/reference/jsdoc-tsdoc-tags#public
/** @public */
export function useIsSsr() {
  return useSyncExternalStore(
    () => () => {}, // Empty subscribe
    () => false, // Client always returns false (not SSR)
    () => true, // Server always returns true (is SSR)
  );
}
