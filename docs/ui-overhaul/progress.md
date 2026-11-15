# UI overhaul: progress and decisions

Branch `ui/overhaul` from `main` 144ad5f. Started 2026-11-15 00:30 IST. Resume from the last section below.

## How to run it

```bash
git checkout ui/overhaul
npm install
npm run dev          # http://localhost:3000  (fake data without sign-in: /dev/preview?view=deck)
```

Checks after each area: `npx tsc --noEmit`, `npm run lint`, `npm test`. At the end `npm run build`.
Screenshots: `docs/ui-overhaul/screens/before/*` (taken at 144ad5f) and `.../after/*`, desktop 1440 light and
phone 390 dark, from `/dev/preview` views. Script: scratch `shoot.sh` (Playwright via npx, not a dependency).

## Rules kept

- Presentation only: nothing in `supabase/`, `src/server/`, API routes, `src/proxy.ts`, auth, access rules or
  `src/lib` calculations is changed. Role visibility is exactly as before.
- No new runtime dependency. Playwright is run through `npx` for screenshots only and is not in package.json.
- The dev preview may gain a `?role=` switch and more fixtures; it is development-only (404 in production).

## Design plan (decided before coding)

**Subject.** An operations desk for a Flipkart seller with five warehouses: the job is to say what must happen in
the next few hours (dispatch deadlines, empty shelves, tickets due), and to make every number legible at a glance,
on a phone in a warehouse and on the owner's laptop.

**Signature visual: warehouse lanes.** One horizontal lane per warehouse, orders flowing left to right through
To Accept → To Pack → To Dispatch, late orders as a red block at the gate, the next pickup time at the end of the
lane. It is the hero of the Command Deck, the warehouse row of the Flipkart Orders tab and the "orders waiting"
panel of the Dashboard, so the product is recognisable from any of its main screens.

**Colour (two modes, chosen by the same theme switch).**

| token | light | dark | job |
|---|---|---|---|
| canvas | #f4f3ef | #111113 | page |
| surface / surface2 | #ffffff / #ecebe6 | #19191c / #222226 | cards, controls |
| line / line-soft | #d9d7d0 / #e8e6df | #2e2e34 / #242429 | hairlines |
| ink / muted / faint | #141416 / #5d5c58 / #8a8882 | #f3f2ee / #a3a29c / #7d7c77 | text |
| accent | #4f3ed7 | #8b7cff | the one brand colour: links, primary buttons, active nav |
| bad / warn / ok | #c81e30 / #8a5a00 (marks #e08a00) / #1c7a46 | #ff5a68 / #ffc24d / #46d68e | status only, never decoration |
| wh-1..5, stage-1..3 | unchanged (validated for colour-blind readers) | unchanged | warehouses, order stages |

Gone: the frosted glass, the mesh background, coloured glows under buttons, gradient text, per-card staggered
fade-ups. Cards are flat with a hairline; stat strips are numbers divided by hairlines; tables are ledgers.

**Type.** Archivo (UI and headings; a grotesk with real weight range and a width axis) and IBM Plex Mono (every
figure, SKU, order ID; tabular). Base 16px, line-height 1.5. Display numbers 56–72px mono 600, tight tracking.
Small labels are sentence case, not tracked capitals.

**Layout.** Desktop: a 232px sidebar with labels, grouped Operate / Marketplace / Admin (collapses to icons under
1100px). Phone: bottom bar of five with More. Each page opens with a headline sentence whose numbers are coloured
inline, then one dominant element, then supporting detail. Flipkart's ten tabs become four groups: Today
(Needs action, Orders, Overfill), Stock (Stock, Stock-outs, Forecasting), Listings (Prices, Listing health,
Master SKUs), Returns.

**Motion.** One orchestrated moment per page load (the headline number counts up and the lanes fill), hover and
press feedback on controls, and nothing else. Everything respects prefers-reduced-motion.

**Push banner.** No longer a card at the top of every page: a single-line bar on the Command Deck only (Turn on /
Not now), and the full card stays on the Notifications page.

## Area log

### 0. Setup (done)
- Baseline at 144ad5f: tsc, lint and 298 tests clean (after `npm ci`; node_modules was broken).
- `docs/ui-overhaul/inventory.md` written; before screenshots taken.

### 1. Design system and app shell (done)
- Ledger tokens (light, dark, auto), Archivo and IBM Plex Mono, flat hairline cards, stat strips, ledger tables.
- Sidebar grouped Operate / Marketplace / Admin with labels from 1100px, icon rail from 561px, bottom bar on phones. Same role rules as before.
- New `Lanes` component (src/components/signal/lanes.tsx): one lane per warehouse, stages left to right, late block at the gate.
- Push banner is now one line and shows on the Command Deck only; the full card stays on Notifications.
- Old entrance animations (sp-reveal, sp-lift, sp-glow, sp-fade, sp-wipe) are kept as class names but do nothing, so no page breaks.

### 2. Command Deck and Dashboard (done)
- Command Deck: headline sentence, then the dispatch board as the one dominant element (today count, capacity bar, stat strip, warehouse lanes). The old Warehouses and Orders by stage cards are merged into the lanes; every figure is still shown.
- Then orders trend, pulses strip, priority queue, dispatch chart, stock health, movers, stock by warehouse.
- Dashboard: headline sentence with profit figures, four tiles, then the same panels in a calmer layout; Orders waiting uses the lanes.
- Decision: Dashboard has no fake-data preview view (owner P&L data), so it has no file screenshot; it was type-checked and linted only.
- Checks: tsc clean, lint clean, 298 tests pass.

### 3. Flipkart page and tabs (done)
- Tabs regrouped into Today (Needs action, Orders, Overfill), Stock (Stock, Stock-outs, Forecasting), Listings (Prices, Listing health, Master SKUs), Returns. Addresses unchanged (`/flipkart?tab=...`). A group shows only if the role may open one of its tabs, so warehouse users do not see Listings.
- Orders tab: the warehouse cards became the lanes (tap a lane to filter, same as the old cards). Every count is kept: three stages, late, next deadline, upcoming, processing, in transit, on hold.
- SKU list: one ledger card with a row per SKU instead of a card each; the same fields, about half the scrolling.
- Other tabs take the new look from the design system (flat cards, ledger tables, sentence-case labels).
- Fix: sidebar labels were hidden on desktop because the CSS build reordered two rules; now a max-width rule.
- Sweep across all pages: capital-letter labels, extra-heavy weights, oversized corners, hover lifts and blur removed (class changes only).
- Checks: tsc clean, lint clean, 298 tests pass.

### 4. Work board, posts, Tickets, Notifications (done)
- Work board: headline sentence (open, overdue, due today, coloured), sections with a rule and a count.
- Phone bottom bar is now Deck, Work, Tickets, Flipkart, More, so the work board and tickets are in thumb reach. Decision: Forecast and Team moved under More to make room; nothing was removed.
- Alert and notification cards: no coloured side bar or boxed icon; an inline icon and chip carry the urgency, plus the unread dot. Same text, same links, same buttons.
- Notification filters are 44px tall. Post, ticket and form pages take the new look from the design system.
- Preview role switch added: `/dev/preview?view=...&role=owner|admin|warehouse`. It only changes the fake shell and the Flipkart tab list in the preview; no real role or access check is touched.
- Checks: tsc clean, lint clean, 298 tests pass.
