# VR Prime Ops: "Aurora Glass" redesign specification

Written 15 Nov 2026 for branch `ui/glass`. Every design decision is made here. The implementer does not choose colours,
fonts, sizes, layouts, motion or component styles. Where this document is silent, section 11 says exactly what to do.

Owner's brief: dark, layered glass with depth; moderate animation; balanced density (key things large, detail one scroll
away); the Command Deck leads with late and at-risk orders, then team work and tickets. Every item in
`docs/ui-overhaul/inventory.md` stays visible to the same roles.

---

## 1. Colour tokens

All colour lives in `src/app/globals.css` as CSS variables. Components use only these variables (through the existing
Tailwind token classes). No hex or rgba value may appear in a component file. Replace the current "Ledger" values with
the ones below, keeping every existing variable name, and add the new variables listed under "New".

Dark is the designed theme. With no theme cookie ("Auto"), the site is dark on every device: remove the
`prefers-color-scheme` block so Auto means dark. The Light option in the account menu stays and uses the light column.

| Variable | Dark | Light |
|---|---|---|
| `--canvas` | `#07080d` | `#eef0f7` |
| `--surface` | `rgba(255,255,255,0.055)` | `rgba(255,255,255,0.66)` |
| `--panel2` | `rgba(255,255,255,0.085)` | `rgba(255,255,255,0.82)` |
| `--surface2` | `rgba(255,255,255,0.04)` | `rgba(16,18,28,0.045)` |
| `--line` | `rgba(255,255,255,0.12)` | `rgba(16,18,28,0.12)` |
| `--line-soft` | `rgba(255,255,255,0.07)` | `rgba(16,18,28,0.07)` |
| `--ink` | `#f4f5fa` | `#10121c` |
| `--muted` | `#a9adbd` | `#555a70` |
| `--faint` | `#7b8094` | `#80859a` |
| `--accent` | `#8b7bff` | `#5b46f0` |
| `--accent-ink` | `#0b0a1a` | `#ffffff` |
| `--accent-soft` | `rgba(139,123,255,0.16)` | `rgba(91,70,240,0.10)` |
| `--accent-text` | `#b9afff` | `#4534c8` |
| `--cyan` | `#3ddbe8` | `#0e8fa0` |
| `--cyan-soft` | `rgba(61,219,232,0.14)` | `rgba(14,143,160,0.10)` |
| `--madder` | `#ff5d73` | `#d6283c` |
| `--bad` | `#ff5d73` | `#c81e30` |
| `--bad-soft` | `rgba(255,93,115,0.14)` | `rgba(200,30,48,0.09)` |
| `--bad-ink` | `#14060a` | `#ffffff` |
| `--warn` | `#ffbe4d` | `#8a5a00` |
| `--warn-soft` | `rgba(255,190,77,0.14)` | `rgba(138,90,0,0.10)` |
| `--warn-mark` | `#ffb020` | `#e08a00` |
| `--ok` | `#3fdc97` | `#1c7a46` |
| `--ok-soft` | `rgba(63,220,151,0.14)` | `rgba(28,122,70,0.10)` |
| `--info` | `#7cc4ff` | `#1f6fb8` |
| `--info-soft` | `rgba(124,196,255,0.14)` | `rgba(31,111,184,0.10)` |
| `--wh-1` | `#2fe0c2` | `#00968a` |
| `--wh-2` | `#5b8cff` | `#2f4fb3` |
| `--wh-3` | `#ff9a4d` | `#d1602a` |
| `--wh-4` | `#b48bff` | `#8a63d9` |
| `--wh-5` | `#ff5fa8` | `#a8296a` |
| `--stage-1` (To Accept) | `#4b3fb0` | `#c9b3f5` |
| `--stage-2` (To Pack) | `#8b7bff` | `#8f5de8` |
| `--stage-3` (To Dispatch) | `#d6ccff` | `#5b21b6` |
| `--scrim` | `rgba(3,4,8,0.72)` | `rgba(16,18,28,0.45)` |
| `--radius` | `12px` | same |
| `--radius-lg` | `20px` | same |
| `--shadow-card` | `inset 0 1px 0 rgba(255,255,255,0.07), 0 24px 48px -28px rgba(0,0,0,0.75)` | `inset 0 1px 0 rgba(255,255,255,0.9), 0 18px 40px -26px rgba(16,18,28,0.25)` |
| `--shadow-pop` | `0 32px 80px -20px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.10)` | `0 28px 64px -24px rgba(16,18,28,0.35), 0 0 0 1px rgba(16,18,28,0.08)` |
| `--glow` | `0 0 28px -6px currentColor` | `none` |
| `--paper` | `none` | `none` |

