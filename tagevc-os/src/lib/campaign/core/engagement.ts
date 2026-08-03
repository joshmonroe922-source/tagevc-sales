/** Simple P0 engagement score — prefer clicks/replies over opens (Apple MPP). */

export function scoreEngagement(input: {
  delivered?: boolean;
  openCount?: number;
  clickCount?: number;
  replied?: boolean;
  docusignOpened?: boolean;
  docusignCompleted?: boolean;
  daysSinceActivity?: number | null;
}): number {
  let score = 0;
  if (input.delivered) score += 0;
  const opens = input.openCount ?? 0;
  if (opens >= 1) score += 1;
  if (opens >= 2) score += 1;
  score += (input.clickCount ?? 0) * 3;
  if (input.replied) score += 5;
  if (input.docusignOpened) score += 2;
  if (input.docusignCompleted) score += 8;
  const days = input.daysSinceActivity;
  if (days != null) {
    if (days > 30) score *= 0.4;
    else if (days > 7) score *= 0.7;
  }
  return Math.round(score * 100) / 100;
}
