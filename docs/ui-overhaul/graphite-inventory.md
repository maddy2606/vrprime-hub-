# UI overhaul: inventory of what every page shows today

Branch `ui/overhaul`, base `main` at 144ad5f (2026-11-15). Every number, table, chart, filter and action on
each page and tab, as the code renders it on that date. Each line gets a mark at the end:
`kept` (same page, same meaning), `moved → where`, or `merged → into what`. Nothing may be dropped.

Legend for roles: (O) owner only, (OA) owner and admin, (all) everyone. Role rules are not changed by the
overhaul; they are listed so the checklist can be read per role.

## Shell (every page)

- [ ] Side rail (561px and up): logo "VR", Command Deck, Dashboard (O), Work board, Tickets, Flipkart, Forecast, Ads tracker (OA), Review tracker (OA), Team (OA), P&L (O), People (O), Settings (O); tooltips on hover; active marker. — kept, regrouped Operate / Marketplace / Admin, labels shown
- [x] Bottom bar (560px and under): Deck, Flipkart, Forecast, Team (OA) + More sheet with the rest. — moved → bar is now Deck, Work, Tickets, Flipkart + More; Forecast and Team are under More
- [x] Top bar: logo (phone), search button / search box "Search SKUs, orders, tickets" (Ctrl K), sync status "Synced 42s ago · scope" with green/amber dot, Sync now button (OA), + Post, bell with unread count and pulse ring, account avatar. — kept
- [ ] Account menu: name, role · email, Theme Light/Dark/Auto, Money link (O, when on), Notifications, Change password, Sign out. — kept
- [ ] Command palette (Ctrl K): pages, SKUs, orders, tickets, posts; keyboard hints. — kept
- [ ] Alerts panel (opens itself on new alerts, and from the bell): title, "N things need your attention", grouped alert cards with Open and Mark read, "+N earlier alerts like this", Other updates list (6, "+N more"), footer All notifications + Mark all read, All clear state. — kept
- [ ] Push prompt "Get alerts on this phone?" on every page (hidden 7 days after Not now): Turn on notifications, Not now, iPhone Home Screen note. — moved → one-line bar on the Command Deck only; the full card stays on Notifications
- [ ] Toasts (ok and bad). — kept
- [ ] Loading skeletons (app, Flipkart, Money). — kept
- [ ] Error and not-found pages. — kept

## Command Deck `/` (all; capacity bar OA)

- [ ] Notes line (data not ready yet). — kept
- [ ] Today · to dispatch: big due count, "N late" chip (link to order list), "orders still to go out today across N warehouses", capacity bar "X% of what the team packs in a day · N a day · N people" (OA), Yesterday / 7-day avg / Busiest with up-down chips. — kept, now the hero of the page with the warehouse lanes
- [x] Orders a day: last 14 days trend chart with 7-day average line, peak label, latest day marked, "N yesterday". — kept
- [x] Hero headline: "Operations · date · time", headline sentence with tone (bad/warn/ok), reassurance line, buttons Open priority queue, Jump to Flipkart. — merged → page headline sentence at the top (numbers coloured inline); buttons kept
- [x] Pulses: three tiles (label, count, sub line, sparkline), each a link. — kept as a hairline stat strip
- [x] Priority queue: "N to do" / All clear chip, ranked rows with kind tag (Late, Overfill, Dry, Risk, Ticket, Work), title, detail, action buttons; Show N more. — kept
- [x] Warehouses: per warehouse health gauge %, name with colour dot, chip (N late / Due soon / On time), "Next dispatch …" or "No orders waiting", active count, "active · N out". — merged → the warehouse lanes (gauge, chip, next dispatch, active and out all in the lane row)
- [x] Stock by warehouse: total units, share bar per warehouse with legend (units · %), Empty (0 units) vs Low paired bars per warehouse. — kept
- [x] Active orders by stage: total active, stacked bars per warehouse To Accept / To Pack / To Dispatch with legend. — merged → the warehouse lanes (same three stages per warehouse, same totals)
- [x] Dispatch, last 7 days: area chart of units dispatched per day, total units, average a day. — kept
- [x] Stock health KPI tiles: Units in stock (+ change since last reading, sparkline), Low stock, Out of stock, Open tickets, Weight alerts; each a link. — kept as a stat strip with sparklines
- [x] Forecast, top movers: rank, SKU, title, 30-day forecast, a day rate, share bar, days-left chip; Full forecast link. — kept

## Dashboard `/dashboard` (O)

