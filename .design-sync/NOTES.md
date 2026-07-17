# design-sync notes — @mento-protocol/ui → "Mento Design System"

Repo-specific gotchas for future syncs. One bullet per issue.

## Build / config

- **Package shape** (no Storybook). DS lives at `packages/ui`; dist is prebuilt and committed to the package (`dist/index.js` entry, `dist/globals.css`, `dist/theme.css`, `dist/AspektaVF.ttf`).
- **node_modules**: pass `packages/ui/node_modules` (react/react-dom/@types/react resolve there under pnpm; repo root has none).
- **Entry**: `--entry ./packages/ui/dist/index.js` (repo-root-relative).
- **CSS closure**: `cssEntry: dist/globals.css` is the compiled Tailwind v4 output. It **already inlines the brand tokens** (`:root { --primary: oklch(...) ... }`) because `src/globals.css` does `@import "./theme.css"` before `@import "tailwindcss"`. So `tokens/` ends up empty and that is correct — tokens ride inside `_ds_bundle.css`. `tokensGlob: ["dist/theme.css"]` is redundant-but-harmless (theme.css content is already in the closure).
- **npm cache**: `~/.npm` had an ownership problem; install converter deps with `npm_config_cache="$TMPDIR/npm-cache-dssync"`.

## Fonts