New variables:

| Variable | Dark | Light |
|---|---|---|
| `--pop` (menus, sheets, palette, tooltips) | `rgba(16,18,28,0.92)` | `rgba(255,255,255,0.94)` |
| `--blur-card` | `14px` | `14px` |
| `--blur-bar` | `22px` | `22px` |
| `--grad-accent` | `linear-gradient(135deg,#8b7bff 0%,#3ddbe8 100%)` | `linear-gradient(135deg,#5b46f0 0%,#0e8fa0 100%)` |
| `--grad-bad` | `linear-gradient(135deg,#ff5d73 0%,#ff9a4d 100%)` | `linear-gradient(135deg,#c81e30 0%,#d1602a 100%)` |
| `--grid` (chart gridlines) | `rgba(255,255,255,0.06)` | `rgba(16,18,28,0.07)` |

Page background (on `body`, `background-attachment: fixed`), dark:
```
radial-gradient(900px 600px at 12% -5%, rgba(109,74,255,0.30), transparent 60%),
radial-gradient(800px 560px at 92% 4%, rgba(25,198,217,0.20), transparent 60%),
radial-gradient(900px 700px at 60% 105%, rgba(255,61,154,0.13), transparent 60%),
#07080d
```
Light: the same three gradients at alpha `0.14`, `0.10`, `0.07` over `#eef0f7`.

Colour meaning never changes: red = late or failed, amber = at risk or low, green = fine, violet/cyan = neutral emphasis.
Warehouse colours are used only for warehouse dots, lane labels and warehouse series in charts.

## 2. Type

Load with `next/font/google` in `src/app/layout.tsx`, replacing Archivo and IBM Plex Mono:

- **Manrope** (400, 500, 600, 700): all interface text. CSS variable `--font-sans`.
- **Unbounded** (500, 600): page titles, the hero number, big stat numbers only. Variable `--font-display`.
- **Geist Mono** (400, 500, 600): every figure in a table, every SKU, order ID, ticket ID, date-time. Variable
  `--font-mono`. Always `font-variant-numeric: tabular-nums`.

| Role | Font | Size / line | Weight | Other |
|---|---|---|---|---|
| Page title (H1) | Unbounded | 26 / 32 px (phone 21 / 26) | 500 | letter-spacing -0.02em |
| Headline sentence | Manrope | 24 / 32 px (phone 19 / 26) | 600 | numbers in it: Unbounded 500, coloured by tone |
| Hero number | Unbounded | 76 / 76 px (phone 54 / 54) | 600 | text filled with `--grad-accent`; `--grad-bad` when late > 0 |
| Stat number | Unbounded | 28 / 32 px (phone 24 / 28) | 500 | |
| Card title | Manrope | 15 / 20 px | 700 | |
| Body | Manrope | 14 / 20 px | 400 | |
| Table cell | Manrope or Geist Mono | 13 / 18 px | 400 (figures 500) | |
| Caption, helper | Manrope | 12 / 16 px | 400 | colour `--muted` |
| Label (above stats, table headers) | Manrope | 11 / 14 px | 600 | uppercase, letter-spacing 0.08em, `--faint` |
| Chip | Manrope | 11 / 14 px | 600 | |

