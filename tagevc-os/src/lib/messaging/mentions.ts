import type { DirectoryProfile } from '@/lib/messaging/types';

export type DocAttachment = {
  doc_id: string;
  title: string;
};

/** Resolve @mentions against directory. Supports @Name, @email, and <@uuid>. */
export function resolveMentions(
  body: string,
  directory: DirectoryProfile[],
): { mentionedIds: string[]; normalizedBody: string } {
  const mentioned = new Set<string>();
  let normalized = body;

  // Explicit tokens <@uuid>
  const tokenRe = /<@([0-9a-f-]{36})>/gi;
  normalized = normalized.replace(tokenRe, (_, id: string) => {
    const profile = directory.find((p) => p.id === id);
    if (profile) {
      mentioned.add(profile.id);
      return `@${profile.full_name?.trim() || profile.email}`;
    }
    return _;
  });

  // Sort by name length desc so longer names match first
  const sorted = [...directory].sort((a, b) => {
    const an = (a.full_name || a.email).length;
    const bn = (b.full_name || b.email).length;
    return bn - an;
  });

  for (const p of sorted) {
    const labels = [p.full_name?.trim(), p.email.split('@')[0], p.email].filter(
      Boolean,
    ) as string[];
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|\\s)@${escaped}(?=\\s|$|[.,!?])`, 'gi');
      if (re.test(normalized)) {
        mentioned.add(p.id);
      }
    }
  }

  return { mentionedIds: [...mentioned], normalizedBody: normalized };
}

export function reactionSummary(
  rows: Array<{ emoji: string; user_id: string }>,
  myId: string,
): Array<{ emoji: string; count: number; mine: boolean }> {
  const map = new Map<string, { count: number; mine: boolean }>();
  for (const r of rows) {
    const cur = map.get(r.emoji) ?? { count: 0, mine: false };
    cur.count += 1;
    if (r.user_id === myId) cur.mine = true;
    map.set(r.emoji, cur);
  }
  return [...map.entries()].map(([emoji, v]) => ({ emoji, ...v }));
}
