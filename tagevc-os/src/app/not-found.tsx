import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
        404
      </p>
      <h1 className="font-heading text-3xl font-semibold text-[#3a414f]">
        Page not found
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        That route doesn&apos;t exist in the Tage VC Operating System.
      </p>
      <Link
        href="/command-center"
        className="inline-flex h-9 items-center rounded-lg bg-[#3a414f] px-4 text-sm font-medium text-white hover:bg-[#535c63]"
      >
        Back to Command Center
      </Link>
    </div>
  );
}
