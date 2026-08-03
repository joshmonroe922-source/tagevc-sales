/**
 * Engagement scoring + People-tab helpers.
 * Points: open +1, multi-open +1, click +3, reply +5, DocuSign open +2, completed +8.
 */

export function computeEngagementScore(input: {
  openCount?: number;
  clickCount?: number;
  replied?: boolean;
  docusignOpened?: boolean;
  docusignCompleted?: boolean;
  lastActivityAt?: string | null;
}): number {
  let score = 0;
  const opens = Number(input.openCount ?? 0);
  if (opens >= 1) score += 1;
  if (opens >= 2) score += 1;
  score += Number(input.clickCount ?? 0) * 3;
  if (input.replied) score += 5;
  if (input.docusignOpened) score += 2;
  if (input.docusignCompleted) score += 8;

  if (input.lastActivityAt) {
    const days =
      (Date.now() - new Date(input.lastActivityAt).getTime()) /
      (1000 * 60 * 60 * 24);
    if (days > 30) score *= 0.4;
    else if (days > 7) score *= 0.7;
  }

  return Math.round(score * 100) / 100;
}

export type RecipientFilter =
  | 'all'
  | 'clicked_no_reply'
  | 'opened'
  | 'hot'
  | 'no_engagement';

export function matchesRecipientFilter(
  row: {
    open_count: number;
    click_count: number;
    replied: boolean;
    score: number;
  },
  filter: RecipientFilter,
): boolean {
  switch (filter) {
    case 'clicked_no_reply':
      return row.click_count > 0 && !row.replied;
    case 'opened':
      return row.open_count > 0;
    case 'hot':
      return row.score >= 4;
    case 'no_engagement':
      return row.open_count === 0 && row.click_count === 0;
    default:
      return true;
  }
}
