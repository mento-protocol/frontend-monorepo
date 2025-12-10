import { useSyncExternalStore, useCallback } from "react";

// @public comment is to suppress invalid knip warning https://knip.dev/reference/jsdoc-tsdoc-tags#public
/** @public */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", callback);
      window.addEventListener("resize", callback);
      return () => {
        media.removeEventListener("change", callback);
        window.removeEventListener("resize", callback);
      };
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    return window.matchMedia(query).matches;
  }, [query]);

  const getServerSnapshot = useCallback(() => {
    return false;
  }, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
