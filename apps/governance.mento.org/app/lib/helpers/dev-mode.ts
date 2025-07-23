// Utility to handle dev mode URL parameter
// This allows enabling Alfajores on production via URL parameter

const DEV_MODE_PARAM = "dev";
const DEV_MODE_VALUE = "true";

/**
 * Check if dev mode is enabled via URL parameter
 */
export function isDevModeEnabled(): boolean {
  if (typeof window === "undefined") return false;

  const urlParams = new URLSearchParams(window.location.search);
  const devModeParam = urlParams.get(DEV_MODE_PARAM);

  return devModeParam === DEV_MODE_VALUE;
}
