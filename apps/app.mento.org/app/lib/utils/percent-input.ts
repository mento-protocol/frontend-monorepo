const MIN_PERCENT = 0.1;
const MAX_PERCENT = 100;

/**
 * Sanitizes a raw input value for a percentage field (0.1–100).
 * Strips non-numeric chars, leading zeros, multiple dots, and clamps to MAX_PERCENT.
 */
export function sanitizePercentInput(inputValue: string): string {
  let raw = inputValue.replace(/[^0-9.]/g, "");
  raw = raw.replace(/^0+(?=\d)/, "");
  const dotIdx = raw.indexOf(".");
  if (dotIdx !== -1) {
    raw = raw.slice(0, dotIdx + 1) + raw.slice(dotIdx + 1).replace(/\./g, "");
  }
  const num = parseFloat(raw);
  if (!isNaN(num) && num >= MAX_PERCENT) raw = String(MAX_PERCENT);
  return raw;
}

/**
 * Normalizes a percentage value on blur: strips trailing dots and
 * clamps values below MIN_PERCENT up to MIN_PERCENT.
 * Returns null if the value is empty or unchanged.
 */
export function sanitizePercentOnBlur(value: string): string | null {
  if (value === "") return null;
  let corrected = value.replace(/\.$/, "");
  const pct = parseFloat(corrected);
  if (!isNaN(pct) && pct < MIN_PERCENT) {
    corrected = String(MIN_PERCENT);
  }
  return corrected !== value ? corrected : null;
}
