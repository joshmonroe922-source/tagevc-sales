/** Path prefixes that fill the main pane edge-to-edge (shared shell spine). */
export const FULL_BLEED_PREFIXES = ['/messages'] as const;

export function isFullBleedPath(pathname: string) {
  return FULL_BLEED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
