# @mento-protocol/ui

Mento Protocol's shared React component library, Tailwind v4 token layer, and bundled brand stylesheet.

## Install

```bash
pnpm add @mento-protocol/ui
```

The package expects React 19. It ships compiled CSS, so Tailwind is optional for consumers that only import the stylesheet.

## Usage

Import the bundled stylesheet once at the application root:

```tsx
import "@mento-protocol/ui/globals.css";
```

Then import components from the package entrypoint:

```tsx
import { Button } from "@mento-protocol/ui";

export function Example() {
  return <Button>Continue</Button>;
}
```

Consumers that only need the Mento CSS variables and Tailwind theme tokens may import:

```tsx
import "@mento-protocol/ui/theme.css";
```

`globals.css` already includes `theme.css`, Tailwind's generated utilities, component styles, and the bundled Aspekta font face.

## Peer Dependencies

- `react`
- `react-dom`
- `tailwindcss` is optional unless the consuming app compiles or extends the package's Tailwind v4 token layer.

## Font

The package bundles the unmodified `AspektaVF.ttf` font as `dist/AspektaVF.ttf` and loads it from the exported CSS. Aspekta is licensed under the SIL Open Font License 1.1; the font license is included beside the font in the published package as `dist/Aspekta-OFL.txt`.

## Release

This package is prepared for public npm publishing, but publishing is intentionally manual. Create a release tag such as `@mento-protocol/ui@0.1.0` only when the npm release is approved.

The tag-driven publish workflow builds the package before publishing, and `prepublishOnly` runs the same build for any manual `pnpm publish`. During local package development, `pnpm dev` also watches `src/theme.css` and keeps the exported `dist/theme.css` file fresh.
