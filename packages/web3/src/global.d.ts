declare module "@metamask/jazzicon" {
  /**
   * Generates a Jazzicon SVG element.
   * @param diameter The width/height of the square icon in pixels.
   * @param seed A deterministic integer seed (e.g., derived from an address).
   * @returns The root `HTMLElement` containing the generated SVG.
   */
  export default function jazzicon(diameter: number, seed: number): HTMLElement;
}

/**
 * Minimal type definitions for the `toformat` utility, which decorates a
 * formatting function (such as one from `humanize-duration`) with locale-
 * aware helpers.
 */
declare module "toformat" {
  export function toformat<T extends (...args: unknown[]) => unknown>(
    formatFn: T,
  ): T;
}