- [x] Greeting "Good morning, Name", month chip "Nov 2026 · to 15 Nov". — kept
- [x] Profit after ads tile: ₹ count-up, margin % chip, previous month margin, "On pace for ₹X this month". — kept
- [x] Revenue (seller price) tile: ₹, units sold, previous month, cost/ads/fees/profit share bar. — kept
- [x] Ads incl. 18% GST tile: ₹, gauge of ads share of revenue, previous month share. — kept
- [x] To dispatch today tile: count, N late / None late chip, 7-day avg, 14-day sparkline. — kept
- [x] Orders a day panel (trend chart with avg), link to Orders. — kept
- [x] Where the money went: ring (product cost, ads, Flipkart fees, profit) with centre margin and legend list with ₹ and %. — kept
- [x] Four pulse KPI tiles from the deck. — kept as stat strip
- [x] Month by month: grouped bars (revenue, profit after ads, ads) for last 4 months, profit label under each, legend; each month links to P&L. — kept
- [ ] Products by profit: top 6 and worst 3 with bars and ₹ net. — kept
- [x] Orders waiting, by warehouse: stacked stage bars per warehouse with total and legend. — kept (uses the lanes component)
- [ ] Needs a look: unread alerts with kind chip, title, time ago; All clear state. — kept

## Flipkart `/flipkart` (tabs regrouped; same `?tab=` addresses)

- [x] Page title "Flipkart" + per-tab subtitle ("…, at your warehouses" for warehouse role). — kept
- [ ] Tab row: Needs action, Orders, Stock, Stock-outs, Returns, Prices (OA), Listing health (OA, behind flag), Forecasting, Overfill Orders, Master SKUs (OA). — moved → grouped tabs: Today (Needs action, Orders, Overfill Orders) · Stock (Stock, Stock-outs, Forecasting) · Listings (Prices, Listing health, Master SKUs) · Returns
- [ ] Per-tab skeleton while loading. — kept

### Needs action
- [x] Caption "From stock as of date. Red first." + info tip listing things not ready. — kept
- [ ] Sections, most urgent first, each with count and Show N more: Orders about to miss dispatch, Price errors, New inactive listings, New listings not found on Flipkart, Money (O, when on), High return rate, Running out soon. Rows: tone bar, title, detail, action buttons (internal links and Seller Hub ↗). — kept
- [ ] Empty state "Nothing needs action". — kept

### Orders
- [ ] Orders sync bar: "Orders read <time>" + how-often info, progress bar while syncing, Sync now (OA), failure line, 30-day backfill note. — kept
- [x] Warehouse cards (tap to filter): name, next-due / N late chip, To Accept / To Pack / To Dispatch counts, "Upcoming N · Processing N · In transit N · N on hold". — kept, drawn as lanes (same numbers)
- [x] Views: By SKU, Order list, Cancelled (with count). — kept
- [x] Show filter: All active, To Accept, To Pack, To Dispatch, Upcoming, Under Processing with counts. — kept
- [x] Cancelled: By filter All / Seller / Buyer with counts; Cancellations per day table (Day, Seller, Buyer). — kept
- [x] Warehouse dropdown, Sort (Most orders, Most units, Earliest dispatch-by, SKU A to Z), search, CSV, info tip (In transit count, explanations). — kept
- [ ] By SKU groups: caption "N SKUs · N orders · N units", row per SKU in one ledger card (SKU, title, due, orders · units, Short of stock, per-warehouse chips, bucket chips); opened: Stock vs units ordered table (Warehouse, Ordered, Stock, short by), Orders table (Order ID, Qty, Warehouse, Status, Dispatch by), "first N of M" note; Show more. — kept
- [x] Order list table: Dispatch by (Late/Today/On hold chips), Order ID, SKU, Qty, Warehouse, Status, Active from; Show more. — kept
- [x] Cancelled table: Cancelled, By, SKU, Order ID, Qty, Warehouse, Reason. — kept
- [ ] Empty states and "Could not load" alert. — kept

### Stock
- [ ] Stock sync bar: "Synced <time>", listings · FBF skipped · without details · change since; progress; Sync now (OA); failure line. — kept
- [x] Warehouse cards (tap to filter): name, share %, units, N out, N low. — kept (lanes-style stat row)
- [ ] Lists: Low stock, By location, Out of stock, Weight alerts, New inactive, All inactive with counts; one warehouse picked: Out of stock at X / Low at X. — kept
- [x] Warehouse dropdown, search, Hide inactive, CSV, info tip (definitions, days-left rule). — kept
- [x] Caption "N SKUs · scope · N units in stock (change)". — kept
- [ ] Columns per list: SKU/title/Inactive; Empty at / Low at / In stock at chips; Total; Days left; Restock link; per-warehouse units; Change since; Status; Listed at; Units before; Ran out today; L×B×H; Weight (g); Total; Over by; Listing ID; Inactive since; Units. — kept
- [x] Show more, empty states, failure alert. — kept

