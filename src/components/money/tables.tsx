"use client";

import Link from "next/link";
import { ListView } from "@/components/flipkart/list-view";
import type { Column } from "@/components/stock/data-table";
import { Chip } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/format";
import { percent, type ProfitRow } from "@/lib/money/profit";
import { feeTicketNotes, newTicketHref, unpaidTicketNotes, weightTicketNotes } from "@/lib/money/tickets";
import { SELLER_HUB } from "@/lib/seller-hub";
import type { UnpaidRow, WeightRow, WrongFeeRow } from "@/server/money-data";

const money = (v: number | null, digits = 0): string =>
  v === null ? "-" : `${v < 0 ? "-" : ""}₹${Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

function Amount({ v, digits = 0, good }: { v: number | null; digits?: number; good?: boolean }) {
  if (v === null) return <span className="text-muted">-</span>;
  return <span className={v < 0 && good ? "font-semibold text-bad" : ""}>{money(v, digits)}</span>;
}

function Buttons({ ticket, hub = SELLER_HUB.payments }: { ticket: string; hub?: string }) {
  return (
    <div className="flex min-w-44 flex-wrap gap-1.5">
      <Link prefetch={false} href={ticket} className="focus-ring inline-flex min-h-9 items-center rounded-lg border border-line bg-surface px-2.5 text-xs font-bold hover:bg-surface2">
        Raise ticket
      </Link>
      <a href={hub} target="_blank" rel="noreferrer noopener" className="focus-ring inline-flex min-h-9 items-center rounded-lg border border-line bg-surface px-2.5 text-xs font-bold hover:bg-surface2">
        Open in Seller Hub
      </a>
    </div>
  );
}

// --- Profit per SKU -------------------------------------------------------------------------------------------

export function ProfitTable({ rows, from, to, lowMargin }: { rows: ProfitRow[]; from: string; to: string; lowMargin: number }) {
  const col = (key: string, label: string, value: (r: ProfitRow) => number, digits = 0, good = true): Column<ProfitRow> => ({
    key,
    label,
    align: "right",
    sort: (r) => value(r),
    cell: (r) => <Amount v={value(r)} digits={digits} good={good} />,
    csv: (r) => Math.round(value(r) * 100) / 100,
  });
  const columns: Column<ProfitRow>[] = [
    {
      key: "sku",
      label: "SKU",
      sort: (r) => r.sku,
      cell: (r) => (
        <Link
          prefetch={false}
          href={`/money/sku?sku=${encodeURIComponent(r.sku)}&from=${from}&to=${to}`}
          className="focus-ring break-all rounded font-mono text-[13px] font-bold leading-tight text-accent-text underline"
        >
          {r.sku}
        </Link>
      ),
      csv: (r) => r.sku,
    },
    { key: "units", label: "Units sold", align: "right", sort: (r) => r.units_sold, cell: (r) => formatNumber(r.units_sold), csv: (r) => r.units_sold },
    { key: "ret", label: "Returned", align: "right", sort: (r) => r.units_returned, cell: (r) => formatNumber(r.units_returned), csv: (r) => r.units_returned },
    col("sales", "Gross sales", (r) => r.gross_sales),
    col("refunds", "Refunds", (r) => r.refunds),
    col("commission", "Commission", (r) => r.commission),
    col("fixed", "Fixed fee", (r) => r.fixed_fee),
    col("collection", "Collection", (r) => r.collection_fee),
    col("ship", "Shipping", (r) => r.shipping_fee),
    col("rev", "Reverse shipping", (r) => r.reverse_shipping_fee),
    col("other", "Other fees", (r) => r.other_fees),
    col("taxes", "GST, TCS, TDS", (r) => r.gst_on_fees + r.tcs + r.tds),
    col("net", "Net payout", (r) => r.net_payout),
    col("itc", "Tax credits", (r) => r.itc, 0, false),
    {
      key: "cost",
      label: "Cost",
      align: "right",
      sort: (r) => (r.cost_missing ? null : r.cost),
      cell: (r) => (r.cost_missing ? <Chip tone="warn">Cost missing</Chip> : <Amount v={r.cost} />),
      csv: (r) => (r.cost_missing ? "cost missing" : Math.round(r.cost * 100) / 100),
    },
    {
      key: "profit",
      label: "Profit",
      align: "right",
      sort: (r) => (r.cost_missing ? null : r.profit),
      cell: (r) => (r.cost_missing ? <span className="text-muted">-</span> : <Amount v={r.profit} good />),
      csv: (r) => (r.cost_missing ? null : Math.round(r.profit * 100) / 100),
    },
    {
      key: "ppu",
      label: "Profit per unit",
      align: "right",
      sort: (r) => (r.cost_missing ? null : r.profitPerUnit),
      cell: (r) => (r.cost_missing ? <span className="text-muted">-</span> : <Amount v={r.profitPerUnit} digits={1} good />),
      csv: (r) => (r.cost_missing || r.profitPerUnit === null ? null : Math.round(r.profitPerUnit * 100) / 100),
    },
    {
      key: "margin",
      label: "Margin",
      align: "right",
      sort: (r) => r.margin,
      cell: (r) =>
        r.margin === null ? (
          <span className="text-muted">-</span>
        ) : (
          <span className={r.margin < 0 ? "font-bold text-bad" : r.margin < lowMargin ? "font-bold text-warn" : ""}>{percent(r.margin)}</span>
        ),
      csv: (r) => (r.margin === null ? null : Math.round(r.margin * 10) / 10),
    },
    {
      key: "before",
      label: "Margin before cost",
      align: "right",
      csvOnly: true,
      cell: () => null,
      csv: (r) => (r.revenue > 0 ? Math.round(((r.net_payout + r.itc) / r.revenue) * 1000) / 10 : null),
    },
  ];
  return (
    <ListView
      rows={rows}
      columns={columns}
      rowKey={(r) => r.sku}
      defaultSort={{ key: "net", dir: "desc" }}
      textKeys={["sku"]}
      searchText={(r) => r.sku}
      searchLabel="Search SKU"
      csvName={`vrprime-profit-${from}-to-${to}.csv`}
      noun={["SKU", "SKUs"]}
      scope="settled money, by the day it was paid"
      emptyTitle="No settled money in this period"
      emptyBody="Upload a Settled Transactions report on the Uploads tab, or pick a period that it covers."
    />
  );
}

// --- Weight overcharge ----------------------------------------------------------------------------------------

export function WeightTable({ rows }: { rows: WeightRow[] }) {
  const columns: Column<WeightRow>[] = [
    { key: "sku", label: "SKU", sort: (r) => r.sku, cell: (r) => <span className="break-all font-mono text-[13px] font-bold">{r.sku}</span>, csv: (r) => r.sku },
    { key: "order", label: "Order ID", sort: (r) => r.order_id, cell: (r) => <span className="break-all font-mono text-xs">{r.order_id}</span>, csv: (r) => r.order_id },
    { key: "item", label: "Order item ID", csvOnly: true, cell: () => null, csv: (r) => r.order_item_id },
    { key: "date", label: "Paid on", sort: (r) => r.payment_date, cell: (r) => formatDate(r.payment_date), csv: (r) => r.payment_date },
    { key: "charged", label: "Charged slab (kg)", sort: (r) => r.charged_kg, cell: (r) => r.charged_slab, csv: (r) => r.charged_slab },
    { key: "ours", label: "Our package (kg)", align: "right", sort: (r) => r.our_kg, cell: (r) => `${r.our_kg} (slab ${r.our_slab_kg})`, csv: (r) => r.our_kg },
    { key: "type", label: "Weight type", sort: (r) => r.weight_type, cell: (r) => r.weight_type ?? "-", csv: (r) => r.weight_type },
    { key: "zone", label: "Zone", sort: (r) => r.zone, cell: (r) => r.zone ?? "-", csv: (r) => r.zone },
    { key: "paid", label: "Shipping fee paid", align: "right", sort: (r) => r.fee_paid, cell: (r) => money(r.fee_paid, 2), csv: (r) => r.fee_paid },
    { key: "extra", label: "Extra paid", align: "right", sort: (r) => r.extra_fee, cell: (r) => (r.extra_fee === null ? <span className="text-muted" title="No other charge for the right slab to compare with">unknown</span> : <span className="font-bold text-bad">{money(r.extra_fee, 2)}</span>), csv: (r) => r.extra_fee },
    {
      key: "act",
      label: "",
      screenOnly: true,
      cell: (r) => <Buttons ticket={newTicketHref({ issue: "weight_overcharge", sku: r.sku, notes: weightTicketNotes(r) })} />,
      csv: () => null,
    },
  ];
  return (
    <ListView
      rows={rows}
      columns={columns}
      rowKey={(r) => r.order_item_id + r.payment_date}
      defaultSort={{ key: "extra", dir: "desc" }}
      textKeys={["sku", "order", "type", "zone"]}
      searchText={(r) => `${r.sku ?? ""} ${r.order_id ?? ""} ${r.order_item_id}`}
      searchLabel="Search SKU or order ID"
      csvName="vrprime-weight-overcharges.csv"
      noun={["order charged too much weight", "orders charged too much weight"]}
      emptyTitle="No weight overcharges found"
      emptyBody="No order in this period was charged a bigger weight slab than the package on your listing."
    />
  );
}

// --- Settlement checker ---------------------------------------------------------------------------------------

export function UnpaidTable({ rows }: { rows: UnpaidRow[] }) {
  const columns: Column<UnpaidRow>[] = [
    { key: "sku", label: "SKU", sort: (r) => r.sku, cell: (r) => <span className="break-all font-mono text-[13px] font-bold">{r.sku ?? "-"}</span>, csv: (r) => r.sku },
    { key: "order", label: "Order ID", sort: (r) => r.order_id, cell: (r) => <span className="break-all font-mono text-xs">{r.order_id}</span>, csv: (r) => r.order_id },
    { key: "item", label: "Order item ID", csvOnly: true, cell: () => null, csv: (r) => r.order_item_id },
    { key: "day", label: "Ordered", sort: (r) => r.order_day, cell: (r) => formatDate(r.order_day), csv: (r) => r.order_day },
    { key: "age", label: "Days since", align: "right", sort: (r) => r.days_ago, cell: (r) => r.days_ago, csv: (r) => r.days_ago },
    { key: "qty", label: "Qty", align: "right", sort: (r) => r.qty, cell: (r) => r.qty, csv: (r) => r.qty },
    { key: "act", label: "", screenOnly: true, cell: (r) => <Buttons ticket={newTicketHref({ issue: "payment_missing", sku: r.sku, notes: unpaidTicketNotes(r) })} />, csv: () => null },
  ];
  return (
    <ListView
      rows={rows}
      columns={columns}
      rowKey={(r) => r.order_item_id}
      defaultSort={{ key: "age", dir: "desc" }}
      textKeys={["sku", "order"]}
      searchText={(r) => `${r.sku ?? ""} ${r.order_id} ${r.order_item_id}`}
      searchLabel="Search SKU or order ID"
      csvName="vrprime-unpaid-orders.csv"
      noun={["unpaid order", "unpaid orders"]}
      emptyTitle="Nothing unpaid"
      emptyBody="Every shipped order older than the limit has a settlement line, up to the latest settlement day uploaded."
    />
  );
}

export function WrongFeesTable({ rows }: { rows: WrongFeeRow[] }) {
  const columns: Column<WrongFeeRow>[] = [
    { key: "sku", label: "SKU", sort: (r) => r.sku, cell: (r) => <span className="break-all font-mono text-[13px] font-bold">{r.sku ?? "-"}</span>, csv: (r) => r.sku },
    { key: "problem", label: "Problem", sort: (r) => r.problem, cell: (r) => <Chip tone={r.problem === "Fee charged twice" ? "bad" : "warn"}>{r.problem}</Chip>, csv: (r) => r.problem },
    { key: "order", label: "Order ID", sort: (r) => r.order_id, cell: (r) => <span className="break-all font-mono text-xs">{r.order_id}</span>, csv: (r) => r.order_id },
    { key: "item", label: "Order item ID", csvOnly: true, cell: () => null, csv: (r) => r.order_item_id },
    { key: "date", label: "Paid on", sort: (r) => r.payment_date, cell: (r) => formatDate(r.payment_date), csv: (r) => r.payment_date },
    { key: "sale", label: "Sale", align: "right", sort: (r) => r.sale, cell: (r) => money(r.sale), csv: (r) => r.sale },
    { key: "pts", label: "This fee %", align: "right", sort: (r) => r.fee_points, cell: (r) => (r.fee_points === null ? "-" : `${r.fee_points}%`), csv: (r) => r.fee_points },
    { key: "usual", label: "Usual %", align: "right", sort: (r) => r.usual_points, cell: (r) => (r.usual_points === null ? "-" : `${r.usual_points}%`), csv: (r) => r.usual_points },
    { key: "extra", label: "Extra paid", align: "right", sort: (r) => r.extra_fee, cell: (r) => (r.extra_fee === null ? "-" : <span className="font-bold text-bad">{money(r.extra_fee, 2)}</span>), csv: (r) => r.extra_fee },
    { key: "act", label: "", screenOnly: true, cell: (r) => <Buttons ticket={newTicketHref({ issue: "wrong_fee", sku: r.sku, notes: feeTicketNotes(r) })} />, csv: () => null },
  ];
  return (
    <ListView
      rows={rows}
      columns={columns}
      rowKey={(r) => r.order_item_id + r.problem}
      defaultSort={{ key: "extra", dir: "desc" }}
      textKeys={["sku", "problem", "order"]}
      searchText={(r) => `${r.sku ?? ""} ${r.order_id ?? ""} ${r.order_item_id} ${r.problem}`}
      searchLabel="Search SKU or order ID"
      csvName="vrprime-wrong-fees.csv"
      noun={["fee to check", "fees to check"]}
      emptyTitle="No odd fees found"
      emptyBody="No settlement line has a fee far from what its SKU usually pays, and none is charged twice."
    />
  );
}
