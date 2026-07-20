export default function AdminNormalizationLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-9 w-72 rounded bg-[#3a414f]/10" />
      <div className="h-4 w-full max-w-xl rounded bg-[#3a414f]/8" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-56 rounded-lg border bg-card" />
        <div className="h-56 rounded-lg border bg-card" />
      </div>
    </div>
  );
}