## 3. Layout and spacing

- Content max width 1480 px, centred. Page padding: 24 px (≥1100), 16 px (700–1099), 12 px (<700).
- Grid: 12 columns ≥1100 px; 6 columns 700–1099 px; 1 column <700 px. Gap 16 px (phone 12 px).
- Card padding 20 px (phone 14 px). Space between a card title block and its content: 14 px.
- Table rows: 44 px tall, cell padding 12 px horizontal. Toolbar controls: 40 px tall.
- Balanced density rule: the first screen of every page shows its headline and its one dominant element without
  scrolling at 1440×900; everything else may sit below.

## 4. Components (restyle the existing ones in place; do not create parallel versions)

**Card** (`Card` in `src/components/ui.tsx`, and every panel that draws its own box): background `--surface`,
`backdrop-filter: blur(var(--blur-card)) saturate(140%)`, border 1px `--line`, radius `--radius-lg`, shadow
`--shadow-card`. Under 700 px wide: no backdrop-filter; background `rgba(20,22,34,0.78)` dark, `rgba(255,255,255,0.9)`
light (add as `--surface-solid`). Cards never nest glass on glass: an inner box uses `--surface2`, radius `--radius`,
no blur, no shadow.

**Hero card** (one per page, section 6): same as Card plus a 1px gradient border made with `--grad-accent` at 55%
opacity, and a soft inner radial highlight `radial-gradient(420px 220px at 0% 0%, rgba(139,123,255,0.18), transparent 70%)`.

**SectionHead / card header**: title (Card title style) left; optional caption under it; `action` slot right-aligned.

**Stat and StatStrip**: one Card split into equal cells by 1px vertical dividers
(`linear-gradient(to bottom, transparent, var(--line), transparent)`). Cell: Label, Stat number, caption, optional
sparkline 36 px tall along the bottom. Under 700 px the strip scrolls sideways with scroll-snap, each cell 62% wide.

**Chip**: pill (radius 999 px), height 22 px, padding 0 9 px, background the tone's `-soft` colour, text the tone colour,
1px border of the tone colour at 28% opacity. Neutral: `--surface2`, `--muted`, border `--line-soft`.

**Buttons** (`buttonClass`): height 40 px, radius `--radius`, Manrope 13 px 600, padding 0 16 px.
- primary: background `--grad-accent`, text `--accent-ink`, `inset 0 1px 0 rgba(255,255,255,0.35)`; hover brightness 1.08.
- secondary: background `--surface`, border 1px `--line`, text `--ink`; hover background `--panel2`.
- ghost: no background or border, text `--accent-text`; hover background `--accent-soft`.
- danger: background `--bad-soft`, border 1px `--bad` at 40%, text `--bad`.
- Focus (all controls): 2px outline `--accent`, offset 2px.

**Inputs, selects, textareas** (`Field`): height 40 px, background `--surface2`, border 1px `--line`, radius
`--radius`, text 14 px; placeholder `--faint`; focus border `--accent` plus `0 0 0 3px var(--accent-soft)`.

**Segmented control / tabs**: container pill with `--surface2` background, 1px `--line-soft` border, padding 3 px,
radius 999 px; options 32 px tall, 13 px 600, `--muted`; active option background `--accent-soft`, text
`--accent-text`, border 1px `--accent` at 35%. Counts inside options use Geist Mono 12 px.

**Tables** ("glass ledger"): inside a Card with zero padding. Header row sticky, background `--pop`, Label style.
Rows divided by 1px `--line-soft`; hover background `rgba(255,255,255,0.04)` (light `rgba(16,18,28,0.03)`). Numbers
right-aligned in Geist Mono. First column sticky when the table scrolls sideways on phones. Expanded rows: background
`--surface2`. No zebra stripes.

**Toolbars** (filters above tables): one Card, 12 px padding, controls in a single wrapping row with 8 px gaps:
view switch first, filters next, search grows to fill, CSV and other buttons last. Under 700 px: a 2-column grid of
full-width controls, search spanning both columns. Do not move filters into sheets.

