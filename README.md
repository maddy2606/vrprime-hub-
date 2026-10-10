# VR Prime Ops

Internal operations app for VR Prime: a work board that replaces WhatsApp for tasks, problems,
new listings and restocks, with marketplace tickets (Phase 2) and a Flipkart stock desk (Phase 3)
to follow. Built for phones first; installable from the browser.

- **App**: Next.js 16 (App Router, TypeScript strict) + Tailwind CSS 4, deployed on Vercel from `main`.
- **Backend**: Supabase project `yjjnhdughybemjxsivho` (Mumbai): Postgres, Auth, Storage.
- **Access control**: Row Level Security in Postgres. The UI hides things, the database enforces them.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Work board, search, filters, photos, users admin, PWA shell | Built |
| 2 | Tickets page, push notifications, notification bell, daily jobs | Tables exist, screens not built |
| 3 | Flipkart stock desk and daily sync | Not started |

## Environment variables

| Name | Where | Secret? | What |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel + `.env.local` | No | `https://yjjnhdughybemjxsivho.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Vercel + `.env.local` | No | Supabase publishable key (`sb_publishable_...`) |
| `SUPABASE_SECRET_KEY` | Vercel + `.env.local` | **Yes** | Supabase secret key (`sb_secret_...`). Server only. Used to create users and clear the "must change password" flag. |

Find the keys in Supabase: Project Settings > API keys. Never commit them; `.env*` is git-ignored.
After changing a variable in Vercel, redeploy for it to take effect.

Later phases will add (do not set yet): `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (Phase 2),
and the Supabase secrets `FLIPKART_APP_ID`, `FLIPKART_APP_SECRET` (Phase 3).

## Local setup

```bash
npm install
cp .env.example .env.local   # then fill in the three values
npm run dev                  # http://localhost:3000
```

`http://localhost:3000/dev/preview` shows the main screens with fake data and no login, for checking
layout at 360px and in dark mode. It returns 404 in production.

To develop against a local database instead of production (needs Docker and the Supabase CLI):

```bash
npx supabase start           # starts local Postgres/Auth/Storage, applies supabase/migrations
npx supabase db reset        # re-applies migrations and loads supabase/seed.sql (fake data)
```

Point `.env.local` at the URL and keys that `supabase start` prints. The seed creates four fake users
(`owner@example.test` and so on, password `local-dev-only`). The seed refuses to run on a database
that has real users. Never run it against production.

Checks before pushing:

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
```

## Secrets in error messages

Libraries sometimes put a key inside an error message (for example a mis-pasted key in a header error).
No raw error text may be shown on a page, returned from a server action or logged. Use `logError()` to log
and `redactSecrets()` on any dynamic text shown to a person (both in `src/lib/redact.ts`). As a safety net,
`src/instrumentation.ts` redacts everything written to the server console. `npm test` checks the redaction.

## Database changes

Every schema change is a file in `supabase/migrations`, applied in filename order. To change the schema,
add a new migration file; do not edit one that has already been applied. `src/lib/types.ts` holds the
matching TypeScript row types and must be updated by hand in the same commit.

### Checking the access rules

`supabase/tests/rls_check.sql` proves that a warehouse user cannot read, search, comment on or edit
another warehouse's posts, that deactivated and signed-out users see nothing, that nobody can change
their own role, and that status changes are audited. It runs inside a transaction and rolls back, so
it leaves no data behind and is safe on production. Paste it into the Supabase SQL editor and run it:
the result is `All RLS checks passed`, or an error naming the rule that failed.

### Who can see what

| Role | Posts and tickets | Users and settings |
|---|---|---|
| owner | Everything | Yes |
| manager | Everything | No |
| listing | Everything | No |
| warehouse | Posts tagged with one of their warehouses, assigned to them, or created by them | No |

## How to add a user

There is no public sign-up.

**The very first user (the owner)** is created once in the Supabase dashboard:

1. Authentication > Sign In / Providers > turn **off** "Allow new users to sign up".
2. Authentication > Users > Add user > Create new user. Enter the owner's email and a password, and tick
   "Auto Confirm User".

The first user ever created automatically becomes the owner. This only happens once.

**Everyone else** is added in the app by the owner: account menu > Manage users > Add user. Set a name,
email, role, warehouses and a temporary password ("Generate" makes one). Tell the person their email and
temporary password; they are asked to choose their own password the first time they sign in.

To reset a forgotten password: Manage users > tap the person > enter a new temporary password > Save.
To remove someone: untick "Active". They can no longer sign in; their posts and history stay.

## How the daily sync works

Not built yet (Phase 3). Planned: a Supabase Edge Function, triggered by `pg_cron` at 02:30 UTC
(08:00 IST), reads listings and stock from the Flipkart Seller API (read-only), and stores one
snapshot per day. This section will be completed when Phase 3 ships.

## How to rotate the Flipkart secret

Not applicable until Phase 3. Planned procedure: generate a new secret in the Flipkart seller API
console, update the Supabase secret `FLIPKART_APP_SECRET` (Edge Functions > Secrets), press "Sync now"
to confirm it works, then revoke the old secret in Flipkart. This section will be confirmed in Phase 3.

## Folder map

```
src/app/(auth)        login, change-password
src/app/(app)         My work (/), /all, /posts/new, /posts/[id], /tickets, /stock, /admin/users
src/app/dev/preview   fake-data layout preview (development only)
src/components        ui, navigation, posts, admin, auth
src/lib               supabase clients, auth, types, validation (zod), formatting (IST, Indian numbers)
src/server/actions    server actions; every input is validated again here
src/proxy.ts          keeps the session fresh, redirects signed-out visitors to /login
supabase/migrations   schema, RLS, storage rules
supabase/tests        rls_check.sql
supabase/seed.sql     fake data for local development only
public/sw.js          service worker (installable app; push handlers for Phase 2)
```