### Stock-outs
- [x] Change filter All / Stocked out / Back in stock with counts, Location dropdown with counts, search, Hide inactive (on), CSV, info tip. — kept
- [ ] Caption "Changes between reads of A and B (covers N days) · N changes on inactive hidden". — kept
- [ ] Per-warehouse sections "N stocked out · N back in stock", table SKU (chip Stocked out/Back in stock, Inactive), Units on A, Units on B. — kept
- [ ] Empty states (needs two reads, nothing changed, only inactive, nothing matches). — kept

### Returns
- [x] Orders sync bar (daily kind). — kept
- [ ] "Only returns that changed…" warning until history is ready. — kept
- [x] Stat tiles: Returns 30 days (units, lines), Courier returns, Customer returns. — kept as stat strip
- [x] Views: All returns (count), Return rate by SKU (flagged count). — kept
- [x] Kind filter All / Courier / Customer with counts, Warehouse dropdown, search, CSV, info tip. — kept
- [ ] Returns table: Created, SKU, Type, Reason, Qty, Warehouse, Status, Order ID, Raise ticket. — kept
- [ ] Rates table: SKU, Return rate, Returned, Sold (30 days), Above N% chip, Raise ticket. — kept

### Prices (OA)
- [x] Filter: Any problem, At or above MRP, Big drop, Missing, All SKUs with counts; Hide inactive listings; search; CSV; note. — kept
- [ ] Table: SKU/title/Inactive, Selling price, MRP, Discount, Problem chips (Dropped N%), Last change (expandable history, +N earlier), Changes. — kept

### Listing health (OA, behind SHOW_LISTING_HEALTH)
- [ ] Filter: All problems + one per problem type with counts; Hide inactive listings; search; CSV; note "N of M listings have a problem", tax-unread note. — kept
- [ ] Table: SKU (quoted when the space is the problem, Inactive, VR-N post link), Problems chips, Dispatch SLA, HSN, Tax code. — kept

### Forecasting
- [ ] Status lines: live sync failed, no inventory report yet, N report products match no master SKU, history note. — kept
- [x] Top movers chips (30-day forecast). — kept
- [x] Show: By product (master) / All SKUs; Layout: Ranked / Table (remembered); Average over the last 7 / 14 / 30 days; Only: warehouse picker; search; CSV; Sync live stock (OA), Upload inventory report (OA); info tip. — kept
- [x] Caption: N products covering N SKUs · N unmapped · window dates · stock source. — kept
- [ ] Ranked list: rank, product (Kit badge), "N SKUs · N in stock", 30-day forecast with bar, a day, days-left chip; expand to SKUs (×units, forecast, a day); Unmapped section. Sort by picker + direction. — kept
- [ ] Table: Product / SKU, Stock now, Avg / day, Forecast 1d, 7d, 30d, Days of cover; expandable products, kit note (own + can be made, parts), Unmapped. Phone: cards with cover pill. — kept
- [ ] All SKUs list: Together / By warehouse, columns SKU, Avg / day, Forecast 1d/7d/30d; CSV adds Title, Product, Warehouse, Units dispatched. — kept

### Overfill Orders
- [x] Warehouse filter (segments ≤3, else dropdown) with counts; search; CSV; note. — kept
- [x] Caption "N SKUs with orders and no stock · N orders · N units waiting". — kept
- [x] Table: SKU/title, Warehouse, Orders waiting, Units waiting, + Restock, Raise ticket. — kept

### Master SKUs (OA; Upload CSV O)
- [x] Search, Import Master SKU Excel, Download CSV, Upload CSV (O, confirm), info tip; caption explaining units per order and kits. — kept
- [ ] Master SKUs and their Flipkart SKUs (count): new master form (code, name, Add master SKU); per product: code, name, linked SKU chips (×units, unlink ×), Add Flipkart SKU (sku, units, Add), kit editor (Kit chips, Part of…, Make it a kit / Edit kit, parts form Add part / Save kit / Not a kit / Cancel). — kept
- [x] Not linked yet (count): SKU, title, Sold (14 days), master picker with suggestion, units, Save, Remove. — kept
- [x] Removed (count) details: SKU chips with put-back ×. — kept

### Stock `/stock` redirect → `/flipkart?tab=stock`. — kept

## Work board `/work` (all) and All posts `/all`

