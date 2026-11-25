# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Shopping Agent
**Generated:** 2026-11-24 (synced to the implemented UI 2026-11-25)
**Category:** AI/Chatbot Platform — e-commerce
**Direction:** Minimal & clean (approved in `docs/decisions.md`, 2026-11-24)

> The original ui-ux-pro-max pass proposed an AI-purple surface with cyan CTAs.
> That was rejected for demo clarity: neutral surfaces let catalog and chat
> content lead. Violet is reserved for links, active accents, and the focus ring.
> The tokens below are the ones implemented in `apps/web/src/app/globals.css`.

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary (buttons, brand) | `#18181B` | `--color-primary` |
| On Primary | `#FAFAFA` | `--color-on-primary` |
| Background | `#FAFAF9` | `--color-background` |
| Foreground | `#18181B` | `--color-foreground` |
| Card | `#FFFFFF` | `--color-card` |
| Muted surface | `#F4F4F5` | `--color-muted` |
| Muted foreground | `#52525B` | `--color-muted-foreground` |
| Border | `#E4E4E7` | `--color-border` |
| Accent (links, active, focus) | `#6D28D9` | `--color-accent` |
| Accent soft (icon tiles) | `#F5F3FF` | `--color-accent-soft` |
| Destructive | `#B91C1C` | `--color-destructive` |
| Destructive soft | `#FEF2F2` | `--color-destructive-soft` |
| Selection | `#DDD6FE` | hard-coded in `::selection` |

**Contrast:** body text `#18181B` on `#FAFAF9` and `#52525B` on `#FFFFFF` both
clear 4.5:1. Accent links `#6D28D9` on white clear 4.5:1. Do not lighten the
muted foreground further.

**Dark mode:** not in the MVP. `color-scheme: light` is set explicitly.

### Typography

- **Heading font:** Rubik (`--font-heading` → `--font-display`)
- **Body font:** Nunito Sans (`--font-body` → `--font-sans`)
- Loaded with `next/font/google` in `apps/web/src/app/layout.tsx` (self-hosted at
  build time, no runtime Google Fonts request).
- Headings: `font-display`, `font-semibold`, `tracking-tight`, `text-balance`.
- Body: 16px base, `leading-relaxed` for prose, `text-sm` for secondary metadata.
- Numbers/prices: tabular figures where aligned in tables (`tabular-nums`).

### Spacing & Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Card padding, section gaps |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

- Radii: buttons/inputs `0.75rem` / `0.625rem`, cards `1rem`, pills `full`.
- Content width: `max-w-5xl` (1024px) for pages, `max-w-md`/`max-w-2xl` for
  auth forms.
- Vertical rhythm: `py-16`/`py-24` for page sections, `space-y-4`/`space-y-6`
  inside forms.

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-card` | `0 1px 2px rgb(24 24 27 / .04), 0 12px 32px rgb(24 24 27 / .05)` | Cards, panels |
| `--shadow-lg` | `0 10px 15px rgb(0 0 0 / .1)` | Popovers/dropdowns only |

Avoid heavy elevation. Borders carry most of the separation.

---

## Component Specs

All shared component classes live in `apps/web/src/app/globals.css` under
`@layer components`. Reuse them; do not fork one-off styles per page.

### Buttons (`.btn`, `.btn-primary`, `.btn-secondary`)

- Min height 44px, radius `0.75rem`, padding `0.625rem 1.25rem`, weight 600.
- Primary: near-black fill, off-white text; hover `#27272A`.
- Secondary: white fill, 1px border, foreground text; hover muted surface.
- Disabled: `opacity: 0.6`, `cursor: not-allowed`.
- Transitions: 150ms on background/border/color only. No transform on hover
  (avoids layout shift).

### Cards (`.card`)

- White surface, 1px border, radius `1rem`, `--shadow-card`.
- Padding `p-6` (auth panels `p-6 sm:p-8`).
- No hover lift on non-interactive cards.

### Inputs (`.field-input`)

- Min height 44px, radius `0.625rem`, 1px border, white fill.
- Hover border `#D4D4D8`; invalid border `--color-destructive`.
- Focus-visible ring: 2px `--color-accent`, 2px offset (global rule).
- Always pair with a visible `<label>`; errors use `aria-invalid` and
  `aria-describedby` pointing at the message.

### Forms

- Validate with the shared zod schemas on blur and submit.
- On failed submit, render an error summary above the form, move focus to it,
  and link each item to its field (`ErrorSummary` component).
- Keep field errors inline; never replace them with a toast.
- Pending buttons show a verb phrase ("Signing in…") and set `aria-busy`.

### Navigation

- Sticky top header, 64px tall, translucent background + blur, 1px bottom border.
- Brand link with inline SVG mark; account actions on the right.
- Skip-to-content link is the first focusable element.

---

## Style Guidelines

**Style:** Minimal & clean, content-first, calm commerce.
**Keywords:** neutral surfaces, whitespace, quiet violet accent, plain text
answers, streaming text, numbered lists.

**Best for:** a store where the catalog and the two chats (policy Q&A and the
shopping agent) are the product. The chrome must not compete with them.

### Page pattern

- Simple page header (eyebrow → title → one-line description).
- Content in a single column or a calm 2–3 column grid.
- One primary action per view.
- Chat pages: plain text transcript, one input row, Stop while running.
  **No** cards, trace panels, token meters, or confirmation dialogs.

---

## Anti-Patterns (Do NOT Use)

- ❌ Heavy chrome, gradients as decoration, or glassmorphism panels
- ❌ AI-purple page backgrounds or cyan CTAs (superseded by the neutral system)
- ❌ Agent-specific UI: result cards, trace/debug panels, token meters,
  confirmation dialogs
- ❌ Emojis as icons — use inline SVG (24px grid, 1.6–1.8 stroke, round caps)
- ❌ Missing `cursor: pointer` on clickable elements
- ❌ Layout-shifting hover transforms
- ❌ Text below 4.5:1 contrast
- ❌ Instant state changes — transitions 150–300ms
- ❌ Invisible focus states

---

## Pre-Delivery Checklist

- [ ] Tokens come from `globals.css` (`@theme`), no ad-hoc hex values in pages
- [ ] No emojis as icons; SVGs are `aria-hidden` when decorative
- [ ] All clickable elements have `cursor-pointer`
- [ ] Hover/active states transition in 150–300ms without layout shift
- [ ] Text contrast ≥4.5:1; meaningful icons/borders ≥3:1
- [ ] Visible focus ring on every interactive element
- [ ] `prefers-reduced-motion` respected (global override exists)
- [ ] Responsive at 375 / 768 / 1024 / 1440px
- [ ] No content hidden behind the sticky header
- [ ] No horizontal scroll on mobile
- [ ] Forms: label + hint + inline error + error summary with focus management
- [ ] Empty, loading, error, and disabled states are designed, not defaulted
