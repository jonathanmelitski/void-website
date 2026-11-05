# CLAUDE.md — Void Ultimate Website v2

## Project Identity

Penn Ultimate frisbee team web app. Two audiences:
- **Public** — roster, news, gallery
- **Authenticated** (Void Live) — coaches score games live, review film, manage broadcasts; players view their footage

Stack: Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, shadcn/ui (new-york, neutral; light + dark via OS), sonner, AWS (Cognito auth, DynamoDB, S3, SES, MediaLive, EC2 WS server, Lambda, SSM).

## Theme & Color (OKLCH, light + dark follow the OS)

Tokens live in `app/globals.css`: light values on `:root`, dark under `@media (prefers-color-scheme: dark)`. No toggle, no `.dark` class; the `dark:` variant follows the media query. `html { color-scheme: light dark }`. Use semantic utilities only:

| Role | Utility |
|---|---|
| Page | `bg-background` |
| Text: primary / secondary / muted / faint | `text-foreground` / `text-fg-secondary` / `text-fg-muted` / `text-fg-faint` (faint = decorative or disabled only) |
| Surfaces: resting / hover-selected / active | `bg-surface` / `bg-surface-2` / `bg-surface-3` |
| Opaque floating (dialog, popover, sheet, sticky bar) | `bg-card` (scrim: `bg-black/70`) |
| Borders: default / strong / inputs | `border-border` / `border-border-strong` / `border-input` |
| Accent | `bg-brand` + `text-brand-foreground` (fill), `text-brand-text` (text) |
| Status | `text-destructive`, `text-success`, `text-warning` (+ `/10` bg, `/30` border tints) |
| Primary button look | `bg-foreground text-background` |