- [x] My work / Everything switch. — kept
- [x] "Hi Name" + "N open · N overdue · N due today". — kept as headline sentence
- [x] Sections Overdue / Due today / Next with counts, post cards grid. — kept
- [ ] Post card: VR-N, type chip, High/Urgent chip, live chips (Live ✓ / Live, inactive / Over weight / Not found on Flipkart / Not checked yet), status chip, title, assignee, warehouse, SKU, due chip. — kept
- [x] Empty "You are all caught up" with + Post and See everything. — kept
- [ ] All posts: title "All posts" / "New listings", "N posts" or "first N of M"; Posts / New listings switch (OA) with Open requests / Done and live / Done, not found counts; Status, Type, Warehouse, Assignee (Anyone, Me, Nobody, people), Priority, Sort (Last update, Due date, Newest, Priority), search, Overdue only; Clear filters; empty states. — kept

## Post `/posts/[id]`, new `/posts/new`, edit `/posts/[id]/edit`

- [x] Back to All posts, Edit. — kept
- [x] Header card: VR-N, type, priority, status, due chips; title; details; facts Assigned to, Warehouse, Platform, SKU, Quantity needed, Due, Created by, Created. — kept
- [x] New listing: Request details (product name, target price, MRP, size, weight, reference link), Over the weight limit card, live/not-found card with Flipkart package warning. — kept
- [ ] Done card: Done by · when, Ticket ID, No ticket needed, FSN / listing ID, Quantity sent, Invoice / challan, Note. — kept
- [x] Tickets card: list (VR-T, status, follow-up chip, ticket id), Raise ticket (problem posts). — kept
- [ ] Actions: Mark done (per-type proof form: Ticket ID / No ticket needed + reason; SKU + FSN; Quantity sent + Invoice; Note), Start / In progress, Waiting, Cancel (confirm), Reopen. — kept
- [ ] Photos grid (open, remove), Add photos (6 per upload, progress). — kept
- [x] Comments (count), list, Add a comment, Post comment. — kept
- [x] History timeline (actor, sentence(s), time). — kept
- [ ] New post: type picker (Task, New listing (OA), Problem, Restock with hints), then form: Type (Change), Title, SKU, Warehouse, Platform (problem), Quantity needed (restock), Details / Note, Assign to, Due date, Priority segmented, New listing More details (product name, reference link, platform, target price, MRP, L B H kg with weight check, notes, photos), Create / Save changes, Cancel. — kept

## Tickets `/tickets`, `/tickets/new`, `/tickets/[id]`

- [x] Title "Tickets" + "N open · N waiting · N follow-up due", + Ticket. — kept as headline sentence
- [ ] Groups Open / Waiting / Follow-up due / Closed with counts; Platform and Issue dropdowns; search; Clear search and filters; "Showing first N of M". — kept
- [x] Ticket card: VR-T, status chip, ticket id, linked post (VR-N · title) or "Not linked to a post", platform, issue, warehouse chips, Raised date, Follow-up date (red when due). — kept
- [ ] Empty states per group. — kept
- [ ] Ticket page: back, header (VR-T, platform, issue, status, follow-up chips, ticket id, Saved time, Linked post), form. — kept
- [x] Form: Marketplace ticket ID, Platform, Issue type, SKU, Raised on, Next follow-up (+ Tomorrow / 3 days / 1 week / No follow-up), Status, Notes, Save ticket, Cancel; linked post card. — kept

## Notifications `/notifications` (all)

- [x] Title, "N unread" / "You are all caught up", Mark all read. — kept
- [ ] Alerts on this phone card: status chip (On / Off / Blocked / Add to Home Screen / Not set up / Not available), help text, Turn on, Send me a test, Turn off. — kept
- [x] Filter pills All / Alerts / Updates with counts. — kept
- [x] Notification cards (tone bar, kind icon, kind chip, unread dot, time, title, body lines with badges). — kept
- [ ] Empty states. — kept

## Ads tracker `/ads` (OA)

- [x] Title, scan picker ("Choose a scan"), Sync (upload PLA Consolidated FSN Report CSV), How Sync works details. — kept
- [ ] Notes (no daily report, spend stale). — kept
- [x] Needs a look: campaigns with spend and no sales, or ROI under 3.5 (copy campaign ID). — kept
- [x] Every tracked SKU: Platform switch, search, table with per-SKU rows and expandable campaign rows. — kept
- [x] Average daily spend, week by week / scan by scan bar chart. — kept
- [ ] Campaign form (name, campaign ID, SKUs, budget, notes; Add / Save campaign), Campaign log table with actions. — kept
- [x] Tracked SKUs: list with Stop tracking ×, add SKU input. — kept
- [ ] Not-set-up empty state. — kept

