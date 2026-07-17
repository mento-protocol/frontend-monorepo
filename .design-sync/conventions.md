# Mento UI — conventions for building with this design system

Mento UI is a shadcn/ui-style React library: Radix primitives + Tailwind CSS v4, with
class-variance-authority (CVA) variants. You style with **Tailwind utility classes** and
**brand tokens**, and you pick component **variants via props**. Components import from
`@mento-protocol/ui`.

## Setup & wrapping

- **No global ThemeProvider is needed for styling** — the brand font (AspektaVF) and all tokens
  ship in the stylesheet and apply automatically. Just render the components.
- **`Tooltip` must be wrapped in `TooltipProvider`** (once, near the root). Without it the tooltip
  never opens.
- **`Sidebar` and its `Sidebar*` parts must be inside `SidebarProvider`** (they read `useSidebar`
  context; rendering them bare throws).
- **`Form` (react-hook-form)** needs a `useForm()` form object passed to it — it is a form context
  provider, not a styled element.
- **Dark mode**: adding `className="dark"` to an ancestor flips every token to its dark value
  (Mento's apps default to dark). A few compound components — notably `ProposalCard` /
  `ProposalCardHeader` — are **designed for a dark shell** (their header background is always dark),
  so render them inside a `.dark` container.

## The styling idiom — real vocabulary

Style with these Tailwind classes (all backed by brand tokens; use them, don't invent hex colors):

| Surface / text             | class                                                     |
| -------------------------- | --------------------------------------------------------- |
| Brand purple fill / text   | `bg-primary` · `text-primary` · `text-primary-foreground` |
| Card surface               | `bg-card` · `text-card-foreground`                        |
| Page background (lavender) | `bg-background` · `text-foreground`                       |
| Secondary / muted fills    | `bg-secondary` · `bg-muted`                               |
| Muted / secondary text     | `text-muted-foreground`                                   |
| Borders                    | `border border-border`                                    |
| Danger                     | `bg-destructive`                                          |

**Important — no Tailwind JIT at render time.** Designs receive the DS's **precompiled**
stylesheet (`_ds_bundle.css`), not a live Tailwind pass, so a utility class only works if it was
already compiled into that file. Common layout utilities used by the components (`flex`, `grid`,
`gap-4`, `p-6`, `space-y-4`, `rounded-lg`, and the token classes in the table above) are present;
but an **arbitrary/bespoke class you invent** (e.g. `gap-[13px]`, a one-off `w-[327px]`, or a
utility no component uses) will **not** exist in the compiled CSS and renders as a no-op. For any
bespoke spacing/sizing/layout, use **inline `style={{…}}`** rather than a new utility class; reach
for utilities only when reusing ones the components already use. Tokens are also readable directly
as `var(--primary)`, `var(--foreground)`, `var(--card)`, `var(--muted-foreground)`, `var(--border)`,
`var(--success)`, etc. Note `--radius` is `0` — Mento buttons use an angular **clipped** corner
instead (see `clipped` below), not rounded corners.

**Variants are props, not classes.** e.g. `Button` takes `variant` ("default" | "secondary" |
"outline" | "ghost" | "link" | "destructive" | "approve" | "abstain" | "reject"), `size`
("xs" | "sm" | "md" | "lg" | "icon"), and `clipped` ("default" | "sm" | "lg"). `Badge` and
`ProposalStatus` take `variant`. Prefer the variant prop over restyling with classes.

## Where the truth lives

- Styling source: `_ds/<folder>/styles.css` and the `@import`ed `_ds_bundle.css` (compiled Tailwind
  - `:root` tokens) — read these before inventing any class or color.
- Per-component API + usage: each component's `<Name>.d.ts` (props) and `<Name>.prompt.md` (usage).

## One idiomatic example

```tsx
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
} from "@mento-protocol/ui";

<Card>
  <CardHeader>
    <CardTitle>USDm Supply</CardTitle>
    <CardDescription>Mento Dollar in circulation</CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    <p className="font-medium text-3xl text-foreground">16,904,872 USDm</p>
    <Button variant="approve" clipped="default">
      Refresh
    </Button>
  </CardContent>
</Card>;
```
