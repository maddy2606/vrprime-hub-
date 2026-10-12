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
| 3 | Flipkart stock desk and daily sync | Live |
| 4 | The Flipkart page: needs action, orders, returns, prices, listing health, running out soon | Built (Phase 4b, with Seller Hub's order tabs); see [The Flipkart page](#the-flipkart-page) |

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

`supabase/tests/rls_check.sql`, `phase2_check.sql`, `phase3_check.sql` and `phase4_check.sql` prove that a warehouse user cannot read, search, comment on or edit
another warehouse's posts, that deactivated and signed-out users see nothing, that nobody can change
their own role, and that status changes are audited. The Phase 2 script covers who gets which notification,
that notifications are private and cannot be forged, that the internal functions are not callable by signed-in
users, and that warehouse users only see tickets linked to posts they can see. The Phase 3 script covers saving a sync (first-sync
baseline, inactive tracking, same-day reruns, the 80% sanity check, 60-day cleanup), that a warehouse user only sees their own
warehouses' units, and that only the owner or a manager can start a sync. The Phase 4 script covers price history, saving orders and returns, the
dispatch-deadline alert (once per order, owner and managers only), that warehouse users only see their own warehouses' orders and
returns, the sales, stock-drop and return-rate calculations, and how the order runs pause, wait and restart. Each runs inside a transaction
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

(Phase 4 added four more, listed under [The Flipkart page](#the-flipkart-page).) They apply the next time anyone opens the Flipkart page (no new sync needed).

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

## The Flipkart page

The **Flipkart** tab (it used to be called Stock; old /stock links still work) has six sections. Warehouse users see the first
four, for their own warehouses only (enforced in the database); owner, manager and listing see all six.

| Tab | What it shows |
|---|---|
| Needs action | A short list, each line with a button: Active orders about to miss dispatch (today or tomorrow, most urgent first), SKUs empty at a warehouse that has Active orders waiting, price errors, new inactive listings, SKUs with a high return rate, SKUs running out soon. Upcoming and Under Processing orders never appear here |
| Orders | Seller Hub's tabs per warehouse, orders grouped by SKU, an order list, a pick list, upcoming vs stock, and cancellations. See [The Orders tab](#the-orders-tab) |
| Stock | The Phase 3 stock desk, plus a **Days left** column |
| Returns | Courier and customer returns with reason and SKU, and return rate per SKU. **Raise ticket** from a return pre-fills the SKU, Flipkart and "Wrong return" |
| Prices | Selling price, MRP, discount, last change and the history of changes, with flags for selling price at or above MRP, a big overnight drop, and a missing price |
| Listing health | One row per SKU with its problems: missing package size or weight, slow dispatch SLA, a space at the start or end of the SKU, missing HSN or tax code |

### Where the data comes from (all read-only)

| Data | How often | Edge Function |
|---|---|---|
| Stock, prices, tax details | Every day 8:00 AM IST, and Sync now | `stock-sync` (Phase 3) |
| Pending orders due in the next 2 days | Every 30 minutes from 7 AM to 10 PM IST, and Sync now on the Orders tab | `orders-sync` |
| Every pending order however far ahead (Upcoming), and orders in transit (shipped in the last 14 days) | Every night at 10:30 PM IST, and "Read all upcoming" on the Upcoming tab | `orders-sync` |
| Shipped orders (last 4 days), cancellations, returns | Every day about 9:10 AM IST, and Sync now on the Returns tab | `orders-sync` |
| The last 30 days of shipped orders, cancellations and returns (one time) | Nightly from 10:15 PM to 6:45 AM IST until done | `orders-sync` |

The order code can make exactly four kinds of request (get a token, search shipments, list returns, fetch the next page of either)
and refuses anything else before it is sent. Flipkart facts that shaped it, all found by testing the real API: shipments come 20
to a page and returns 25; a page takes 2 to 16 seconds; the "next page" address must be fetched (GET), not searched again; Flipkart
stops any single search at 5,000 results, so the pending sweep reads each state at each warehouse separately, only orders due in the
next 2 days (Flipkart lists orders scheduled about two weeks ahead, over a thousand at a busy warehouse), the nightly upcoming sweep
reads APPROVED orders in dispatch-date chunks (up to 2 days, then 3-day and weekly chunks, then the rest of the year) at each warehouse,
and any run stops with an error rather than save a list that was cut short; `PACKING_IN_PROGRESS` combined with the dispatch-date sort answers 500, so that state is read unsorted;
returns carry no SKU, so it is found from the order (returns for orders older than our history show "not known").
Marketplace cancellations are not read (not confirmed to work).

**Never kept:** buyer names, phones, addresses, prices paid, payment type, product titles from orders, tracking numbers, and the
free-text `comments` of a return. Only order ID, SKU, quantity, warehouse, dates, status and the return or cancellation reason are
saved. Orders and returns are kept 12 months, price changes 12 months, daily stock and prices 60 days.

### How a run works

A run is a plan (a list of parts) plus a position (which part, and Flipkart's address of the next page). Each page is saved
together with the new position in one transaction, so a run that stops carries on from the next page, never twice and never
missing one. One run works at a time; it waits (without failing) while a stock sync or another order run is working. A watchdog
(every 5 minutes) restarts a run whose worker was cut off. The backfill additionally waits for the night, newest day first, so
the recent days are complete first.

### When an order counts as gone (`left_pending`)

A sweep only says an order has left the pending list if it looked where the order would be: the order's warehouse, in every
pre-dispatch state (it may have moved on), over a dispatch-by window that holds the order's dispatch-by, and the order was not in it.
The daytime sweep looks 2 days ahead, so it never marks an order due later than that as gone; those stay Upcoming until the nightly
sweep, which covers everything, decides. (Before this, the 2-day sweep marked 1,469 orders as gone that Seller Hub still showed as
Upcoming.)

### Alerts

When a pending or upcoming sweep finishes, every Active order (dispatch-after reached) that is within 4 hours of its dispatch
deadline (or just past it), not on hold and not Under Processing is counted once, ever (`alerted_at`), and the owner and managers get
one push per sweep: "3 orders may miss their dispatch deadline: Delhi 2 · Bhiwandi 1 · earliest 2:30 pm". Orders first found already
more than an hour late are marked without an alert. Under Processing (`PACKING_IN_PROGRESS`) is Flipkart's own work; Seller Hub says
those delays do not affect account health, so they never alert.

### The Orders tab

It uses Seller Hub's tabs and words, per warehouse. Counts are orders as Seller Hub counts them: shipments.

| Tab | Which orders |
|---|---|
| To Accept | APPROVED (or FORM_FAILED), dispatch-after now or past |
| To Pack | PACKED, dispatch-after now or past |
| To Dispatch | READY_TO_DISPATCH, dispatch-after now or past |
| Upcoming | Any of those with dispatch-after still in the future |
| Under Processing | PACKING_IN_PROGRESS, whatever its dates. Shown on its own, never late, never in Needs action |
| In Transit (count only) | Shipped, not yet delivered, as last read (nightly for 14 days of orders, every morning for 4) |

To Accept + To Pack + To Dispatch = Active. A warehouse card shows the three Active counts, Upcoming, Under Processing and In
Transit, and the next dispatch-by among Active orders (red when today or late). Tap a card to look at one warehouse.

Views:

| View | What it shows |
|---|---|
| By SKU | One row per SKU (like Seller Hub's Smart Groups) for the chosen tab: title, orders, units, units per warehouse, earliest dispatch-by (red if an Active one is today or late), counts per tab. Tap it for its orders (order ID, qty, warehouse, status, dispatch-by) and stock at each warehouse vs units ordered there, with a red "short by N" |
| Order list | Every order line in the chosen tab, sortable, with CSV |
| Pick list | One warehouse: SKU x units still to pack (To Accept and To Pack, not on hold) for Active orders due today or late, or all Active; stock next to it; sortable, CSV |
| Upcoming vs stock | Per SKU and warehouse: units in Upcoming orders against current stock, shortfalls first ("Short of stock" filter), with when the first becomes Active |
| Cancelled | Cancellations in 30 days, seller and buyer apart, counts per day |

### Days left ("running out soon")

Per SKU and warehouse: units in stock ÷ units used per day. Units used per day come from real orders (the larger of the 7-day and
14-day averages, cancelled orders left out, today left out) once 7 days of shipped orders are in; for a SKU with no orders at that
warehouse they come from the drop between daily stock snapshots (days where stock went up are left out), once 7 days of snapshots
exist. Until then the page says "collecting data, ready on <date>" and flags nothing.

### Return rate

Returns created in the last 30 days ÷ units shipped in the last 30 days, per SKU. Flagged above the setting once at least 10 units
were sold. Shown only once 30 days of shipped orders are loaded.

### Settings added in Phase 4 (owner only)

| Setting | Normal | Meaning |
|---|---|---|
| Price drop alert (%) | 15 | An overnight drop in selling price bigger than this is flagged |
| Slow dispatch: days | 2 | A listing whose dispatch SLA is above this is flagged |
| Running out soon: days | 7 | A SKU with fewer days of cover is flagged |
| High return rate (%) | 10 | A SKU returned above this share of units sold in 30 days is flagged |

### Checking and running it by hand

- Last runs: `select kind, status, step, parts, pages, items_saved, error, notes, created_at, finished_at from order_runs order by created_at desc limit 8;` (`notes` says how many orders each sweep marked gone)
- Start one: `select private.start_order_run('pending', 'manual', null);` (or `'daily'`, or `'upcoming'` for the full nightly sweep, about 30 minutes)
- Seller Hub counts per warehouse, to compare: see the query in `supabase/tests/seller_hub_counts.sql`.
- The backfill: `select private.start_order_backfill();` creates it (it also starts itself every night until it has finished once).
- Schedule: `select jobname, schedule from cron.job where jobname like 'orders-%';` (UTC; IST is UTC + 5:30).
- Logs: Supabase > Edge Functions > orders-sync > Logs (every line is scrubbed of secrets).
- Changing the function: edit `supabase/functions/orders-sync/`, then `npx supabase functions deploy orders-sync --no-verify-jwt --use-api`.
- Seller Hub links are in `src/lib/seller-hub.ts`.

## Folder map

```
src/app/(auth)        login, change-password
src/app/(app)         My work (/), /all, /posts/new, /posts/[id], /tickets (+ /new, /[id]), /notifications, /flipkart (/stock redirects), /admin/users, /admin/settings
src/app/dev/preview   fake-data layout preview (development only)
src/components        ui, navigation, posts, tickets, notifications, stock, flipkart, admin, auth
src/lib               supabase clients, auth, types, validation (zod), formatting (IST, Indian numbers)
src/server/actions    server actions; every input is validated again here
src/proxy.ts          keeps the session fresh, redirects signed-out visitors to /login
supabase/migrations   schema, RLS, storage rules
supabase/functions    Edge Functions (notify: push and the daily digests; stock-sync: the Flipkart stock sync; orders-sync: orders, returns, cancellations)
supabase/tests        rls_check.sql, phase2_check.sql, phase3_check.sql, phase4_check.sql
supabase/seed.sql     fake data for local development only
public/sw.js          service worker (installable app; shows push messages)
```
