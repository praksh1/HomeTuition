# Sikshya — Nepal Teacher Platform

A mobile app (iOS/Android via Expo) connecting Nepali teachers and students with live classrooms, session booking, NPR subscriptions, and advanced teacher discovery.

## Run & Operate

Local (non-Replit) setup is documented in `LOCAL_SETUP.md`. Env vars come from a `.env` file
at the repo root; on Replit they were injected into the environment instead.

- `pnpm run dev:api` — API server (port 8080)
- `pnpm run dev:app` — Expo app on web (port 8081)
- `pnpm run db:push` / `pnpm run seed` — shortcuts for the two commands below
- `pnpm --filter @workspace/sikshya run dev:replit` — Expo with Replit's proxy env vars
- `pnpm --filter @workspace/scripts run seed` — seed 200+ teachers, 1500+ sessions, 9000+ reviews
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate Zod schemas + React Query hooks
- `pnpm run typecheck` — full typecheck across all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- **Mobile**: Expo (Expo Router), React Native, expo-notifications
- **API**: Express 5, JWT auth (jsonwebtoken + crypto.scrypt), Zod validation
- **DB**: PostgreSQL + Drizzle ORM (`lib/db`)
- **Codegen**: Orval (OpenAPI → Zod + React Query hooks in `lib/api-zod` and `lib/api-client-react`)
- **Build**: esbuild (CJS bundle)

## Where things live

- `artifacts/sikshya/` — Expo mobile app (24+ screens, Expo Router)
- `artifacts/api-server/` — Express 5 API server
- `lib/db/` — Drizzle schema + DB client
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for all endpoints)
- `lib/api-zod/` — generated Zod schemas
- `lib/api-client-react/` — generated React Query hooks
- `scripts/src/seed.ts` — seed script (200 teachers, 500 students, 1500+ sessions, 9000+ reviews)

## Architecture decisions

- JWT auth via `SESSION_SECRET` env var; token stored in AsyncStorage on mobile
- Teacher IDs in the mobile app are `String(teacherProfiles.id)` (profile ID, not user ID)
- `userId` field on `Teacher` type in mobile is the `users.id` (needed for sessions/reviews queries)
- Seed uses `crypto.scrypt` for password hashing (same as server `lib/auth.ts`)
- `lib/api-zod/src/index.ts` only re-exports from `./generated/api` (not `./generated/types`) to avoid `Params` type name collisions

## Product

- **Teacher Discovery**: 200+ teachers searchable by name, subject, location, rating, price
- **Live Classroom**: SVG whiteboard, session recording UI
- **Sessions**: teachers create sessions; students browse and enroll with eSewa/Khalti payment flow
- **Reviews**: students rate teachers; ratings auto-recomputed on the backend
- **Subscriptions**: NPR 2,000/month teacher subscription model
- **Push Notifications**: session reminders via expo-notifications

## Demo logins (password: `password123`)

| Role | Email |
|------|-------|
| Teacher | `ram@example.com` |
| Teacher | `sunita@example.com`, `bishnu@example.com`, `priya@example.com`, `kiran@example.com` |
| Student | `student@sikshya.np` |

## Required env

- `DATABASE_URL` — PostgreSQL connection string
- `SESSION_SECRET` — JWT signing secret (available as Replit secret)
- `EXPO_PUBLIC_DOMAIN` — set automatically by Expo workflow

## Gotchas

- Run `pnpm --filter @workspace/db run push` after any schema change
- Run `pnpm --filter @workspace/api-spec run codegen` after any OpenAPI spec change; then run `pnpm run typecheck:libs`
- `api-zod/src/index.ts` must NOT re-export `./generated/types` — causes `*Params` type collisions
- Never use `console.log` in server code — use `req.log` in handlers, `logger` elsewhere
- Seed script imports DB schema via relative path (tsx compatible with ESM)

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- API routes: `artifacts/api-server/src/routes/` (auth, teachers, sessions, reviews, health)
- Mobile screens: `artifacts/sikshya/app/(teacher)/` and `artifacts/sikshya/app/(student)/`
- Auth utilities: `artifacts/api-server/src/lib/auth.ts` and `artifacts/api-server/src/middlewares/requireAuth.ts`
