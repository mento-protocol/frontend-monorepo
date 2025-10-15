import { isValidUrl } from "./is-valid-url";

// @public comment is to suppress invalid knip warning https://knip.dev/reference/jsdoc-tsdoc-tags#public
/** @public */
export function getUrlFromString(str: string) {
  if (isValidUrl(str)) {
    return str;
  }
  try {
    if (str.includes(".") && !str.includes(" ")) {
      return new URL(`https://${str}`).toString();
    }
  } catch {
    return null;
  }
}
