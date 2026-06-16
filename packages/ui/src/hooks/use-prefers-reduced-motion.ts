import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

// @public comment suppresses the invalid knip unused-export warning
// https://knip.dev/reference/jsdoc-tsdoc-tags#public
/** @public */
export function usePrefersReducedMotion(): boolean {
  // Lazy initializer reads the real value on the FIRST client render, so
  // animation-gated props (e.g. recharts `isAnimationActive`) are never forced
  // on for a frame under reduced motion. SSR yields `false`, but chart content
  // is client-only (recharts needs measured dimensions), so there's no
  // meaningful hydration mismatch.
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const onChange = () => setReduced(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