**Tone rows** (priority queue, Needs action, alerts): row inside a Card, 3px left bar in the tone colour
(`--grad-bad` for late), kind Chip, title 14 px 600, detail caption, actions right (stack under on phone).

**Popovers, menus, command palette, Sheet, tooltips**: background `--pop`, `backdrop-filter: blur(var(--blur-bar))`,
border 1px `--line`, radius `--radius-lg` (tooltips `--radius`), shadow `--shadow-pop`. Scrim `--scrim`.

**Empty state**: centred in its Card, 32 px icon in `--faint`, title 15 px 700, body caption, action button below.

**Skeletons**: `--surface2` blocks with a sweeping highlight `linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent)`,
1.2 s loop.

**Toasts**: `--pop` background, 3px left tone bar, bottom-centre on phone, bottom-right on desktop.

**Scrollbars**: 8 px, thumb `--line`, track transparent.

## 5. Charts (`src/components/signal/charts.tsx`, `lanes.tsx`, `kpi.tsx`, `count-up.tsx`)

- Gridlines `--grid`, 1px; axis labels Geist Mono 11 px `--faint`. No chart borders.
- **AreaChart / TrendChart**: line 2 px in the series colour with `filter: drop-shadow(0 0 6px <series colour at 55%>)`;
  fill a vertical gradient from the series colour at 34% to 0%. Average line 1px dashed `--muted`. Latest point: 4 px
  dot with a 10 px ring at 30%. Default series colour `--accent`; second series `--cyan`.
- **Sparkline**: 1.5 px line, same gradient fill at 22% to 0%.
- **Bars** (`Bar`, grouped bars, day-by-day bars): radius 6 px, fill a vertical gradient from the series colour to the
  same colour at 60%.
- **ShareBar / StackedRows / PairedRows**: tracks `--surface2`, 10 px tall, radius 999 px, 2 px gaps between parts.
- **Gauge and ring charts**: 6 px stroke, track `--surface2`, value stroke `--grad-accent` (tone colour when the tone is
  bad, warn or ok), round caps, centre number in Unbounded.
- **Lanes (the signature visual)**: one row per warehouse. Left: 8 px warehouse dot with a glow in its colour, name
  14 px 600, status Chip. Middle: a track 30 px tall, radius 10 px, background `--surface2`, holding the three stage
  segments (`--stage-1`, `--stage-2`, `--stage-3`) each with its count centred in Geist Mono 12 px 600 (hide the count
  when the segment is narrower than 34 px). A late marker is a 3 px vertical bar in `--bad` with `--glow`, at the track's
  right edge. Under the track: "N% on time" left and "next dispatch …" right, caption style; late text in `--bad`.
  Right: active count in Unbounded 20 px and "active · N out" caption. Rows separated by 1px `--line-soft`. Legend
  below. Tapping a lane keeps its current behaviour. The same component is used wherever the inventory says "lanes".

## 6. Motion (moderate)

- Hover and press: 160 ms ease-out colour and background only.
- Page content: each top-level card fades in and rises 10 px, 260 ms `cubic-bezier(0.2,0.8,0.2,1)`, staggered 40 ms,
  first 8 cards only.
- Charts draw once on first view: lines over 700 ms, bars and lane segments grow from zero over 600 ms with a 60 ms
  stagger, gauges sweep over 700 ms.
- CountUp: the hero number and Stat numbers count from 0 over 600 ms, once.
- Looping animation is allowed only on: the late marker in lanes and the late Chip (opacity 1 → 0.55 → 1 over 2 s),
  the unread bell ring (existing), skeleton sweep, and the sync progress bar.
- Sheets and menus: 200 ms fade and 8 px slide.
- `prefers-reduced-motion: reduce`: no movement, no drawing, no counting, no loops; opacity fades of 120 ms at most.
- Nothing else moves. No parallax, no hover lift, no animated backgrounds.

