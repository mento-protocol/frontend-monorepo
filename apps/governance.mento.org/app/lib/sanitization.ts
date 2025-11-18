/**
 * Shared constants for HTML sanitization using DOMPurify
 * These tags are safe for rendering proposal content
 */
export const BASE_ALLOWED_TAGS: string[] = [
  "p",
  "br",
  "strong",
  "em",
  "u",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "a",
  "blockquote",
  "code",
  "pre",
];

/**
 * Additional tags that can be used in specific contexts
 */
export const ADDITIONAL_ALLOWED_TAGS = {
  hr: ["hr"],
} as const;

/**
 * Allowed attributes for HTML elements
 */
export const ALLOWED_ATTR: string[] = ["href", "target", "rel"];
