export default function PortfolioLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="space-y-3">
        <div className="h-9 w-64 rounded bg-[#3a414f]/10" />
        <div className="h-4 w-full max-w-xl rounded bg-[#3a414f]/8" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg border bg-card" />
        ))}
      </div>
      <div className="h-64 rounded-lg border bg-card" />
    </div>
  );
}
