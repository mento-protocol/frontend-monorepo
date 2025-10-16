import { useEffect, useRef } from "react";

// https://usehooks-typescript.com/react-hook/use-interval
// @public comment is to suppress invalid knip warning https://knip.dev/reference/jsdoc-tsdoc-tags#public
/** @public */
export function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef<() => void | null>(null);

  // Remember the latest callback.
  useEffect(() => {
    savedCallback.current = callback;
  });

  // Set up the interval.
  useEffect(() => {
    const tick = () => {
      if (
        typeof savedCallback?.current !== "undefined" &&
        savedCallback?.current
      ) {
        savedCallback?.current();
      }
    };

    if (delay !== null) {
      const id = setInterval(tick, delay);
      return () => clearInterval(id);
    }

    return undefined;
  }, [delay]);
}

export async function fetchWithTimeout(
  resource: RequestInfo,
  options?: RequestInit,
  timeout = 10000,
) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const response = await fetch(resource, {
    ...options,
    signal: controller.signal,
  });
  clearTimeout(id);
  return response;
}

export function sleep(milliseconds: number) {
  return new Promise((resolve) =>
    setTimeout(() => resolve(true), milliseconds),
  );
}
