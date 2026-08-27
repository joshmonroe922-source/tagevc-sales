/**
 * Shared nav active-route helpers — copy into every entity OS shell.
 * Longest matching href wins so nested items (A&F → Accounting) don't
 * leave the parent lit at the same time.
 */

export function pathOnly(href: string): string {
  return href.split('?')[0]?.split('#')[0] ?? href;
}

export type PathMatchOptions = {
  /** Only exact path match (e.g. ECC "Today" hub). */
  exact?: boolean;
};

/** Exact path or nested under href (prefix match). */
export function isPathMatch(
  pathname: string,
  href: string,
  opts?: PathMatchOptions,
): boolean {
  const base = pathOnly(href);
  if (!base) return false;
  if (opts?.exact) return pathname === base;
  return (
    pathname === base ||
    (base !== '/' && pathname.startsWith(`${base}/`))
  );
}

/**
 * Among candidate nav hrefs, pick the single best match for this pathname.
 * Prefer the longest path so `/shared-services/af/accounting` wins over
 * `/shared-services/af`.
 */
export function resolveActiveNavHref(
  pathname: string,
  hrefs: readonly string[],
): string | null {
  let best: string | null = null;
  let bestLen = -1;
  for (const href of hrefs) {
    if (!isPathMatch(pathname, href)) continue;
    const len = pathOnly(href).length;
    if (len > bestLen) {
      best = href;
      bestLen = len;
    }
  }
  return best;
}

export function isNavItemActive(
  pathname: string,
  href: string,
  allHrefs: readonly string[],
): boolean {
  return resolveActiveNavHref(pathname, allHrefs) === href;
}

/** @deprecated Prefer isPathMatch — kept for older scaffold copy notes. */
export const isNavHrefActive = isPathMatch;

/** @deprecated Prefer resolveActiveNavHref. */
export const pickActiveNavHref = resolveActiveNavHref;
