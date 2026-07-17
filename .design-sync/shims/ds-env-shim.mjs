// Injected via cfg.extraEntries so it evaluates when the IIFE bundle loads,
// BEFORE any component renders. The shipped @mento-protocol/ui dist reads
// `process.env.NEXT_PUBLIC_*` at render time (Next.js inlines these in the real
// app). In a plain browser / design-agent runtime `process` is undefined and
// those reads throw `ReferenceError: process is not defined` (observed in
// CommunityCard). Define a benign shim so the bundle is self-sufficient.
const g = globalThis;
g.process = g.process || {};
g.process.env = g.process.env || {};
if (g.process.env.NEXT_PUBLIC_STORAGE_URL == null)
  g.process.env.NEXT_PUBLIC_STORAGE_URL = "";
if (g.process.env.NEXT_PUBLIC_USE_FORK == null)
  g.process.env.NEXT_PUBLIC_USE_FORK = "";

export const __dsEnvShim = true;
