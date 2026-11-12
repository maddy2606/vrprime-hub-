// Made-up ads numbers for the local-only /dev/preview screen (?view=adsdesk), in the shape `ads_desk_data` answers.
// Never used in production.

const day = (i: number) => new Date(Date.UTC(2026, 9, 14 + i)).toISOString().slice(0, 10); // 14 Oct onwards
const CAMPS: [string, string, number, number][] = [
  // id, name, spend a day, ROI
  ["FAKECAMP0001", "FAKE Spray Auto", 4200, 8.2],
  ["FAKECAMP0002", "FAKE Spray Exact", 2600, 5.1],
  ["FAKECAMP0003", "FAKE Polish Phrase", 3100, 2.4],
  ["FAKECAMP0004", "FAKE Trap Auto", 900, 0],
  ["FAKECAMP0005", "FAKE Glue Keyword", 1500, 6.5],
];

export function fakeAdsDesk(): unknown {
  const daily: unknown[][] = [];
  for (let i = 0; i < 28; i++) {
    CAMPS.forEach(([id, name, spend, roi], c) => {
      // The polish campaign was fine until the last 10 days; one spray day spikes.
      const r = c === 2 && i < 16 ? 6 : roi;
      const s = spend * (1 + ((i * 7 + c * 3) % 5) / 20) * (c === 0 && i === 24 ? 2.4 : 1);
      const clicks = Math.round(s / (6 + c));
      daily.push([day(i), id, name, Math.round(s), clicks * 40, clicks, Math.round((s * r) / 420), Math.round(s * r)]);
    });
  }
  const row = (spend: number, roi: number, units: number, clicks: number) => [clicks * 35, clicks, spend, units, Math.round(spend * roi)];
  return {
    daily,
    fsn: { from: day(18), to: day(27), at: new Date().toISOString(), rows: [
      ["FAKE_SPRAY_1", "FAKECAMP0001", "FAKE Spray Auto", 30000, 240000, 5200, 590, 246000],
      ["FAKE_SPRAY_1", "FAKECAMP0002", "FAKE Spray Exact", 26000, 90000, 3900, 310, 132600],
      ["FAKE_POLISH_1", "FAKECAMP0003", "FAKE Polish Phrase", 31000, 280000, 4100, 170, 74400],
      ["FAKE_TRAP_2", "FAKECAMP0004", "FAKE Trap Auto", 9000, 90000, 1300, 0, 0],
      ["FAKE_GLUE_1", "FAKECAMP0005", "FAKE Glue Keyword", 15000, 120000, 2100, 230, 97500],
    ] },
    st: { from: day(18), to: day(27), at: new Date().toISOString(), lines: 180000, rest: [["FAKECAMP0001", 90000, 400, 2100, 320]], rows: [
      ["FAKECAMP0001", "FAKE Spray Auto", "fake spray", ...[60000, 2100, 12000, 290, 110000]],
      ["FAKECAMP0001", "FAKE Spray Auto", "fake free sample", ...[9000, 160, 980, 0, 0]],
      ["FAKECAMP0003", "FAKE Polish Phrase", "fake car polish", ...[70000, 1800, 14000, 80, 30000]],
      ["FAKECAMP0003", "FAKE Polish Phrase", "fake cheap polish", ...[20000, 500, 3900, 4, 1500]],
      ["FAKECAMP0004", "FAKE Trap Auto", "fake trap", ...[30000, 600, 4200, 0, 0]],
      ["FAKECAMP0005", "FAKE Glue Keyword", "fake glue", ...[25000, 700, 5000, 80, 34000]],
    ] },
    kw: { from: day(18), to: day(27), at: new Date().toISOString(), rows: [
      ["FAKECAMP0002", "FAKE Spray Exact", "fake spray", "EXACT", ...row(14000, 5.5, 180, 1900)],
      ["FAKECAMP0003", "FAKE Polish Phrase", "fake car polish", "PHRASE", ...row(16000, 2.1, 90, 1500)],
      ["FAKECAMP0003", "FAKE Polish Phrase", "fake wax", "PHRASE", ...row(2400, 0, 0, 260)],
      ["FAKECAMP0005", "FAKE Glue Keyword", "fake glue", "EXACT", ...row(9000, 7.4, 150, 1300)],
    ] },
    neg: [["FAKECAMP0003", "fake cheap polish", "ignored"]],
  };
}