## 7. App shell

- **Side rail** (≥1100 px): 236 px wide, full height, sticky; background `--surface`, blur `--blur-bar`, right border
  1px `--line`. Top: "VR" mark (32 px square, radius 9 px, `--grad-accent`, text `--accent-ink`, Unbounded 13 px 600)
  and "VR Prime Ops" 15 px 700. Groups with Label headings: **Operate** (Command Deck, Dashboard, Work board, Tickets,
  Team), **Marketplace** (Flipkart, Forecast, Ads tracker, Review tracker), **Admin** (P&L, People, Settings). Items
  40 px tall, radius 10 px, icon 18 px + label 14 px 500 `--muted`; hover `--surface2`; active: background
  `--accent-soft`, text `--ink`, icon `--accent-text`, and a 3 px × 18 px `--grad-accent` bar at the left edge. Role
  visibility of each item is unchanged.
- 700–1099 px: rail 72 px wide, icons only, labels as tooltips, group headings hidden (8 px gap between groups).
- **Bottom bar** (<700 px): fixed, 64 px plus safe-area inset, background `--pop`, blur `--blur-bar`, top border 1px
  `--line`. Items: Deck, Work, Tickets, Flipkart, More. Icon 20 px, label 10 px 600. Active: icon and label
  `--accent-text` with a 4 px `--grad-accent` dot above the icon. More opens the existing sheet with the rest.
- **Top bar**: sticky, 64 px (phone 56 px), background `--surface`, blur `--blur-bar`, bottom border 1px `--line`.
  Left to right: search box (pill, 420 px max, `--surface2`, "Ctrl K" hint chip), spacer, sync status (8 px dot green
  or amber + "Synced 42s ago · scope" caption), Sync now (secondary), + Post (primary), bell, avatar (32 px circle,
  `--surface2`, initials 12 px 700). Phone: mark, search icon button, + Post icon button, bell, avatar; the sync status
  moves into the first line of each page under the title.
- **Push banner**: stays as built on `main` (one line on the Command Deck, full card on Notifications); restyle as a
  slim Card with a ghost "Not now" and a secondary "Turn on notifications".
- **Dev preview bar** (`/dev/preview` only): a single Card, caption-size links, wraps; not sticky.

## 8. Pages

Columns are out of 12 at ≥1100 px. At 700–1099 px every block that is under 12 columns becomes half width (pairs side by
side) unless marked "full". Under 700 px everything stacks in the order written.

### 8.1 Command Deck `/`
1. Header: Label "Operations · date · time"; headline sentence; buttons right: Open priority queue (primary), Jump to
   Flipkart (secondary). Notes line (when present) as a caption under the headline. Push banner under that.
2. **Hero card, 5 cols**: Label "To dispatch today"; hero number; late Chip beside the label; sentence "orders still
   to go out today across N warehouses"; capacity bar (owner and admin only: 8 px track, `--grad-accent` fill, caption
   under it); then a 3-cell inner strip: Yesterday, 7-day avg, Busiest.
   **Warehouse lanes card, 7 cols**: title "Where the orders are", caption, total active as a Stat number, the lanes.
3. **Pulse strip, full**: StatStrip of the three pulses (Late dispatch, Out of stock, Due tomorrow), each a link.
4. **Priority queue, two cards built from the same queue list** (no item dropped, same order within each card):
   - "Orders and stock", 7 cols: items of kind Late, Risk, Overfill, Dry.
   - "Work and tickets", 5 cols: items of kind Work, Ticket; the open-tickets count from the stock-health tiles is
     repeated as a Chip in this card's header ("N open tickets", links to Tickets).
   Each card shows "N to do" (its own count) or "All clear", its first 6 rows, and "Show N more". If the queue items
   do not carry a kind that allows this split, keep one full-width queue card and say so in the report.
