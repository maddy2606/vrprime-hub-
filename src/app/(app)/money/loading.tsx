export default function MoneyLoading() {
  return (
    <div aria-busy="true" aria-label="Loading Money">
      <div className="skeleton mb-2 h-7 w-24" />
      <div className="skeleton mb-5 h-4 w-56" />
      <div className="skeleton mb-4 h-10 w-full" />
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton h-20" />
        ))}
      </div>
      <div className="skeleton h-72 w-full" />
    </div>
  );
}
