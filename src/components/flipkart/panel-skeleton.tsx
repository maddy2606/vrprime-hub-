/** Shown straight away while a tab's numbers are on their way, so the page frame never waits for the database. */
export function PanelSkeleton({ tab }: { tab: string }) {
  const cards = tab === "orders" || tab === "stock";
  return (
    <div aria-busy="true" aria-label="Loading">
      {cards ? (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="skeleton h-24" />
          ))}
        </div>
      ) : null}
      <div className="skeleton mb-3 h-10 w-full" />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="skeleton mb-2 h-20 w-full" />
      ))}
    </div>
  );
}
