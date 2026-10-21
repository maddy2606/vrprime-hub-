/**
 * Was the automatic review sync from the site's server. Flipkart and Shopsy block most of the server's requests, so
 * the 5-day count now runs in the owner's Chrome and saves through /api/reviews/save. This answers the database's
 * daily call without doing anything, so no half-read check is ever saved.
 */
export async function POST() {
  return Response.json({ ok: true, text: "Counted in Chrome instead" }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