- **Brand font AspektaVF ships** (variable TTF, `@font-face` in theme.css → copied to `fonts/`). Good.
- **`[FONT_MISSING]` for "Geist Sans" and "Cambria" is a false alarm** — both are _fallback entries_ in font stacks where an available font precedes them: `--font-sans: "AspektaVF", "Geist Sans", sans-serif` and `--editor-font-serif: Georgia, Cambria, "Times New Roman", …`. AspektaVF/Georgia always win, so these never render. Suppressed via `cfg.runtimeFontPrefixes: ["Geist","Cambria"]` (used here purely to silence the benign warning, not because they're runtime-served). Do NOT hunt/ship these fonts.

## Preview scope (this run)

- Scope decision: **primary families** get authored previews; sub-part exports (Card*, LockCard*, CoinCard*, ProposalCard*, Sidebar*, DropdownMenu*, Select\*, etc.) ride the floor card and are demonstrated composed inside their parent's preview.
- 212 total PascalCase exports discovered → 212 cards. ~181 are floor cards after discovery.
- Composition sources: `apps/ui.mento.org/app/*-components/page.tsx` (6 showcase pages, ~900 lines of real usage) are the primary source for props/variants/realistic content (token symbols list, etc.).

## Preview authoring decisions

- **Overlay open-state pattern**: overlays render their open state via `defaultOpen` on the Radix
  root + a `cfg.overrides.<Name> = { cardMode: "single", viewport: "WxH" }`. Applied to Dialog,
  Popover, DropdownMenu, Sheet, Select, CoinSelect, Tooltip. Dialog needs width ≥ 640 or the footer
  buttons stack/overlap (the `sm:` breakpoint) — using 680px.
- **Sidebar**: authored with `collapsible="none"` so it renders as a normal in-flow flex sidebar
  instead of the default `fixed`/`hidden md:flex` off-canvas variant (which won't show in a card).
- **Wide compound components** (Footer, Navigation, Sidebar) use wide `viewport` overrides.
- **Form** and **ChartContainer** are left on the **floor card** deliberately: `Form` is a
  react-hook-form `FormProvider` wrapper that needs a `useForm()` call (react-hook-form isn't a DS
  export, so it can't be imported in a preview); `ChartContainer` is a low-level recharts primitive
  covered visually by `ReserveChart`. Author later only if react-hook-form is added to `extraEntries`.
- **Authoring split**: primary families authored by orchestrator (overlays, charts, LockCard, nav,
  Sidebar, RichTextEditor) + 4 parallel sonnet subagents (icons, form inputs, display, layout/nav/gov).

## Component quirks (folded from wave learnings)

- **`process.env` shim (bundle-level fix)**: the shipped dist reads `process.env.NEXT_PUBLIC_STORAGE_URL`
  (CommunityCard bg image) and `NEXT_PUBLIC_USE_FORK` at render time. A plain browser has no `process`,
  so those throw `ReferenceError: process is not defined`. Fixed globally by `.design-sync/shims/ds-env-shim.mjs`
  wired via `cfg.extraEntries` — it defines `globalThis.process.env` when the IIFE bundle loads, before any
  render. This makes the bundle self-sufficient in ANY runtime (not just our render check). If more
  `NEXT_PUBLIC_*` reads appear on a DS update, add them to the shim.
- **ProposalCard is dark-shell-only**: `ProposalCardHeader` is hard-coded dark (identical `--dark-background`
  tokens in `:root` and `.dark`), designed for a dark app shell. Its preview renders inside a `.dark`
  wrapper so header text is legible (the faithful representation). Consider filing a DS bug to give the
  header an explicit light foreground so it's theme-independent.
- **DebugPopup**: renders `null` unless toggled via a `Ctrl+M+D` hotkey (no prop override). Left on the
  floor card deliberately — no static state to show.
- **Icon quirks**: `IconChevron` defaults `fill="white"` (invisible on light — previews override fill);
  `IconInfo` ignores all props (hard-coded 16×16 `#8E8B92` — preview scales it via a wrapper);
  `IconLoading` is a dark-surface animejs spinner (previewed on a dark chip; static frame only);
  `IconMento` `backgroundColor="primary"` can't be shown (no contrasting fill class) — default only.
- **`.d.ts` native-attr inheritance gap**: emitted `.d.ts` for Input/Textarea/Checkbox/CoinInput drop the
  `React.ComponentProps<"input">` inheritance (only ref/className/id/style/children survive extraction).
  Native attributes (placeholder/disabled/value/type…) DO pass through at runtime (verified in src) and are
  demonstrated in the previews + `.prompt.md`. If the API contract needs them explicit, add `cfg.dtsPropsFor`.
- **Datepicker**: right-aligns its closed trigger at desktop width (`md:items-end` in source) — expected,
  not a preview bug. Calendar needs an explicit `defaultMonth` or it shows today's month, not `selected`.

## Known render warns (triaged legitimate — a re-sync warn NOT in this list is new)

- **`[RENDER_THIN]` on all 8 Icons + CoinInput**: icons have no text by nature and CoinInput is a large single numeric; both render fine (PNG 7–13 KB). The "no text / paint nothing" heuristic false-positives on icon-only / single-number cells. Graded good from the sheets.
- **`[RENDER_BLANK]` on SidebarMenuSkeleton**: a loading-skeleton is intentionally low-ink (light-gray bars on the sidebar surface), so its PNG stays just under the 5 KB heuristic even with 6 rows. The card renders correctly (6 skeleton rows with icons) — graded good. This is the one component that stays `bad:true` in the render check by nature; it is not a broken card.

## Re-sync risks

- Preview `.tsx` files in `.design-sync/previews/` are tied to the current component APIs. A DS
  version bump that renames sub-parts (LockCard*, CoinCard*, Sidebar\*) will break the matching
  preview until re-authored — grades will clear and re-capture will flag them.
- `RichTextEditor` preview passes an HTML `value`; if the tiptap schema changes, the rendered
  content may differ. Verify its sheet on re-sync.
- Overlay/Tooltip viewport overrides are tuned to current content lengths; longer copy may overflow.
- **`.design-sync/shims/ds-env-shim.mjs` is load-bearing** (wired via `cfg.extraEntries`) — it defines
  `process.env` so CommunityCard doesn't crash. If a DS update reads new `NEXT_PUBLIC_*` vars, add them
  to the shim. It's committed; the fork symlink is not needed (no bare-import overrides in use).
- **ReserveChart** preview forces `prefers-reduced-motion` via a `window.matchMedia` override in its own
  preview module so the recharts donut paints its final frame (not a mid-animation collapse). If recharts
  or the chart component changes, re-verify the donut renders.
- **Grades are carry-forward-stable**: the final capture showed 56 carried forward, 0 cleared. A future
  sync that reports cleared grades on unchanged sources means a nondeterministic input — investigate.

## First-sync result (2026-07-17)

- 212 components imported; **56 authored previews, all graded good**; 156 on the floor card
  (authorable on any later re-sync). Render check clean except the one documented-benign
  SidebarMenuSkeleton `[RENDER_BLANK]`. Uploaded to project `d3ec146f-ceae-4bae-8d96-3b2f5c6dc350`.
- Durable committed inputs under `.design-sync/`: `config.json`, `NOTES.md`, `conventions.md`,
  `previews/`, `shims/`, `BATCH_CONTEXT.md`. Verification state lives in the uploaded `_ds_sync.json`
  (not git) and the gitignored `.cache/`.
