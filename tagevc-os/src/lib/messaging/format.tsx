import type { ReactNode } from 'react';
import { createElement, Fragment } from 'react';
import { entityDisplayName } from '@/lib/entities/display-name';

/** Lightweight formatting: URLs, **bold**, and newlines. */
export function formatMessageBody(body: string): ReactNode {
  const lines = body.split('\n');
  return lines.map((line, lineIdx) => (
    <Fragment key={lineIdx}>
      {lineIdx > 0 ? <br /> : null}
      {formatInline(line)}
    </Fragment>
  ));
}

function formatInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(\*\*([^*]+)\*\*|@[A-Za-z0-9._+\- ]{2,40}|https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    if (match[0].startsWith('**')) {
      nodes.push(
        createElement('strong', { key: `b-${key++}` }, match[2]),
      );
    } else if (match[0].startsWith('@')) {
      nodes.push(
        createElement(
          'span',
          {
            key: `m-${key++}`,
            className: 'rounded bg-[#9f957c]/20 px-0.5 font-medium text-[#3a414f]',
          },
          match[0].trimEnd(),
        ),
      );
    } else {
      nodes.push(
        createElement(
          'a',
          {
            key: `a-${key++}`,
            href: match[0],
            target: '_blank',
            rel: 'noopener noreferrer',
            className: 'underline underline-offset-2',
          },
          match[0],
        ),
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function linkedObjectHref(
  refType: string | null | undefined,
  refId: string | null | undefined,
): string | null {
  if (!refType || !refId) return null;
  switch (refType) {
    case 'lead':
      return `/deal-flow/vc/leads/${refId}`;
    case 'deal':
      return `/deal-flow/vc/deals/${refId}`;
    case 'entity':
      return `/entities/${refId}`;
    case 'task':
      // Lead tasks live on lead detail; deal tasks on deal detail — open search-ish fallback
      if (refId.startsWith('DT-')) return `/deal-flow/vc/deals`;
      if (refId.startsWith('LT-')) return `/deal-flow/vc`;
      return null;
    case 'ticket':
      return `/shared-services/tickets/${refId}`;
    case 'document':
      return `/documents/${refId}`;
    default:
      return null;
  }
}

export function linkedObjectLabel(
  refType: string | null | undefined,
  refId: string | null | undefined,
): string {
  if (!refType || !refId) return '';
  if (refType === 'entity') {
    return entityDisplayName(refId);
  }
  const type =
    refType === 'lead'
      ? 'Lead'
      : refType === 'deal'
        ? 'Deal'
        : refType === 'task'
          ? 'Task'
          : refType === 'ticket'
            ? 'Ticket'
            : refType === 'document'
              ? 'Document'
              : refType;
  return `${type} ${refId}`;
}
