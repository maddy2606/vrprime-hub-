# Graphite: gaps

Each line: what, where, which rule (spec section 14) was applied.

- Flow map state "N late · how late": the lane data carries no lateness duration, so the state reads "N late" only. `src/components/signal/lanes.tsx`. Rule 14.3 (never invent a figure).
- Team day-by-day grid sticky first column used the deleted `--surface-solid`; now `--surface` (the Card background it sits on). `src/components/team/board.tsx`. Rule 14.1.
- Expenses page decorative radial glow removed with the other radial gradients. `src/components/expenses/expenses-board.tsx`. Section 1, rule 14.1.
- Settings sticky save bar lost its `backdrop-blur` (no blur anywhere); background stays `--pop`. `src/components/admin/settings-form.tsx`. Section 1.
