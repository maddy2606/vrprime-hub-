# Graphite: gaps

Each line: what, where, which rule (spec section 14) was applied.

- Flow map state "N late · how late": the lane data carries no lateness duration, so the state reads "N late" only. `src/components/signal/lanes.tsx`. Rule 14.3 (never invent a figure).
- Team day-by-day grid sticky first column used the deleted `--surface-solid`; now `--surface` (the Card background it sits on). `src/components/team/board.tsx`. Rule 14.1.
- Expenses page decorative radial glow removed with the other radial gradients. `src/components/expenses/expenses-board.tsx`. Section 1, rule 14.1.
- Settings sticky save bar lost its `backdrop-blur` (no blur anywhere); background stays `--pop`. `src/components/admin/settings-form.tsx`. Section 1.
- Rail Sync status card "amber when it failed": the shell only knows the last finished order read (the data the top bar showed), not a failed one, so amber means no read yet or over 3 hours old. `src/components/shell/command-bar.tsx`. Rule 14.3.
- Top bar 700–1099 px: section 8 gives no tablet layout for the date and time and the name and role beside the avatar; both show from 1100 px, the avatar alone below. `src/components/shell/command-bar.tsx`. Rules 14.1 and 3 (layout by width band).
- Top bar date and time format: the existing `formatDate` · `formatDateTime` pair the deck header used ("15 Nov · 11:52 pm"). `src/components/shell/command-bar.tsx`. Rule 14.1.
