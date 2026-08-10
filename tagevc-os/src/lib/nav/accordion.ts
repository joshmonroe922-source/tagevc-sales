/**
 * Exclusive (single-open) nav accordion helpers for AppSidebar.
 * Deep-link / active-route auto-open remains additive elsewhere —
 * only user toggles use exclusive sibling collapse.
 */

/** Labels of items that are accordion groups (have children). */
export function accordionSiblingLabels(items: { label: string; children?: unknown[] }[]): string[] {
  return items.filter((item) => item.children?.length).map((item) => item.label);
}

/**
 * Toggle one group. When opening, collapse every other sibling at the same level.
 * Closing leaves siblings unchanged.
 */
export function exclusiveAccordionToggle(
  prev: Record<string, boolean>,
  label: string,
  siblingLabels: string[],
): Record<string, boolean> {
  const opening = !prev[label];
  const next = { ...prev };
  if (!opening) {
    next[label] = false;
    return next;
  }
  const peers = siblingLabels.includes(label)
    ? siblingLabels
    : [...siblingLabels, label];
  for (const sib of peers) {
    next[sib] = sib === label;
  }
  return next;
}
