# Graphite: gaps

Each line: what, where, which rule (spec section 14) was applied.

- Flow map state "N late · how late": the lane data carries no lateness duration, so the state reads "N late" only. `src/components/signal/lanes.tsx`. Rule 14.3 (never invent a figure).
- Team day-by-day grid sticky first column used the deleted `--surface-solid`; now `--surface` (the Card background it sits on). `src/components/team/board.tsx`. Rule 14.1.
- Expenses page decorative radial glow removed with the other radial gradients. `src/components/expenses/expenses-board.tsx`. Section 1, rule 14.1.
- Settings sticky save bar lost its `backdrop-blur` (no blur anywhere); background stays `--pop`. `src/components/admin/settings-form.tsx`. Section 1.
- Rail Sync status card "amber when it failed": the shell only knows the last finished order read (the data the top bar showed), not a failed one, so amber means no read yet or over 3 hours old. `src/components/shell/command-bar.tsx`. Rule 14.3.
- Top bar 700–1099 px: section 8 gives no tablet layout for the date and time and the name and role beside the avatar; both show from 1100 px, the avatar alone below. `src/components/shell/command-bar.tsx`. Rules 14.1 and 3 (layout by width band).
- Top bar date and time format: the existing `formatDate` · `formatDateTime` pair the deck header used ("15 Nov · 11:52 pm"). `src/components/shell/command-bar.tsx`. Rule 14.1.
- Geist Mono weight: section 2 loads Geist Mono at 400 and 500, but some IDs sit in 600 text (item row titles, card titles); mono text is capped at 500 so the browser never fakes a bold. `src/app/globals.css`. Rule 14.3.
- Command Centre header: section 9.1 drops the "Operations · date · time" label (the date and time are in the top bar from 1100 px); on phones and tablets the page no longer shows the time. `src/components/deck/sections.tsx`. Literal reading of 9.1 and section 8.
- Command Centre: the reassurance line from the glass headline stays as a caption under the subtitle (inventory item kept). `src/components/deck/sections.tsx`. Rule 14.1 (caption).
- To dispatch today KPI: 9.1 makes the capacity sentence the context line; the capacity bar the glass hero card drew is not repeated (9.1 does not list it, unlike 9.2's share bar and gauge). `src/components/deck/sections.tsx`. Literal reading.
- Queue item rows with two actions (Raise ticket, + Restock): item rows allow one 40 px button, but every existing button must stay (section 13), so both show as 40 px secondary buttons. The kind tag (Late, Risk…) leads the detail line so status is never colour alone. `src/components/deck/queue.tsx`. Rule 14.1.
- Queue icon badges by kind: late clock red, overfill box red, risk clock amber, dry warning amber, ticket green, work board violet (section 4 table and colour meaning; work has no row in the table, so the board icon from the rail in violet). `src/components/deck/queue.tsx`. Rule 14.1.
- Work and tickets card keeps the glass "first 6, Show N more" (9.1 gives "first 4, View all" only for Orders and stock). `src/components/deck/sections.tsx`. Glass layout kept.
- Orders pulse 3-cell row and Stock health rows: each row keeps its line under the Label (numbers in it must not disappear); cell numbers use the Stock health number style (Plus Jakarta Sans 18 px 700). `src/components/deck/sections.tsx`. Rule 14.1.
- Forecast, top movers is now 7 columns, so its rows run in one column (the two-column split was for the full-width glass card). `src/components/deck/sections.tsx`. Rule 14.1.
- Dashboard Needs a look item rows: notification kinds have no row in the section 4 icon table; warning triangle for bad and warn kinds, bell otherwise, tint from the kind's tone; the kind label is the status pill. `src/components/dashboard/board.tsx`. Rule 14.1.
- Dashboard KPI "To dispatch today": the late Chip beside the label leaves the label truncated at 1440 when the sparkline is also shown (KPI card layout as section 4). `src/components/dashboard/board.tsx`. Rule 14.1.
- Figures in Geist Mono (glass rule) moved to Inter tabular across all pages; Geist Mono kept only for SKUs, order, ticket, listing and campaign IDs and VR-N numbers. Email and password fields lose mono (not in the section 2 list). The shelved Money and Expenses pages keep theirs (glass 8.13: shared styles only). Section 2.
