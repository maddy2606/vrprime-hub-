# VR Prime Ops

Internal operations app for VR Prime: a work board that replaces WhatsApp for tasks, problems,
new listings and restocks, with marketplace tickets and notifications, and a Flipkart stock desk. Built for
phones first; installable from the browser.

- **App**: Next.js 16 (App Router, TypeScript strict) + Tailwind CSS 4, deployed on Vercel from `main`.
- **Backend**: Supabase project `yjjnhdughybemjxsivho` (Mumbai): Postgres, Auth, Storage.
- **Access control**: Row Level Security in Postgres. The UI hides things, the database enforces them.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Work board, search, filters, photos, users admin, PWA shell | Built |
| 2 | Tickets, push notifications, notification bell, daily 9:30 AM jobs | Built |
| 3 | Flipkart stock desk and daily sync | Built. Waiting for the Flipkart secrets (see below) |

## Environment variables

| Name | Where | Secret? | What |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel + `.env.local` | No | `https://yjjnhdughybemjxsivho.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Vercel + `.env.local` | No | Supabase publishable key (`sb_publishable_...`) |
| `SUPABASE_SECRET_KEY` | Vercel + `.env.local` | **Yes** | Supabase secret key (`sb_secret_...`). Server only. Used to create users and clear the "must change password" flag. |

Find the keys in Supabase: Project Settings > API keys. Never commit them; `.env*` is git-ignored.
After changing a variable in Vercel, redeploy for it to take effect.

Push notifications need one more variable in Vercel, and secrets in Supabase (see
[Notifications and push](#notifications-and-push)):

| Name | Where | Secret? | What |
|---|---|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Vercel (and `.env.local` to test) | No | Public half of the push key pair |
| `VAPID_PUBLIC_KEY` | Supabase > Edge Functions > Secrets | No | The same public key |
| `VAPID_PRIVATE_KEY` | Supabase > Edge Functions > Secrets | **Yes** | Private half of the push key pair. Never in Vercel or the repo. |
| `VAPID_SUBJECT` | Supabase > Edge Functions > Secrets | No | Optional. A `mailto:` address or https URL. Defaults to the site address. |

The Flipkart stock sync needs two more Supabase secrets, set by the owner (see [Flipkart stock sync](#flipkart-stock-sync)):

| Name | Where | Secret? | What |
|---|---|---|---|
| `FLIPKART_APP_ID` | Supabase > Edge Functions > Secrets | **Yes** | The app ID of the Flipkart Seller API application |
| `FLIPKART_APP_SECRET` | Supabase > Edge Functions > Secrets | **Yes** | Its secret. Never in Vercel, the repo or a chat. |

Two more exist for testing only and are normally not set: `FLIPKART_BASE_URL` (points the sync at a stand-in instead of Flipkart) and `STOCK_SYNC_BUDGET_MS` (shortens the time one worker runs before handing over).

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

## Tickets

Tickets only track what has been opened on the marketplace. The Tickets page has four tabs, each with a count:
Open, Waiting for marketplace, Follow-up due (open or waiting tickets whose next follow-up is today or earlier,
shown in red), and Closed (resolved and rejected). Search finds a ticket by its marketplace ID, SKU, VR-T number or
the title and number of the problem it was raised from; platform and issue type can be filtered. Each row shows the
marketplace ID, the linked problem (tap it to open the post), platform, issue type, warehouse (the problem's), the
raised date, the next follow-up and the status; tap the row to open the ticket. The form has the ticket ID,
platform, issue type, SKU, raised on, next follow-up, status and notes. The `amount_involved` and
`amount_recovered` columns still exist in the database but nothing reads or writes them.

## Notifications and push

People are told when:

| Event | Who is told | When |
|---|---|---|
| Work is assigned (new post or reassigned) | The new assignee, unless they did it themselves | Straight away |
| Someone comments on a post | The post's creator and assignee, except the commenter | Straight away |
| A post is marked done | The post's creator and assignee, except whoever marked it | Straight away |
| Overdue work | Each person with overdue open posts assigned to them, in one message | 9:30 AM IST daily |
| Ticket follow-up due (today or earlier, ticket open or waiting) | Whoever saved the ticket, and the assignee of its post. Tapping it opens the Follow-up due tab. | 9:30 AM IST daily |

Every notification is saved in the app (the bell, then the Notifications page) whether or not push is on.
Deactivated users get none. The overdue and follow-up messages are sent at most once per person per day,
even if the job is run twice.

**How it is built.** Database triggers write the notification rows. A second trigger asks the Edge Function
`notify` (`supabase/functions/notify/index.ts`) to push it, through `pg_net`. Once a day `pg_cron` (job
`daily-notify`, `0 4 * * *` UTC = 9:30 AM IST) calls the same function to build the two digests. The request
carries a random secret held in the database (`private.internal_config`, not readable through the API); the
function checks it with the database, so there is nothing to copy into Supabase secrets and the function
refuses everyone else (`verify_jwt` is off for that reason). If push is not set up or the function fails, posts,
comments and tickets still save normally and the bell still works.

### Turning push on (one time)

Done on 2026-10-12 for this project (keys generated, public key in Vercel, the three secrets in Supabase). The steps are
kept here for rebuilding the project or rotating the keys.

1. Create a key pair on any computer: `npx web-push generate-vapid-keys`. It prints a public and a private key.
2. In Vercel > Settings > Environment Variables add `NEXT_PUBLIC_VAPID_PUBLIC_KEY` = the **public** key, then redeploy.
3. In Supabase > Edge Functions > Secrets add `VAPID_PUBLIC_KEY` (the public key) and `VAPID_PRIVATE_KEY` (the
   **private** key). Optionally `VAPID_SUBJECT`, for example `mailto:you@example.com`. No redeploy is needed.
4. Open the app on a phone, go to the bell > Notifications > Turn on, then "Send me a test".

On iPhone, push only works after the app is added to the Home Screen (Share > Add to Home Screen) and opened
from there. A device is registered to whoever signed in last, and is removed when someone signs out.

### Running or checking the daily job by hand

In the Supabase SQL editor, `select private.call_notify('{"job":"daily","dry_run":true}'::jsonb);` asks the
function what it would do without changing anything (leave out `dry_run` to run it for real). Read the answer
with `select status_code, content from net._http_response order by created desc limit 1;`.
To see the schedule: `select * from cron.job;`. Function logs are under Edge Functions > notify > Logs.

### Changing the function

Edit `supabase/functions/notify/index.ts`, then deploy it with
`npx supabase functions deploy notify --no-verify-jwt` (or paste it into the dashboard editor and switch
"Verify JWT" off).

### Rotating the push keys

Generate a new pair and update the three places above, then redeploy Vercel. Phones that subscribed with the
old key re-subscribe by themselves the next time they open the app (they may be asked again).

## Secrets in error messages

Libraries sometimes put a key inside an error message (for example a mis-pasted key in a header error).
No raw error text may be shown on a page, returned from a server action or logged. Use `logError()` to log
and `redactSecrets()` on any dynamic text shown to a person (both in `src/lib/redact.ts`). As a safety net,
`src/instrumentation.ts` redacts everything written to the server console. `npm test` checks the redaction, the sync (with a pretend Flipkart), the stock calculations, and that no server file imports a value from a client file.

## Database changes

Every schema change is a file in `supabase/migrations`, applied in filename order. To change the schema,
add a new migration file; do not edit one that has already been applied. `src/lib/types.ts` holds the
matching TypeScript row types and must be updated by hand in the same commit.

### Checking the access rules

`supabase/tests/rls_check.sql`, `phase2_check.sql` and `phase3_check.sql` prove that a warehouse user cannot read, search, comment on or edit
another warehouse's posts, that deactivated and signed-out users see nothing, that nobody can change
their own role, and that status changes are audited. The Phase 2 script covers who gets which notification,
that notifications are private and cannot be forged, that the internal functions are not callable by signed-in
users, and that warehouse users only see tickets linked to posts they can see. The Phase 3 script covers saving a sync (first-sync
baseline, inactive tracking, same-day reruns, the 80% sanity check, 60-day cleanup), that a warehouse user only sees their own
warehouses' units, and that only the owner or a manager can start a sync. Each runs inside a transaction
and rolls back, so it leaves no data behind and is safe on production. Paste one into the Supabase SQL editor
and run it: the result is `All ... checks passed`, or an error naming the rule that failed.

### Who can see what

| Role | Posts and tickets | Users and settings |
|---|---|---|
| owner | Everything | Yes |
| manager | Everything | No |
| listing | Everything | No |
| warehouse | Posts tagged with one of their warehouses, assigned to them, or created by them; tickets linked to those posts | No |

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

## Flipkart stock sync

The Stock page shows a copy of Flipkart stock, refreshed every day at **8:00 AM IST** and whenever the owner or a
manager taps **Sync now**. The sync only **reads** from Flipkart: the code can make exactly three kinds of request
(get a token, run a listing search, read listing details) and refuses anything else before it is sent.

### Turning it on (one time, by the owner)

1. In Supabase > Edge Functions > Secrets add `FLIPKART_APP_ID` and `FLIPKART_APP_SECRET`. No redeploy is needed.
2. Open the app > Stock > **Sync now**. The first sync takes about a minute; the screen shows progress.
3. From then on it runs by itself at 8:00 AM IST. The next morning the screen shows the change since the day before.

Until the secrets exist, a sync stops straight away with the message "Flipkart is not connected yet".

### What a sync does

1. Gets a token (HTTP Basic with the app ID and secret, `scope=Seller_Api`).
2. Lists every SKU: `POST /sellers/listings/v3/search` with `{"filters": {}, "page_id": null}`, following `next_page_id`
   while `has_more` is true. If Flipkart answers 400, it logs Flipkart's reply and retries with `{"page_id": null}`.
   The `/product/search` endpoint is never used.
3. Reads details 10 SKUs at a time: `GET /sellers/listings/v3/{sku1,sku2,...}`, with at least 350 ms between calls.
   A 429 or 5xx answer is retried with waits of 1, 2, 4, 8 and 16 seconds (at most 5 retries, longer if Flipkart says
   `Retry-After`); a 401 gets a fresh token once.
4. Leaves out FBF and FBF_LITE listings (and counts them). Everything else is saved with its units per warehouse
   (matched by Flipkart's location ID to the warehouses table).
5. Saves one snapshot per day, keeps 60 days, and only calls the snapshot good if Flipkart gave details for at least
   80% of the listings. A failed or partial sync never replaces the last good one: the screen keeps showing the last good
   day and says the latest sync failed.

The work is saved in small steps with a cursor, so it can stop and carry on. One worker handles about 100 seconds of work
and then hands over to a fresh one; if a worker is cut off, a watchdog (every 5 minutes, `stock-sync-watchdog`) restarts it
from where it stopped (up to 8 times). Only one sync runs at a time: tapping Sync now while one is running just shows it.
About 645 listings take roughly 70 seconds.

### What the Stock page shows

Tiles (tap one to open its list): units in stock (active SKUs) with the change since the day before; low stock SKUs;
out of stock everywhere; weight alerts; new inactive. Warehouse cards (tap to look at one warehouse): units, share of the
total, and how many SKUs are empty or low there. Lists, all sortable by tapping a column heading, searchable by SKU or
title, and downloadable as CSV:

| List | Rows | Notes |
|---|---|---|
| Low stock | SKUs that still have stock somewhere but are empty or low at a warehouse | Chips: Empty at (red), Low at (amber, with units), In stock at (green, with units). Most empty warehouses first. |
| By location | Every SKU, one column per warehouse | Red = 0, amber = under the low-stock level, a dash = not listed there |
| Out of stock | No units in any warehouse | Status, where it is listed, units the day before, and a "Ran out today" flag |
| Weight alerts | Length x breadth x height (cm) + weight (grams) over the limit | Listings with no size are skipped |
| New inactive | Went inactive within the last N days | Inactive listings found on the very first sync are "Before tracking", never new |
| All inactive | Every inactive listing | |

"Low" means at least 1 unit but fewer than the low-stock level; 0 is "empty". With a warehouse chosen, "out of stock"
means out of stock at that warehouse. "Hide inactive listings" removes inactive SKUs from the lists and tile counts.
From any stock row, **+ Restock** opens a new restock post with the SKU and the emptiest warehouse filled in.
Warehouse users only see the units of their own warehouses (enforced in the database, not just on screen).
The CSV starts text with an apostrophe where it would otherwise look like a spreadsheet formula.

### Settings (owner only: account menu > Settings)

| Setting | Normal | Meaning |
|---|---|---|
| Low stock level | 100 | Fewer units than this at a warehouse is low |
| Weight alert limit | 2000 | Alert when L x B x H (cm) + weight (g) is over this |
| New inactive days | 2 | A listing counts as new inactive if it went inactive within this many days |

They apply the next time anyone opens the Stock page (no new sync needed).

### Checking and running it by hand

- Last runs: `select status, total, cursor, processed, skipped_fbf, missing, error, created_at, finished_at from stock_runs order by created_at desc limit 5;`
- Start one: `select private.start_stock_sync('manual', null);`
- Logs: Supabase > Edge Functions > stock-sync > Logs (every line is scrubbed of secrets).
- Schedule: `select jobname, schedule from cron.job;` (`stock-sync-daily` is `30 2 * * *` UTC = 8:00 AM IST).
- Changing the function: edit `supabase/functions/stock-sync/`, then `npx supabase functions deploy stock-sync --no-verify-jwt --use-api`.

### How to rotate the Flipkart secret

1. In the Flipkart Seller API console, create a new secret for the application (keep the old one working for now).
2. In Supabase > Edge Functions > Secrets, replace `FLIPKART_APP_SECRET` with the new value (or from a terminal:
   `npx supabase secrets set FLIPKART_APP_SECRET=... --project-ref yjjnhdughybemjxsivho`, from a file rather than typing it
   where others can see it).
3. In the app, Stock > **Sync now**, and check it finishes. A wrong secret fails at once with "Flipkart rejected the app ID or secret".
4. Revoke the old secret in the Flipkart console.

No redeploy is needed. If the app ID changes too, replace `FLIPKART_APP_ID` the same way.

## Folder map

```
src/app/(auth)        login, change-password
src/app/(app)         My work (/), /all, /posts/new, /posts/[id], /tickets (+ /new, /[id]), /notifications, /stock, /admin/users, /admin/settings
src/app/dev/preview   fake-data layout preview (development only)
src/components        ui, navigation, posts, tickets, notifications, stock, admin, auth
src/lib               supabase clients, auth, types, validation (zod), formatting (IST, Indian numbers)
src/server/actions    server actions; every input is validated again here
src/proxy.ts          keeps the session fresh, redirects signed-out visitors to /login
supabase/migrations   schema, RLS, storage rules
supabase/functions    Edge Functions (notify: push and the daily digests; stock-sync: the Flipkart stock sync)
supabase/tests        rls_check.sql, phase2_check.sql, phase3_check.sql
supabase/seed.sql     fake data for local development only
public/sw.js          service worker (installable app; shows push messages)
```