## Ads Desk `/ads/desk` (OA)

- [ ] Title, Dates preset picker, Sync reports (four Seller Hub CSVs at once), "Start by syncing" panel. — kept
- [x] Section nav (Overview, Campaigns, Products, Search terms, Keywords, Negatives, Day of week). — kept
- [x] Where every rupee went: Split by control, share bars; By placement bar. — kept
- [x] Losing money, Changed for the worse, Bids to cut (overspend), Winners with room, Leaks (Zero-sale search terms, Product pages under break-even, Negative keywords to add), Spend spikes. — kept
- [ ] Every campaign table (Campaign, Before, Result, Spend, Revenue, ROI, Units, Clicks, CPC, CVR), tap for sheet: Day by day bars, Placements, Products, Keywords, Search terms. — kept
- [ ] Products, Search terms, Keywords (Bid guide) tables with search; Day of week table. — kept
- [ ] Negative keywords: Campaign picker, Status switch, table. — kept

## Review tracker `/reviews` (OA)

- [x] Title, check picker, Sync now, note about the 5-day read. — kept
- [x] Tiles: Written reviews (sparkline), Towards targets, Flipkart vs Shopsy (platform filter), At target (gauge). — kept
- [x] Progress by priority bars; Nearly there / Furthest away list; Reviews removed; per-priority link groups with target bars; Every link table (View, Platform, Priority, Sort, search). — kept
- [x] Check by check trend chart. — kept
- [ ] Not-set-up and no-check empty states. — kept

## Team `/team` (OA; salaries O)

- [x] Headline sentence, Suggestions. — kept
- [ ] Attendance: day nav (previous / next), per warehouse people with Present / Half day / Absent / Leave, Mark the rest present. — kept
- [x] Per-warehouse 7-day cards (average orders against comfortable and most). — kept
- [x] Day by day, per warehouse grid (orders per day with status colour, today so far, late). — kept
- [ ] Orders against what the team can pack: capacity chart (past, expected, comfortable, most) with legend. — kept
- [ ] The team, month: table Person, Present, Half, Absent, Leave, Salary (O), actions; staff money sheet (advances / expenses / recovered, Save, History, Delete). — kept
- [ ] Owner tools: Import the staff sheet (preview, Save N people), Add one person, Planning numbers (Save). — kept
- [ ] "Start by adding your team" empty state. — kept

## P&L `/pnl` (O)

- [x] Title, month nav. — kept
- [ ] Month card: Sales, Cost, Ads (incl. 18% GST) or "not added", Fees, Profit after ads; notes about missing ads report / P&L report. — kept
- [x] Products table: Product, Units, Sales, Cost, Ads, Profit after ads; unlinked SKUs section with units-per-order inputs. — kept
- [ ] Costing: search, Show switch, per-product cost inputs (from parts placeholder), Save costs. — kept
- [x] Ads reports: Upload ads report, list of uploads. — kept
- [x] Fees: Upload report (P&L / settlement) and explanation. — kept

## Money `/money` (O, only when switched on; shelved)

- [ ] Tabs Profit, Costs, Weight, Settlement, Uploads with subtitles; period picker. — kept, untouched beyond shared styles
- [ ] Profit tiles and tables, Costs table, Weight table, Unpaid orders and Wrong fees tables (Raise ticket), Uploads (database size, Upload report, Uploaded reports), Orders not settled yet, Cross-check with P&L. — kept
- [ ] SKU page `/money/sku`. — kept

## Admin

- [ ] People `/admin/users` (O): title "N active · N total", + Add user, user cards (name, You, Deactivated / Temp password, role, email, warehouses), user form (Name, Phone, Email, Role with hint, Warehouses toggles, Temporary password + Generate, Active). — kept
- [ ] Settings `/admin/settings` (O): Money switch, master SKU note, form: Low stock level, Weight alert limit, New inactive days; Flipkart page: Price drop %, Slow dispatch days, Running out days, High return rate %; Money: Low margin %, Default fee %, Unpaid after days, Fee deviation points, Upload reminder days, Months to keep; Save settings. — kept
- [ ] Owner-only notice for non-owners. — kept

## Sign-in

- [ ] Login: logo + "VR Prime Ops · Tasks, problems and stock", Sign in, Email, Password, inactive-account notice, "Ask the owner" line. — kept
- [ ] Change password: heading (first sign-in variant), New password, Type it again, Show password, Save password. — kept
