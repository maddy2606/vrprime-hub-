export default function FlipkartLoading() {
  return (
    <div aria-busy="true" aria-label="Loading Flipkart">
      <div className="skeleton mb-2 h-7 w-24" />
      <div className="skeleton mb-5 h-4 w-56" />
      <div className="skeleton mb-4 h-16 w-full" />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="skeleton h-24" />
        ))}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="skeleton h-20" />
        ))}
      </div>
      <div className="skeleton mb-3 h-10 w-full" />
      <div className="skeleton h-72 w-full" />
    </div>
  );
}
