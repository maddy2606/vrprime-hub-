// The Ads Desk's analysis over Flipkart Ads (PLA) reports, as plain functions (no imports, so `node --test` can load
// them): results (Winner, Losing, Zero sale…), campaigns against the period before, bids to cut, negative-keyword
// candidates, spend spikes and the weekday picture.

/** The owner's ROI lines: break-even, good, and how much spend, clicks or units it takes before judging. */
export type DeskSettings = { be: number; good: number; minSpend: number; minClicks: number; minUnits: number };
export const DESK_DEFAULTS: DeskSettings = { be: 4, good: 7, minSpend: 150, minClicks: 15, minUnits: 3 };

export type Metrics = { views: number; clicks: number; spend: number; units: number; rev: number };
export type Verdict = "winner" | "promising" | "ok" | "losing" | "zero" | "early";
export type Result = Metrics & { roi: number; ctr: number; cvr: number; cpc: number; rpc: number; v: Verdict };

export const VERDICTS: { v: Verdict; label: string; tip: string }[] = [
  { v: "winner", label: "Winner", tip: "ROI at or above the good line, with enough units" },
  { v: "promising", label: "Promising", tip: "ROI above the good line, but few units so far" },
  { v: "ok", label: "Profitable", tip: "Above break-even, below the good line" },
  { v: "losing", label: "Losing", tip: "Selling, but ROI below break-even" },
  { v: "zero", label: "Zero sale", tip: "Spent money, sold nothing" },
  { v: "early", label: "Too early", tip: "Not enough spend or clicks to judge" },
];

export function verdict(m: Metrics & { roi: number }, s: DeskSettings): Verdict {
  if (m.spend < s.minSpend && m.clicks < s.minClicks) return "early";
  if (m.units <= 0) return m.spend >= s.minSpend ? "zero" : "early";
  if (m.roi < s.be) return "losing";
  if (m.roi >= s.good) return m.units >= s.minUnits ? "winner" : "promising";
  return "ok";
}

export function finish<T extends Metrics>(m: T, s: DeskSettings): T & Result {
  const roi = m.spend ? m.rev / m.spend : 0;
  return { ...m, roi, ctr: m.views ? m.clicks / m.views : 0, cvr: m.clicks ? m.units / m.clicks : 0, cpc: m.clicks ? m.spend / m.clicks : 0, rpc: m.clicks ? m.rev / m.clicks : 0, v: verdict({ ...m, roi }, s) };
}

const ZERO = (): Metrics => ({ views: 0, clicks: 0, spend: 0, units: 0, rev: 0 });
const add = (a: Metrics, r: Metrics) => {
  a.views += r.views;
  a.clicks += r.clicks;
  a.spend += r.spend;
  a.units += r.units;
  a.rev += r.rev;
};
export const total = (rows: Metrics[]): Metrics => rows.reduce((a, r) => (add(a, r), a), ZERO());

/** Adds rows up by a key; `info` gives each group's labels from its first row. */
export function groupBy<R extends Metrics, I extends object>(rows: R[], key: (r: R) => string, info: (r: R) => I, s: DeskSettings): (I & Result & { key: string; n: number })[] {
  const m = new Map<string, Metrics & { key: string; n: number } & I>();
  for (const r of rows) {
    const k = key(r);
    let a = m.get(k);
    if (!a) {
      a = { ...ZERO(), key: k, n: 0, ...info(r) };
      m.set(k, a);
    }
    add(a, r);
    a.n++;
  }
  return [...m.values()].map((a) => finish(a, s));
}

// ---- The data as the database sends it (rows as arrays) -----------------------------------------------------------------

export type DailyRow = Metrics & { day: string; cid: string; name: string };
export type FsnRow = Metrics & { sku: string; cid: string; name: string };
export type TermRow = Metrics & { cid: string; name: string; term: string };
export type KwRow = Metrics & { cid: string; name: string; kw: string; mt: string };
export type PlRow = Metrics & { cid: string; name: string; pl: string };
export type Snapshot<R> = { from: string; to: string; at: string; rows: R[] };
export type DeskData = {
  daily: DailyRow[];
  fsn: Snapshot<FsnRow> | null;
  /** `rest`: per campaign, the search terms too small to list (no sale and under ₹10), added up. */
  st: (Snapshot<TermRow> & { lines: number; rest: { cid: string; views: number; clicks: number; spend: number; terms: number }[] }) | null;
  kw: Snapshot<KwRow> | null;
  pl: Snapshot<PlRow> | null;
  neg: { cid: string; term: string; status: "added" | "ignored" }[];
};

