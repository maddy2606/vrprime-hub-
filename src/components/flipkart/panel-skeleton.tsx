/** Shown straight away while a tab's numbers are on their way, so the page frame never waits for the database. */
export function PanelSkeleton({ tab }: { tab: string }) {
  const tiles = tab === "orders" ? 3 : tab === "stock" ? 5 : tab === "returns" ? 3 : 0;
  return (
    <div aria-busy="true" aria-label="Loading">
      {tiles ? (
        <div className={`mb-4 grid gap-2 ${tiles === 5 ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" : tiles === 3 && tab === "returns" ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"}`}>
          {Array.from({ length: tiles }, (_, i) => (
            <div key={i} className="skeleton h-24" />
          ))}
        </div>
      ) : null}
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="skeleton h-11 w-52 sm:h-9" />
        <div className="skeleton h-11 w-32 sm:h-9" />
        <div className="skeleton h-11 min-w-40 flex-1 sm:h-9" />
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="skeleton mb-2 h-14 w-full" />
      ))}
    </div>
  );
}
