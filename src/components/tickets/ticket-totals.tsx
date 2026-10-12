import Link from "next/link";
import { formatINR, formatNumber } from "@/lib/format";

type Totals = { open_count: number; open_amount: number; recovered_amount: number; follow_up_due: number };

function Tile({ label, value, tone = "text-ink" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface p-3">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className={`mt-1 truncate text-lg font-extrabold tracking-tight ${tone}`}>{value}</p>
    </div>
  );
}

export function TicketTotals({ totals }: { totals: Totals }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Tile label="Open tickets" value={formatNumber(totals.open_count)} />
      <Tile label="Amount involved (open)" value={formatINR(totals.open_amount)} />
      <Tile label="Total recovered" value={formatINR(totals.recovered_amount)} tone="text-ok" />
      <Link
        prefetch={false}
        href="/tickets?due=1"
        className={`focus-ring min-w-0 rounded-xl border bg-surface p-3 ${
          totals.follow_up_due ? "border-warn/60" : "border-line"
        }`}
      >
        <p className="text-xs font-semibold text-muted">Follow-up due</p>
        <p className={`mt-1 text-lg font-extrabold tracking-tight ${totals.follow_up_due ? "text-warn" : "text-ink"}`}>
          {formatNumber(totals.follow_up_due)}
        </p>
      </Link>
    </div>
  );
}