5. "Orders a day" 7 cols; "Dispatch, last 7 days" 5 cols.
6. "Stock by warehouse" 6 cols; "Stock health" 6 cols as a 5-cell StatStrip that wraps to 3 + 2.
7. "Forecast, top movers" full: rows in two columns at ≥1100 px.

### 8.2 Dashboard `/dashboard` (owner)
1. Greeting as page title; month Chip right.
2. Four tiles: **Profit after ads = hero card, 5 cols** (number in hero style at 54 px, margin Chip, previous month,
   "On pace for …"); Revenue 3 cols; Ads 2 cols; To dispatch today 2 cols.
3. Pulse strip, full.
4. Orders a day 7 cols; Where the money went (ring) 5 cols.
5. Month by month 7 cols; Products by profit 5 cols.
6. Orders waiting by warehouse (lanes) 7 cols; Needs a look 5 cols.

### 8.3 Flipkart `/flipkart`
- Page title + per-tab subtitle. First-level segmented control: Today, Stock, Listings, Returns. Second level under
  it: ghost-style pills for the tabs in that group (grouping and `?tab=` addresses as on `main`).
- **Needs action**: caption; each section is a Card with a tone bar header (title, count Chip), tone rows, Show N more.
  Two columns of section cards at ≥1100 px, most urgent first reading left to right.
- **Orders**: sync bar as a slim Card (status left, Sync now right, progress bar 4 px under); lanes Card (hero card of
  this tab); toolbar; then the By SKU ledger / Order list / Cancelled tables as glass ledgers. The "Could not load"
  alert is a tone row in `--bad`, not a full-width red block.
- **Stock**: sync bar; warehouse StatStrip (tap to filter); list switch as segmented control; toolbar; table.
- **Stock-outs**, **Forecasting**, **Overfill Orders**, **Returns**, **Prices**, **Listing health**: status lines as
  captions or tone rows; any stat tiles as a StatStrip; toolbar; glass ledger tables. Returns' three tiles are a
  StatStrip. Forecasting's ranked list uses the Forecast row style from the Command Deck.
- **Master SKUs**: toolbar; "new master" form as a Card; product list as Cards with chips; "Not linked yet" and
  "Removed" as glass ledger tables.

### 8.4 Work board `/work` and All posts `/all`
- Header: My work / Everything segmented control; headline sentence.
- Work board: three columns at ≥1100 px, each a Card titled Overdue, Due today, Next with its count Chip, post cards
  stacked inside (inner boxes, `--surface2`). Stacked in that order below 1100 px.
- Post card: 3 px left bar (`--bad` overdue, `--warn` due today or High/Urgent, otherwise `--line`); first line
  VR-N in Geist Mono + chips; title 15 px 600 (2 lines max); meta line (assignee · warehouse · SKU) caption; due Chip
  bottom right.
- All posts: toolbar Card; grid of post cards 3 / 2 / 1 columns.

### 8.5 Post page, new post, edit
- ≥1100 px: left 8 cols: header card, new-listing cards, done card, photos, comments. Right 4 cols (sticky under the
  top bar): Actions card first, then facts, Tickets card, History.
- Below 1100 px: header, Actions, then the rest in the order above.
- New post: type picker as four large option cards (2 × 2, icon + name + hint); form in one Card, 2-column fields at
  ≥700 px.

### 8.6 Tickets
- Header: title, headline sentence, + Ticket (primary). Groups as a segmented control with counts; toolbar; ticket
  cards in a 3 / 2 / 1 grid, styled like post cards (left bar `--bad` when follow-up is due).
- Ticket page: form Card 8 cols, linked post Card 4 cols; stacked on phone.

### 8.7 Notifications
- Single column, max width 780 px, centred: title + Mark all read; "Alerts on this phone" Card; filter pills;
  notification tone rows grouped in one Card.

### 8.8 Ads tracker `/ads`
1. Title; scan picker and Sync right; notes as captions.
2. Needs a look 5 cols; Average daily spend chart 7 cols.
3. Every tracked SKU: toolbar + glass ledger, full.
4. Campaign form 4 cols; Campaign log table 8 cols.
5. Tracked SKUs, full.