type Raw = Record<string, unknown> | null | undefined;
const N = (v: unknown) => Number(v) || 0;
const arr = (v: unknown): unknown[][] => (Array.isArray(v) ? (v as unknown[][]) : []);

/** Turns `ads_desk_data`'s answer into rows with names. */
export function readDeskData(raw: unknown): DeskData {
  const d = (raw ?? {}) as Record<string, unknown>;
  const snap = <R>(x: Raw, row: (r: unknown[]) => R): Snapshot<R> | null => (x && x.from ? { from: String(x.from), to: String(x.to), at: String(x.at ?? ""), rows: arr(x.rows).map(row) } : null);
  const st = d.st as Raw;
  const stSnap = snap(st, (r): TermRow => ({ cid: String(r[0]), name: String(r[1]), term: String(r[2]), views: N(r[3]), clicks: N(r[4]), spend: N(r[5]), units: N(r[6]), rev: N(r[7]) }));
  return {
    daily: arr(d.daily).map((r) => ({ day: String(r[0]), cid: String(r[1]), name: String(r[2]), spend: N(r[3]), views: N(r[4]), clicks: N(r[5]), units: N(r[6]), rev: N(r[7]) })),
    fsn: snap(d.fsn as Raw, (r): FsnRow => ({ sku: String(r[0]), cid: String(r[1]), name: String(r[2]), spend: N(r[3]), views: N(r[4]), clicks: N(r[5]), units: N(r[6]), rev: N(r[7]) })),
    st: stSnap ? { ...stSnap, lines: N(st?.lines), rest: arr(st?.rest).map((r) => ({ cid: String(r[0]), views: N(r[1]), clicks: N(r[2]), spend: N(r[3]), terms: N(r[4]) })) } : null,
    pl: snap(d.pl as Raw, (r): PlRow => ({ cid: String(r[0]), name: String(r[1]), pl: String(r[2]), views: N(r[3]), clicks: N(r[4]), spend: N(r[5]), units: N(r[6]), rev: N(r[7]) })),
    kw: snap(d.kw as Raw, (r): KwRow => ({ cid: String(r[0]), name: String(r[1]), kw: String(r[2]), mt: String(r[3]), views: N(r[4]), clicks: N(r[5]), spend: N(r[6]), units: N(r[7]), rev: N(r[8]) })),
    neg: arr(d.neg).map((r) => ({ cid: String(r[0]), term: String(r[1]), status: r[2] === "ignored" ? "ignored" : "added" })),
  };
}

// ---- Placements ------------------------------------------------------------------------------------------------------------

