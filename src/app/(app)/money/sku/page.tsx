import type { Metadata } from "next";
import Link from "next/link";
import { BackIcon } from "@/components/icons";
import { buttonClass, Card, Chip, EmptyState, PageTitle } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/format";
import { rupees } from "@/lib/money/profit";
import { loadSkuLines, requireOwnerPage } from "@/server/money-data";

export const metadata: Metadata = { title: "Money: SKU" };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 50;
const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

const money = (v: number): string => `${v < 0 ? "-" : ""}₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Every settlement line behind one SKU for the period: the order, each fee, the taxes and the payout. */
export default async function MoneySkuPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db } = await requireOwnerPage();
  const sp = await searchParams;
  const sku = one(sp.sku);
  const from = one(sp.from);
  const to = one(sp.to);
  const page = Math.max(1, Math.floor(Number(one(sp.page))) || 1);
  if (!sku || !DAY.test(from) || !DAY.test(to)) {
    return (
      <EmptyState
        title="Choose a SKU on the Profit tab"
        body="Open a SKU from its row there."
        action={
          <Link prefetch={false} href="/money" className={buttonClass("primary")}>
            Back to Money
          </Link>
        }
      />
    );
  }
  const { total, rows } = await loadSkuLines(db, sku, from, to, PAGE, (page - 1) * PAGE);
  const q = (p: number) => `/money/sku?sku=${encodeURIComponent(sku)}&from=${from}&to=${to}&page=${p}`;

  return (
    <>
      <div className="mb-3">
        <Link prefetch={false} href={`/money?from=${from}&to=${to}`} className={buttonClass("ghost", "-ml-3 px-3")}>
          <BackIcon className="h-5 w-5" /> Profit
        </Link>
      </div>
      <PageTitle title={sku} sub={`${formatNumber(total)} settlement lines, paid ${formatDate(from)} to ${formatDate(to)}`} />
      {rows.length ? (
        <>
          <ul className="flex flex-col gap-2">
            {rows.map((r) => {
              const fees = r.commission + r.fixed_fee + r.collection_fee + r.shipping_fee + r.reverse_shipping_fee + r.other_fees;
              const returned = r.refund < 0;
              const parts: [string, number][] = [
                ["commission", r.commission],
                ["fixed", r.fixed_fee],
                ["collection", r.collection_fee],
                ["shipping", r.shipping_fee],
                ["reverse shipping", r.reverse_shipping_fee],
                ["other", r.other_fees],
                ["GST on fees", r.gst_on_fees],
                ["TCS", r.tcs],
                ["TDS", r.tds],
              ];
              return (
                <li key={r.order_item_id + r.payment_date + r.net}>
                  <Card className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-all font-mono text-xs font-bold">{r.order_id ?? r.order_item_id}</span>
                      {returned ? <Chip tone="bad">{r.return_type ?? "Returned"}</Chip> : null}
                      <span className="ml-auto text-xs text-muted">paid {formatDate(r.payment_date)}</span>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                      <dt className="text-muted">Qty</dt>
                      <dd className="text-right tabular-nums sm:text-left">{r.qty ?? "-"}</dd>
                      <dt className="text-muted">Sale</dt>
                      <dd className="text-right tabular-nums sm:text-left">{money(r.sale_amount)}</dd>
                      <dt className="text-muted">Refund</dt>
                      <dd className="text-right tabular-nums sm:text-left">{money(r.refund)}</dd>
                      <dt className="text-muted">Fees</dt>
                      <dd className="text-right tabular-nums sm:text-left">{money(fees)}</dd>
                    </dl>
                    <p className="mt-1 text-xs text-muted tabular-nums">
                      {parts
                        .filter(([, v]) => v !== 0)
                        .map(([k, v]) => `${k} ${money(v)}`)
                        .join(" · ") || "no fees on this line"}
                    </p>
                    <p className="mt-1 text-sm font-bold tabular-nums">
                      Payout {money(r.net)} <span className="font-normal text-muted">+ tax credits {money(r.itc)}</span>
                      {r.unit_cost !== null ? (
                        <span className="font-normal text-muted"> · unit cost {rupees(r.unit_cost)}</span>
                      ) : (
                        <span className="font-normal text-warn"> · cost missing</span>
                      )}
                    </p>
                  </Card>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex items-center justify-between gap-3">
            {page > 1 ? (
              <Link prefetch={false} href={q(page - 1)} className={buttonClass("secondary")}>
                Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-xs text-muted">
              Page {page} of {Math.max(1, Math.ceil(total / PAGE))}
            </span>
            {page * PAGE < total ? (
              <Link prefetch={false} href={q(page + 1)} className={buttonClass("secondary")}>
                Older
              </Link>
            ) : (
              <span />
            )}
          </div>
        </>
      ) : (
        <EmptyState title="No lines" body="Nothing was paid for this SKU in this period." />
      )}
    </>
  );
}