### 8.9 Ads Desk `/ads/desk`
1. Title; dates picker and Sync reports right. Section nav as a sticky pill row under the top bar.
2. Where every rupee went 7 cols; By placement 5 cols.
3. Problem cards in a 2-column grid: Losing money, Changed for the worse, Bids to cut, Winners with room, Leaks,
   Spend spikes. Each is a Card with a tone bar header (bad, bad, warn, ok, warn, warn) and tone rows.
4. Every campaign, Products, Search terms, Keywords, Negatives, Day of week: each a full-width glass ledger Card with
   its toolbar. The campaign sheet uses the Sheet style and the chart rules above.

### 8.10 Review tracker `/reviews`
1. Title; check picker and Sync now right; note as caption.
2. Four tiles as a StatStrip.
3. Progress by priority 7 cols; Check by check trend 5 cols.
4. Nearly there / Furthest away 6 cols; Reviews removed 6 cols.
5. Per-priority link groups: Cards in a 2-column grid. 6. Every link: toolbar + glass ledger, full.

### 8.11 Team `/team`
1. Headline sentence; Suggestions as tone rows in a Card.
2. Attendance 5 cols; "Orders against what the team can pack" chart 7 cols.
3. Per-warehouse 7-day cards: one row of five (wraps 3 + 2 at 700–1099 px, sideways scroll on phone).
4. Day by day grid, full. 5. The team, month: glass ledger, full.
6. Owner tools: three Cards in a row (Import, Add one person, Planning numbers).

### 8.12 P&L `/pnl`
1. Title; month nav right.
2. Month card: 5-cell StatStrip (Sales, Cost, Ads, Fees, Profit after ads); the last cell's number uses
   `--grad-accent` text; notes as captions under the strip.
3. Products table full (unlinked SKUs section under it, inner box).
4. Costing 7 cols; Ads reports and Fees stacked in 5 cols.

### 8.13 Money `/money` (shelved)
Shared styles only. Do not rearrange anything.

### 8.14 Admin
- People: header with counts and + Add user; user cards 3 / 2 / 1 grid; the user form keeps its current place, as a Card.
- Settings: three Cards (General, Flipkart page, Money) in a 2-column grid, Money full width below; Save settings in
  a sticky bar at the bottom of the viewport (`--pop`, blur, top border).

### 8.15 Sign-in and change password
Centred Card 400 px wide on the page background; above it the lane mark (three small lanes) and "VR Prime Ops"
(Unbounded 20 px) with "Tasks, problems and stock" caption; fields; full-width primary button. No logic changes.

## 9. Accessibility and performance

- Text contrast at least 4.5:1 for body and 3:1 for large text, measured against the darkest and lightest place the
  text can sit. If a token pair fails, raise the text colour toward `--ink`; do not change backgrounds. Record each
  such change in the report.
- Touch targets at least 40 × 40 px. Visible focus on every control.
- `backdrop-filter` only on: cards (≥700 px), rail, top bar, bottom bar, popovers and sheets. Never on table rows,
  chips, buttons or inputs.
- Status is never colour alone: every tone has its Chip text or label.

## 10. What must not change

Information, numbers, links, role visibility, filters, sort orders, `?tab=` addresses, form fields and what every
button does. Nothing in `supabase/`, `src/server/`, API routes, `src/proxy.ts`, auth logic, or the calculations in
`src/lib`. No new dependencies.

## 11. When this document does not cover something

1. Use the component in section 4 or 5 that is closest in purpose, with its values unchanged.
2. Use the layout rule in section 3; place the block full width in the page's existing order.
3. Never invent a new colour, size, font, animation or pattern, and never keep an old one because it "looked fine".
4. Write each such case as one line in `docs/ui-overhaul/glass-gaps.md` (what, where, which rule you applied).