/** Flipkart's placement names, in page order, with a short name. Search placements are the only ones keywords and search terms explain. */
export const PLACES: { name: string; short: string; search: boolean }[] = [
  { name: "Top of Search Listings Page", short: "Top of search", search: true },
  { name: "Rest of Search Listings Page", short: "Rest of search", search: true },
  { name: "Product Page", short: "Product pages", search: false },
  { name: "Top of Browse Listings Page", short: "Top of browse", search: false },
  { name: "Rest of Browse Listings Page", short: "Rest of browse", search: false },
  { name: "Home Page", short: "Home page", search: false },
];
export function placeInfo(name: string): { short: string; order: number; search: boolean } {
  const i = PLACES.findIndex((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  return i >= 0 ? { short: PLACES[i].short, order: i, search: PLACES[i].search } : { short: name || "Other", order: 99, search: /search/i.test(name) };
}

/** Spend and sales per placement, in page order; for one campaign when `cid` is given. */
export function placements(rows: PlRow[], s: DeskSettings, cid?: string) {
  return groupBy(cid ? rows.filter((r) => r.cid === cid) : rows, (r) => r.pl, (r) => ({ pl: r.pl, ...placeInfo(r.pl) }), s).sort((a, b) => a.order - b.order);
}

/** Campaigns whose product-page placement spent the minimum or more under break-even: a leak to bid down. */
export function productPageLeaks(rows: PlRow[], s: DeskSettings) {
  return groupBy(rows.filter((r) => placeInfo(r.pl).order === 2), (r) => r.cid, (r) => ({ cid: r.cid, name: r.name }), s)
    .filter((x) => x.spend >= s.minSpend && x.roi < s.be)
    .sort((a, b) => b.spend - a.spend);
}

// ---- Dates ---------------------------------------------------------------------------------------------------------------

export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

export type RangePreset = "10x" | "7" | "14" | "30" | "all";
export type Range = { min: string; max: string; from: string; to: string; len: number; pFrom: string; pTo: string; hasPrev: boolean };

/**
 * The dates being looked at and the same number of days just before them. "10x" is the last 10 days leaving out today
 * and yesterday (their sales are still being attributed, so their ROI reads low).
 */
export function rangeFor(days: string[], preset: RangePreset, today: string): Range | null {
  if (!days.length) return null;
  const sorted = [...days].sort();
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  let from = min;
  let to = max;
  if (preset === "10x") {
    to = addDays(today, -2);
    if (to > max || to < min) to = max;
    from = addDays(to, -9);
  } else if (preset !== "all") from = addDays(max, -(Number(preset) - 1));
  if (from < min) from = min;
  const len = daysBetween(from, to);
  const pTo = addDays(from, -1);
  const pFrom = addDays(pTo, -(len - 1));
  return { min, max, from, to, len, pFrom, pTo, hasPrev: pFrom >= min };
}

// ---- Campaigns -----------------------------------------------------------------------------------------------------------

export type CampaignRow = Result & { cid: string; name: string; prev: Result | null; why: string[]; worse: boolean };

/** Every campaign in the dates, with the period before it and, when it got clearly worse, why. */
export function campaigns(daily: DailyRow[], r: Range, s: DeskSettings): CampaignRow[] {
  const cur = groupBy(daily.filter((d) => d.day >= r.from && d.day <= r.to), (d) => d.cid, (d) => ({ cid: d.cid, name: d.name }), s);
  const before = new Map(groupBy(r.hasPrev ? daily.filter((d) => d.day >= r.pFrom && d.day <= r.pTo) : [], (d) => d.cid, (d) => ({ cid: d.cid }), s).map((p) => [p.cid, p]));
  return cur
    .map((c) => {
      const p = before.get(c.cid) ?? null;
      const why: string[] = [];
      let worse = false;
      if (p && p.spend >= s.minSpend && c.spend >= s.minSpend) {
        if (p.units > 0 && c.units === 0) {
          worse = true;
          why.push(`sales stopped (${Math.round(p.units)} units before)`);
        } else if (p.roi - c.roi >= Math.max(1, p.roi * 0.25)) {
          worse = true;
          why.push(`ROI ${p.roi.toFixed(2)} → ${c.roi.toFixed(2)}`);
        }
        if (worse && p.clicks >= 10 && c.clicks >= 10 && c.cpc / p.cpc - 1 >= 0.2) why.push(`CPC ₹${p.cpc.toFixed(2)} → ₹${c.cpc.toFixed(2)}`);
        if (worse && c.clicks >= 10 && p.cvr > 0 && c.cvr / p.cvr - 1 <= -0.2) why.push(`conversion ${(p.cvr * 100).toFixed(1)}% → ${(c.cvr * 100).toFixed(1)}%`);
      }
      return { ...c, prev: p, why, worse };
    })
    .sort((a, b) => b.spend - a.spend);
}

/** Spend per day, all campaigns, for a chart. */
export function daySeries(daily: DailyRow[], from: string, to: string, s: DeskSettings, cid?: string): (Result & { day: string })[] {
  return groupBy(daily.filter((d) => d.day >= from && d.day <= to && (!cid || d.cid === cid)), (d) => d.day, (d) => ({ day: d.day }), s).sort((a, b) => a.day.localeCompare(b.day));
}

export type Spike = { cid: string; name: string; day: string; spend: number; avg: number; ratio: number; roi: number };

/** Days a campaign spent 1.5× or more of its usual day (its other days in the dates), worth at least the minimum spend. */
export function spikes(daily: DailyRow[], r: Range, s: DeskSettings): Spike[] {
  const by = new Map<string, DailyRow[]>();
  for (const d of daily) if (d.day >= r.from && d.day <= r.to) by.set(d.cid, [...(by.get(d.cid) ?? []), d]);
  const out: Spike[] = [];
  for (const rows of by.values()) {
    if (rows.length < 4) continue;
    const sum = rows.reduce((n, x) => n + x.spend, 0);
    for (const d of rows) {
      const avg = (sum - d.spend) / (rows.length - 1);
      if (avg > 0 && d.spend >= s.minSpend && d.spend >= avg * 1.5 && d.spend - avg >= s.minSpend) out.push({ cid: d.cid, name: d.name, day: d.day, spend: d.spend, avg, ratio: d.spend / avg, roi: d.spend ? d.rev / d.spend : 0 });
    }
  }
  return out.sort((a, b) => b.spend - b.avg - (a.spend - a.avg));
}

// ---- Products, keywords, search terms ----------------------------------------------------------------------------------

export function products(rows: FsnRow[], s: DeskSettings) {
  const camps = new Map<string, Set<string>>();
  for (const r of rows) camps.set(r.sku, (camps.get(r.sku) ?? new Set()).add(r.cid));
  return groupBy(rows, (r) => r.sku, (r) => ({ sku: r.sku }), s)
    .map((p) => ({ ...p, campaigns: camps.get(p.sku)?.size ?? 0 }))
    .sort((a, b) => b.spend - a.spend);
}

export type KeywordRow = Result & { key: string; cid: string; name: string; kw: string; mt: string; beCpc: number; goodCpc: number; excess: number; cut: boolean };

/**
 * Keywords with their bid guide: the most a click can cost and still break even (revenue per click ÷ break-even ROI), and
 * the bid for the good line. `cut` marks a keyword paying more than it earns; `excess` is the spend above break-even.
 */
export function keywords(rows: KwRow[], s: DeskSettings): KeywordRow[] {
  return groupBy(rows, (r) => `${r.cid}|${r.kw}|${r.mt}`, (r) => ({ cid: r.cid, name: r.name, kw: r.kw, mt: r.mt }), s)
    .map((k) => {
      const beCpc = k.rpc / s.be;
      const cut = k.spend >= s.minSpend && (k.units === 0 || k.cpc > beCpc);
      return { ...k, beCpc, goodCpc: k.rpc / s.good, cut, excess: cut ? (k.units === 0 ? k.spend : k.spend - k.rev / s.be) : 0 };
    })
    .sort((a, b) => b.spend - a.spend);
}

/** Search terms added up across campaigns. */
export function searchTerms(rows: TermRow[], s: DeskSettings) {
  const camps = new Map<string, Set<string>>();
  for (const r of rows) camps.set(r.term, (camps.get(r.term) ?? new Set()).add(r.cid));
  return groupBy(rows, (r) => r.term, (r) => ({ term: r.term }), s)
    .map((t) => ({ ...t, campaigns: camps.get(t.term)?.size ?? 0 }))
    .sort((a, b) => b.spend - a.spend);
}

export type NegStatus = "todo" | "added" | "ignored";
export type Negative = Result & { cid: string; name: string; term: string; status: NegStatus };

/**
 * Negative-keyword candidates: a search term in a campaign that spent the minimum or more and sold nothing, or sold at
 * under half the break-even ROI. `status` is what the owner already did about it.
 */
export function negatives(rows: TermRow[], decided: DeskData["neg"], s: DeskSettings): Negative[] {
  const done = new Map(decided.map((n) => [`${n.cid}|${n.term}`, n.status]));
  return rows
    .map((r) => finish(r, s))
    .filter((r) => r.spend >= s.minSpend && (r.units === 0 || r.roi < s.be / 2))
    .map((r) => ({ ...r, status: (done.get(`${r.cid}|${r.term}`) ?? "todo") as NegStatus }))
    .sort((a, b) => b.spend - a.spend);
}

/** Spend split by result, for "where every rupee went". */
export function flow(rows: Result[]) {
  const spend = rows.reduce((n, r) => n + r.spend, 0) || 1;
  return VERDICTS.map(({ v, label }) => {
    const mine = rows.filter((r) => r.v === v);
    const sp = mine.reduce((n, r) => n + r.spend, 0);
    const rev = mine.reduce((n, r) => n + r.rev, 0);
    return { v, label, n: mine.length, spend: sp, share: sp / spend, roi: sp ? rev / sp : 0 };
  }).filter((g) => g.n > 0);
}

// ---- Day of week -----------------------------------------------------------------------------------------------------------

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The whole account per average day of each weekday, Monday first. */
export function weekdays(daily: DailyRow[], from: string, to: string, s: DeskSettings) {
  const days = daySeries(daily, from, to, s);
  const out = WEEKDAYS.map((name, i) => {
    const mine = days.filter((d) => new Date(`${d.day}T00:00:00Z`).getUTCDay() === i);
    const t = finish(total(mine), s);
    const n = mine.length || 1;
    return { name, days: mine.length, spend: t.spend / n, rev: t.rev / n, units: t.units / n, roi: t.roi, cpc: t.cpc, cvr: t.cvr };
  });
  return [...out.slice(1), out[0]];
}
