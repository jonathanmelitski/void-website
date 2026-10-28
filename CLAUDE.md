# CLAUDE.md — Void Ultimate Website v2

## Project Identity

Penn Ultimate frisbee team web app. Two audiences:
- **Public** — roster, news, gallery
- **Authenticated** (Void Live) — coaches score games live, review film, manage broadcasts; players view their footage

Stack: Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, shadcn/ui (new-york, neutral, dark default), AWS (Cognito auth, DynamoDB, S3, SES, MediaLive, EC2 WS server, Lambda, SSM).

## Color System (OKLCH, dark-mode default)

All values from `app/globals.css`. Use Tailwind utilities, never raw OKLCH in JSX.

| Role | Tailwind | Raw |
|---|---|---|
| Background | `bg-background` | oklch(0.145 0 0) |
| Foreground | `text-foreground` | oklch(0.985 0 0) |
| Border | `border-white/10` | white at 10% opacity |
| Input | — | white at 15% opacity |
| Card | `bg-card` | oklch(0.205 0 0) |
| Sidebar accent | — | oklch(0.488 0.243 264.376) purple-blue |
| Muted text | `text-white/40` | — |
| Destructive | `text-destructive` | oklch(0.704 0.191 22.216) |

Always write `text-white/40` not `rgba(255,255,255,0.4)`.

## Typography

- Display headings: Bebas Neue (`font-black`) — loaded via @font-face in `globals.css`
- UI text: system sans (Tailwind default)
- Scores/numbers: always `font-mono`
- Code: `font-mono`

## Border & Shape Conventions

- `--radius: 0.625rem` → buttons use `rounded-md`, cards use `rounded-xl`, inputs use `rounded-md`
- Never `rounded-sm` or `rounded-none` on visible card surfaces
- Dividers: `border-white/10`

## Glassmorphic Elements

Used on event cards and overlays:
```
bg-white/10 backdrop-blur-sm rounded-lg overflow-hidden
```
Image gradient overlay: `bg-gradient-to-t from-black/70 to-transparent`
Pill badges on images: `bg-white/20 backdrop-blur-sm rounded-full`

## Vortex Background

`components/vortex.tsx` — simplex-noise particle animation, rendered in `components/root-shell.tsx`.
Excluded from `/live/scoreboard/*` (broadcast overlay) and any bare-canvas routes. Do not add it to new overlay pages.

## Component Patterns

- CVA for variants (`class-variance-authority`)
- Icons: Lucide React exclusively
- Primitives: shadcn/ui from `components/ui/`
- `"use client"` required for any component using hooks or browser APIs
- Server components preferred for data-fetching pages

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