- **Never** use `text-white/NN`, `bg-white/NN`, `border-white/NN`, raw hex, or Tailwind palette colours (`red-400`, `green-400`, …) for UI. Literal white/black is only for content on imagery, video or black scrims (photo captions, glass pills on photos, lightbox, controls over the player, the `/live/scoreboard` broadcast overlay).
- A subtree that sits on video or a black scrim can take `className="theme-dark"` to force the dark token set there.
- Categorical data colours (point outcomes, per-angle tracks) may use fixed hues or `--chart-1..5`.
- Native `<option>`s are pinned to popover colours in `globals.css` (Windows draws option lists with the select's text colour). Don't put text colours on `<option>`.

## Typography

- Display: Bebas Neue via `next/font/local` (`app/fonts.ts`) → `font-display` utility. Single weight, caps-only: use `font-display tracking-wide leading-none`, never with `font-bold`/`font-black`. `PageHeader` renders it for page titles.
- UI text: system sans. Section headings `text-lg font-semibold`; meta `text-xs text-fg-muted`. Nothing below `text-[11px]`.
- `font-mono tabular-nums` only for scores, clocks, timecodes and IDs.

## Border & Shape Conventions

- Three radii only: `rounded-md` (buttons, inputs, chips), `rounded-xl` (cards, panels, dialogs), `rounded-full` (pills, avatars, dots). No `rounded`, `rounded-sm`, `rounded-lg`, `rounded-2xl`.
- Dividers: `border-border` / `divide-border`.
- Focus: a global 2px brand `:focus-visible` outline. Never add `focus:outline-none` without a visible replacement.

## Glass on imagery

Event/news cards with a cover photo: `bg-white/10 backdrop-blur-sm rounded-xl overflow-hidden`, gradient `bg-gradient-to-t from-black/70 to-transparent`, white text on top, pills `bg-white/20 backdrop-blur-sm rounded-full`. Without a photo, fall back to `bg-surface border border-border` and theme text.

## Vortex Background

`components/vortex.tsx`, rendered in `components/root-shell.tsx` as a fixed `-z-10` layer on public pages only (not `/live/*`, not `/live/scoreboard/*`). Dark: particle canvas (one rAF loop, cancelled on unmount, paused when hidden, half the particles on phones; a single static frame under `prefers-reduced-motion`). Light: a static brand-tinted wash. Don't add it to overlay pages.

## App Shell

`RootShell`: skip link → sticky navbar (`z-40`) → `<main id="main">` → `<Toaster />`. The **document** scrolls (no inner scroll container) and the shell creates no stacking context, so page-level `fixed z-50` overlays sit above the nav. z-scale: nav 40 · overlays/dialogs 50 · tooltips/skip link 60. Pages own their own width/gutters (`PageContainer`) and alignment (the shell no longer centres text).

## Component Patterns

- CVA for variants; Lucide icons only; `"use client"` for hooks/browser APIs; server components for data-fetching pages.
- Primitives in `components/ui/` — use them instead of hand-rolling:
  - `Button` — variants `default` (one primary per screen), `brand` (Live CTA), `secondary`, `outline`, `ghost`, `quiet` (inline text action), `destructive`, `link`; sizes `xs sm default lg touch` (48px, sideline) and `icon-xs icon-sm icon icon-lg icon-touch` (icon-only needs `aria-label`); `loading` prop; `asChild` for links.
  - `Spinner` / `PageSpinner`, `Skeleton` / `SkeletonCard` / `SkeletonRow`, `EmptyState` (`icon title description action`, `variant="inline"|"page"`).
  - `Field` (label + control + hint + error, aria wired), `Input`, `Textarea`, `NativeSelect`, `Select` (radix), `Label`.
  - `Tabs` (`TabsList variant="underline"|"pill"`), `Dialog`, `ConfirmDialog`, `Popover`, `Tooltip` (`<Tooltip content="…">{trigger}</Tooltip>`), `Kbd` (hidden on touch), `Badge` (`default secondary outline destructive success warning brand`).
  - `PageContainer` (`width="default"|"wide"|"prose"|"form"`; 16/24/32px gutters) and `PageHeader` (`title description eyebrow actions size`).
- Feedback: `import { toast } from "@/components/ui/sonner"` — `toast.success("Saved")`, `toast.error("Couldn't save. Try again.")`. Saves never fail silently.
- **No native `confirm()` / `alert()` / `prompt()`** — use `ConfirmDialog` and toasts.
- Metadata: root template `"%s · Void Ultimate"`; `/live/*` uses `"%s · Void Live"`. Client pages get titles from a small `layout.tsx` in their segment.

## Route Structure

```
/live → /live/events/[eventId] → /live/events/[eventId]/games/[gameId]
                                → /live/events/[eventId]/games/[gameId]/film
/live/watch/[gameId]       (public WS scoreboard)
/live/scoreboard/[gameId]  (broadcast overlay — no navbar, no vortex)
/live/manage               (coach/admin tabbed panel)
/live/me                   (player portal)
```

## Auth Pattern (every mutating API route)

1. Extract `access_token` cookie
2. `verifyToken(token)` from `lib/aws/cognito.ts`
3. Check `payload["cognito:groups"]` — `ADMIN`, `COACH`, or `USER`
4. Return 401/403 before any business logic or DynamoDB call

## DynamoDB Lib Pattern

One file per entity in `lib/aws/`. Each exports: typed `Item` type, `list*`, `get*`, `create*`, `update*`, `delete*`. Table name via `const TABLE = () => process.env.DYNAMO_*_TABLE!`. Use the dynamic UpdateExpression builder from `lib/aws/games.ts:updateGame`.

## Performance Philosophy

- Next.js `Link` prefetches route JS on hover automatically — prefer `Link` over `router.push()` buttons
- Buttons that use `router.push()` must use the `usePrefetchIntent` hook (`hooks/use-prefetch-intent.ts`) to call `router.prefetch(href)` on mouseenter
- `PrefetchLink` (`components/prefetch-link.tsx`) wraps `Link` and fires cheap API `fetch()` calls on hover to warm route handler cache
- Apply pre-warming to: EventCard → `/api/events/[id]`; game list buttons → `/api/games/[id]`, `/api/points`, `/api/point-events`

## Security Philosophy

- Auth check is always the first line of any mutating route handler
- WS internal push endpoint requires `Authorization: Bearer WS_INTERNAL_SECRET`
- Never log JWT tokens or AWS credentials
- Private events are filtered at the API layer, not client

## WebSocket Architecture

Standalone Node.js WS server (`ws/server.ts`) on EC2.
- Game state: `ws://host/ws/game/:gameId` | push: `POST /internal/push/:gameId`
- Film annotations: `ws://host/ws/film/:clipId` | push: `POST /internal/push/film/:clipId`
- Push utility `lib/ws-push.ts` is always fire-and-forget (silent fail)

## Lambda Worker Pattern

Workers poll AWS job status and write results back to DynamoDB. See `broadcast-worker/handler.ts` (MediaLive) for the pattern.
